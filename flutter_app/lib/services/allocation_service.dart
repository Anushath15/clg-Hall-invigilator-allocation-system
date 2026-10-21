import '../core/database.dart';
import '../models/domain/assignment.dart';
import '../models/domain/session_rules.dart';
import '../models/entities.dart';
import 'cycle_service.dart';
import 'student_service.dart';
import 'subject_service.dart';

/// INVIGILATOR ALLOCATION: generation (rotation engine), manual swaps, confirmation into the
/// rotation history, and the seven validation rules (R1–R7).
class AllocationService {
  AllocationService(this.db, this.cycles, this.students, this.subjects);
  final AppDatabase db;
  final CycleService cycles;
  final StudentService students;
  final SubjectService subjects;

  // ── Rotation engine ─────────────────────────────────────

  /// A staff member's confirmed halls, most recent first.
  List<int> hallHistory(int userId) => db
      .query('SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC', [userId])
      .map((r) => asInt(r['hall_id']))
      .toList();

  Set<int> hallsVisitedThisCycle(int userId, List<int> pool) => visitedThisCycle(hallHistory(userId), pool);

  List<HallAssignment> _generate(int sessionId, List<int> userIds, List<int> hallIds) {
    if (userIds.length != hallIds.length) throw ArgumentError('Staff count (${userIds.length}) must equal hall count (${hallIds.length})');
    final s = db.queryOne('SELECT cycle_id, created_at FROM exam_sessions WHERE id = ?', [sessionId]);
    final seed = allocationSeed(cycleId: asIntOrNull(s?['cycle_id']), sessionId: sessionId, createdAt: asStrOrNull(s?['created_at']), userIds: userIds, hallIds: hallIds);
    return assignHalls(userIds, hallIds, hallHistory, seed, subjects.conflictOf(sessionId, hallIds)).entries;
  }

  void _commitToHistory(int sessionId, int rotationStep, List<HallAssignment> entries) {
    var next = asInt(db.queryOne('SELECT MAX(global_order) as max_order FROM rotation_history')?['max_order']) + 1;
    for (final e in entries) {
      final existing = db.queryOne('SELECT id FROM rotation_history WHERE user_id = ? AND session_id = ?', [e.userId, sessionId]);
      if (existing != null) {
        db.run("UPDATE rotation_history SET hall_id = ?, rotation_step = ?, recorded_at = datetime('now') WHERE id = ?", [e.hallId, rotationStep, existing['id']]);
      } else {
        db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(?,?,?,?,?,datetime('now'))",
            [e.userId, sessionId, e.hallId, rotationStep, next++]);
      }
    }
  }

  // ── Generate / edit / confirm ───────────────────────────

  ({List<AllocationRow> entries, ValidationResult validation}) generate(int sessionId, List<int> userIds, List<int> hallIds) {
    final s = cycles.session(sessionId);
    if (s == null) throw ArgumentError('Exam session not found.');
    if (s.isConfirmed) throw ArgumentError('This session is already confirmed. It cannot be regenerated.');
    if (userIds.toSet().length != userIds.length) throw ArgumentError('The same staff member is selected more than once.');
    if (hallIds.toSet().length != hallIds.length) throw ArgumentError('The same hall is selected more than once.');
    final entries = _generate(sessionId, userIds, hallIds);
    db.transaction(() {
      db.run('DELETE FROM allocations WHERE session_id = ?', [sessionId]);
      for (final e in entries) {
        db.run('INSERT OR REPLACE INTO allocations(session_id, user_id, hall_id, is_manually_edited, generated_hall_id) VALUES(?,?,?,0,?)', [sessionId, e.userId, e.hallId, e.hallId]);
      }
      db.run("UPDATE exam_sessions SET status='draft' WHERE id=?", [sessionId]);
      students.dropSeatingIfHallsChanged(sessionId);
    });
    final validation = validate(sessionId, entries.map((e) => (userId: e.userId, hallId: e.hallId)).toList(), hallIds, userIds);
    return (entries: sessionAllocation(sessionId), validation: validation);
  }

  /// Manual edit = swap: [userId] takes [newHallId] and whoever holds it takes userId's hall.
  ({bool success, ValidationIssue? error, int? swappedWithUserId}) edit(int sessionId, int userId, int newHallId, [String? editReason]) {
    final s = cycles.session(sessionId);
    if (s == null) return (success: false, error: const ValidationIssue('SESSION', 'Exam session not found.'), swappedWithUserId: null);
    if (s.isConfirmed) return (success: false, error: const ValidationIssue('LOCKED', 'This session is confirmed; its allocation can no longer be edited.'), swappedWithUserId: null);
    final current = db.query('SELECT user_id, hall_id, generated_hall_id, created_at FROM allocations WHERE session_id = ?', [sessionId]);
    if (current.any((r) => asInt(r['user_id']) == userId && asInt(r['hall_id']) == newHallId)) {
      return (success: false, error: const ValidationIssue('NO_CHANGE', 'That is already the assigned hall.'), swappedWithUserId: null);
    }
    final entries = current.map((r) => (userId: asInt(r['user_id']), hallId: asInt(r['hall_id']))).toList();
    final pool = current.map((r) => asInt(r['generated_hall_id'] ?? r['hall_id'])).toSet().toList();
    final checked = _validateSwap(userId, newHallId, sessionId, entries, pool);
    if (checked.error != null) return (success: false, error: checked.error, swappedWithUserId: null);
    final plan = checked.plan!;
    final moves = [(userId: userId, hallId: newHallId), if (plan.partnerUserId != null) (userId: plan.partnerUserId!, hallId: plan.fromHallId!)];
    db.transaction(() {
      for (final m in moves) {
        db.run('DELETE FROM allocations WHERE session_id=? AND user_id=?', [sessionId, m.userId]);
      }
      for (final m in moves) {
        final row = current.firstWhere((r) => asInt(r['user_id']) == m.userId);
        final gen = asIntOrNull(row['generated_hall_id']);
        final edited = gen == null || m.hallId != gen;
        db.run("INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, edit_reason, generated_hall_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'))",
            [sessionId, m.userId, m.hallId, edited, edited ? editReason : null, gen, row['created_at']]);
      }
      if (plan.partnerUserId != null) {
        db.writeAuditLog(null, 'SWAP_ALLOCATION', 'Manual swap in session $sessionId: user $userId to hall $newHallId, user ${plan.partnerUserId} to hall ${plan.fromHallId}',
            {'sessionId': sessionId, 'userId': userId, 'newHallId': newHallId, 'partnerUserId': plan.partnerUserId, 'partnerHallId': plan.fromHallId, 'editReason': editReason});
      } else {
        db.writeAuditLog(null, 'EDIT_ALLOCATION', 'Manual override for session $sessionId, user $userId to hall $newHallId', {'sessionId': sessionId, 'userId': userId, 'newHallId': newHallId, 'editReason': editReason});
      }
    });
    return (success: true, error: null, swappedWithUserId: plan.partnerUserId);
  }

  ({bool success, String? error, ValidationResult? validation}) confirm(int sessionId) {
    final allocations = db.query('SELECT * FROM allocations WHERE session_id = ?', [sessionId]);
    if (allocations.isEmpty) return (success: false, error: 'No allocations found for this session.', validation: null);
    final s = cycles.session(sessionId);
    if (s == null) return (success: false, error: 'Exam session not found.', validation: null);
    final entries = allocations.map((a) => (userId: asInt(a['user_id']), hallId: asInt(a['hall_id']))).toList();
    final validation = validate(sessionId, entries, entries.map((e) => e.hallId).toList(), entries.map((e) => e.userId).toList());
    if (!validation.isValid) return (success: false, error: null, validation: validation);
    try {
      db.transaction(() {
        _commitToHistory(sessionId, s.rotationStep,
            allocations.map((a) => HallAssignment(asInt(a['user_id']), asInt(a['hall_id']), isAutoGenerated: !asBool(a['is_manually_edited']))).toList());
        db.run("UPDATE exam_sessions SET status='confirmed', updated_at=datetime('now') WHERE id=?", [sessionId]);
      });
      cycles.refreshCycleStatus(s.cycleId);
      db.writeAuditLog(null, 'CONFIRM_ALLOCATION', 'Session $sessionId confirmed', {'sessionId': sessionId, 'count': entries.length});
      return (success: true, error: null, validation: validation);
    } catch (e) {
      return (success: false, error: '$e', validation: null);
    }
  }

  List<AllocationRow> sessionAllocation(int sessionId) => db.query('''SELECT a.id, a.is_manually_edited, a.edit_reason,
            u.id as userId, u.staff_id, u.name as userName, u.designation, d.name as deptName, d.code as deptCode,
            h.id as hallId, h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor, gh.hall_code as generatedHallCode
     FROM allocations a JOIN users u ON a.user_id = u.id JOIN halls h ON a.hall_id = h.id
     LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN halls gh ON a.generated_hall_id = gh.id
     WHERE a.session_id = ? ORDER BY d.code COLLATE NOCASE, u.name''', [sessionId]).map(AllocationRow.fromRow).toList();

  /// The halls offered in the edit dialog: each a swap with its holder, checked for both people.
  List<ValidHall> validHallsFor(int userId, int sessionId) {
    final entries = db.query('SELECT user_id, hall_id FROM allocations WHERE session_id = ?', [sessionId]).map((r) => (userId: asInt(r['user_id']), hallId: asInt(r['hall_id']))).toList();
    var sessionHalls = db.query('''SELECT DISTINCT h.id, h.sort_order FROM allocations a JOIN halls h ON h.id = COALESCE(a.generated_hall_id, a.hall_id)
        WHERE a.session_id = ? ORDER BY h.sort_order, h.id''', [sessionId]).map((r) => asInt(r['id'])).toList();
    if (sessionHalls.isEmpty) sessionHalls = db.query('SELECT id FROM halls WHERE is_active = 1 ORDER BY sort_order, id').map((h) => asInt(h['id'])).toList();
    final pool = _cyclePool(sessionHalls);
    final mine = entries.where((e) => e.userId == userId).firstOrNull;
    return sessionHalls.map((hallId) {
      if (mine?.hallId == hallId) return ValidHall(hallId, false, reason: 'Current hall');
      final plan = planSwap(entries, userId, hallId, pool, hallHistory);
      if (plan.selfRepeat) return ValidHall(hallId, false, reason: 'Already visited in cycle');
      if (plan.partnerUserId == null) return ValidHall(hallId, true);
      if (mine == null) return ValidHall(hallId, false, reason: 'Assigned to another invigilator');
      if (plan.partnerRepeat) {
        final partner = db.queryOne('SELECT name FROM users WHERE id = ?', [plan.partnerUserId]);
        final from = db.queryOne('SELECT hall_code FROM halls WHERE id = ?', [mine.hallId]);
        return ValidHall(hallId, false, reason: 'Swap blocked: ${partner?['name'] ?? 'the holder'} already had Hall ${from?['hall_code'] ?? mine.hallId} in this rotation cycle');
      }
      return ValidHall(hallId, true, swapWithUserId: plan.partnerUserId);
    }).toList();
  }

  /// Sessions whose staff/hall selection can be copied, newest first.
  List<SelectionSource> sessionSelections() => db.query('''SELECT es.id, es.cycle_id as cycleId, ec.name as cycleName, es.exam_date, es.session_type, es.status, COUNT(a.id) as staffCount
     FROM exam_sessions es JOIN exam_cycles ec ON es.cycle_id = ec.id JOIN allocations a ON a.session_id = es.id
     GROUP BY es.id ORDER BY es.exam_date DESC, CASE es.session_type WHEN 'FN' THEN 1 ELSE 0 END, es.id DESC''')
      .map((r) => SelectionSource(
          id: asInt(r['id']), cycleId: asInt(r['cycleId']), cycleName: asStr(r['cycleName']), examDate: asStr(r['exam_date']),
          sessionType: asStr(r['session_type']), status: asStr(r['status']), staffCount: asInt(r['staffCount'])))
      .toList();

  /// A staff member's confirmed and published duties, newest first.
  List<StaffDutyRow> staffDutyHistory(int userId) => db.query('''SELECT es.exam_date, es.session_type, es.status, es.reporting_time, es.exam_start, es.exam_end,
         h.id as hallId, h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor, ec.name as cycleName, ec.academic_year, a.is_manually_edited
  FROM allocations a JOIN exam_sessions es ON a.session_id = es.id JOIN halls h ON a.hall_id = h.id JOIN exam_cycles ec ON es.cycle_id = ec.id
  WHERE a.user_id = ? AND es.status IN ('confirmed','published') ORDER BY es.exam_date DESC, es.session_type ASC''', [userId]).map(StaffDutyRow.fromRow).toList();

  /// Every confirmed and published allocation, filtered.
  List<DbRow> history({int? cycleId, int? userId, int? hallId, int? sessionId}) {
    var sql = '''SELECT u.staff_id, u.name as staffName, d.code as deptCode, h.hall_code, es.exam_date, es.session_type, ec.name as cycleName, a.is_manually_edited
      FROM allocations a JOIN users u ON a.user_id=u.id JOIN halls h ON a.hall_id=h.id JOIN exam_sessions es ON a.session_id=es.id
      JOIN exam_cycles ec ON es.cycle_id=ec.id LEFT JOIN departments d ON u.department_id=d.id WHERE es.status IN ('confirmed','published')''';
    final p = <Object?>[];
    if (cycleId != null) {
      sql += ' AND es.cycle_id=?';
      p.add(cycleId);
    }
    if (userId != null) {
      sql += ' AND a.user_id=?';
      p.add(userId);
    }
    if (hallId != null) {
      sql += ' AND a.hall_id=?';
      p.add(hallId);
    }
    if (sessionId != null) {
      sql += ' AND a.session_id=?';
      p.add(sessionId);
    }
    return db.query("$sql ORDER BY es.exam_date, CASE es.session_type WHEN 'FN' THEN 0 ELSE 1 END, u.name", p);
  }

  /// Clears the whole rotation history: every staff member starts a fresh cycle.
  void restartRotation() {
    db.transaction(() {
      db.run('DELETE FROM rotation_history');
      final active = db.query("SELECT id FROM users WHERE role = 'staff' AND is_active = 1");
      for (final s in active) {
        db.run("INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, datetime('now'))", [
          s['id'],
          'Rotation Restarted',
          'Your entire hall rotation history has been restarted by the admin. Your rotation cycle has been reset, so every hall is open to you again from your next duty.'
        ]);
      }
      db.writeAuditLog(null, 'ROTATION_RESTART', 'Entire rotation history restarted by admin', {'affectedStaffCount': active.length});
    });
  }

  // ── Validation engine ───────────────────────────────────

  List<int> _cyclePool(List<int> sessionHalls) =>
      sessionHalls.isNotEmpty ? sessionHalls : db.query('SELECT id FROM halls WHERE is_active = 1').map((r) => asInt(r['id'])).toList();

  String _visitText(DbRow? prev) => prev?['exam_date'] != null ? 'on ${prev!['exam_date']} (${prev['session_type']})' : 'earlier (in a deleted batch)';

  DbRow? _lastVisit(int userId, int hallId) => db.queryOne('''SELECT es.exam_date, es.session_type FROM rotation_history rh LEFT JOIN exam_sessions es ON rh.session_id = es.id
      WHERE rh.user_id = ? AND rh.hall_id = ? ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1''', [userId, hallId]);

  ValidationResult validate(int sessionId, List<({int userId, int hallId})> entries, List<int> hallIds, List<int> userIds) {
    final errors = <ValidationIssue>[];
    final warnings = <String>[];
    if (entries.length != hallIds.length) errors.add(ValidationIssue('R7', 'Staff count (${userIds.length}) must equal hall count (${hallIds.length}).'));
    for (final e in entries) {
      final u = db.queryOne('SELECT id, name, staff_id, is_active FROM users WHERE id = ?', [e.userId]);
      if (u != null && !asBool(u['is_active'])) errors.add(ValidationIssue('R5', '${u['name']} (${u['staff_id']}) is inactive.', userId: asInt(u['id'])));
    }
    for (final e in entries) {
      final h = db.queryOne('SELECT id, hall_code, is_active FROM halls WHERE id = ?', [e.hallId]);
      if (h != null && !asBool(h['is_active'])) errors.add(ValidationIssue('R6', 'Hall ${h['hall_code']} is inactive.', hallId: asInt(h['id'])));
    }
    final hallCounts = <int, int>{};
    for (final e in entries) {
      hallCounts[e.hallId] = (hallCounts[e.hallId] ?? 0) + 1;
    }
    hallCounts.forEach((hallId, count) {
      if (count > 1) {
        final h = db.queryOne('SELECT hall_code FROM halls WHERE id = ?', [hallId]);
        errors.add(ValidationIssue('R2', 'Hall ${h?['hall_code'] ?? hallId} is assigned to $count staff in the same session.', hallId: hallId));
      }
    });
    final userCounts = <int, int>{};
    for (final e in entries) {
      userCounts[e.userId] = (userCounts[e.userId] ?? 0) + 1;
    }
    userCounts.forEach((userId, count) {
      if (count > 1) {
        final u = db.queryOne('SELECT name FROM users WHERE id = ?', [userId]);
        errors.add(ValidationIssue('R3', '${u?['name'] ?? userId} is assigned to $count halls in the same session.', userId: userId));
      }
    });
    for (final e in entries) {
      if (hallsVisitedThisCycle(e.userId, hallIds).contains(e.hallId)) {
        final u = db.queryOne('SELECT name FROM users WHERE id = ?', [e.userId]);
        final h = db.queryOne('SELECT hall_code FROM halls WHERE id = ?', [e.hallId]);
        errors.add(ValidationIssue('R1', '${u?['name']} was already assigned Hall ${h?['hall_code']} ${_visitText(_lastVisit(e.userId, e.hallId))} in the current rotation cycle. Cannot repeat.',
            userId: e.userId, hallId: e.hallId));
      }
    }
    // R1 exception: repeats no more than the unavoidable minimum become warnings.
    final r1 = errors.where((e) => e.rule == 'R1').toList();
    if (r1.isNotEmpty) {
      final minimum = minimumRepeats(entries.map((e) => e.userId).toList(), entries.map((e) => e.hallId).toList(), hallHistory);
      if (r1.length <= minimum) {
        for (final e in r1) {
          errors.remove(e);
          warnings.add('Unavoidable repeat: ${e.message.replaceAll(' Cannot repeat.', '')} No valid alternative exists for the staff on duty in this session.');
        }
      }
    }
    // R4: every earlier session of the batch must already be confirmed.
    final s = cycles.session(sessionId);
    if (s != null) {
      final earlier = asInt(db.queryOne("SELECT COUNT(*) as c FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ? AND status NOT IN ('confirmed','published')",
          [s.cycleId, s.rotationStep])?['c']);
      if (earlier > 0) errors.add(const ValidationIssue('R4', 'Previous session(s) in this cycle have not been confirmed yet. Confirm sessions in order.'));
    }
    return ValidationResult(errors.isEmpty, errors, warnings);
  }

  ({ValidationIssue? error, SwapPlan? plan}) _validateSwap(int userId, int hallId, int sessionId, List<({int userId, int hallId})> current, List<int> sessionHallPool) {
    final user = db.queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (user == null || !asBool(user['is_active'])) return (error: ValidationIssue('R5', '${user?['name'] ?? 'Staff'} is inactive.', userId: userId), plan: null);
    final hall = db.queryOne('SELECT * FROM halls WHERE id = ?', [hallId]);
    if (hall == null || !asBool(hall['is_active'])) return (error: ValidationIssue('R6', 'Hall ${hall?['hall_code'] ?? hallId} is inactive.', hallId: hallId), plan: null);
    final sessionHalls = sessionHallPool.isNotEmpty
        ? sessionHallPool
        : db.query('SELECT DISTINCT COALESCE(generated_hall_id, hall_id) as h_id FROM allocations WHERE session_id = ?', [sessionId]).map((r) => asInt(r['h_id'])).toList();
    if (sessionHalls.isNotEmpty && !sessionHalls.contains(hallId)) {
      return (error: ValidationIssue('SESSION_POOL', "Hall ${hall['hall_code']} is not part of this session's hall pool.", hallId: hallId), plan: null);
    }
    final plan = planSwap(current, userId, hallId, _cyclePool(sessionHalls), hallHistory);
    if (plan.fromHallId == null) return (error: ValidationIssue('SESSION', '${user['name']} has no hall in this session.', userId: userId), plan: null);
    if (plan.selfRepeat) {
      return (
        error: ValidationIssue('R1', '${user['name']} was already assigned Hall ${hall['hall_code']} ${_visitText(_lastVisit(userId, hallId))} in the current rotation cycle.', userId: userId, hallId: hallId),
        plan: null
      );
    }
    if (plan.partnerUserId != null) {
      final partner = db.queryOne('SELECT * FROM users WHERE id = ?', [plan.partnerUserId]);
      final from = db.queryOne('SELECT * FROM halls WHERE id = ?', [plan.fromHallId]);
      if (partner == null || !asBool(partner['is_active'])) {
        return (error: ValidationIssue('R5', '${partner?['name'] ?? 'Staff'} holds Hall ${hall['hall_code']} but is inactive.', userId: plan.partnerUserId), plan: null);
      }
      if (from == null || !asBool(from['is_active'])) {
        return (error: ValidationIssue('R6', 'Hall ${from?['hall_code'] ?? plan.fromHallId} is inactive, so ${partner['name']} cannot take it.', hallId: plan.fromHallId), plan: null);
      }
      if (plan.partnerRepeat) {
        return (
          error: ValidationIssue('R1',
              'Swap refused: ${partner['name']} would get Hall ${from['hall_code']}, which ${partner['name']} already had ${_visitText(_lastVisit(asInt(partner['id']), asInt(from['id'])))} in the current rotation cycle.',
              userId: asInt(partner['id']), hallId: asInt(from['id'])),
          plan: null
        );
      }
    }
    return (error: null, plan: plan);
  }
}
