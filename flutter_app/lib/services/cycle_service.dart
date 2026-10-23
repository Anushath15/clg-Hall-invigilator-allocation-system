import '../core/database.dart';
import '../core/format.dart';
import '../models/domain/session_rules.dart';
import 'time_slots.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';

class SessionInput {
  final String examDate, sessionType;
  final String? reportingTime, examStart, examEnd;
  const SessionInput({required this.examDate, required this.sessionType, this.reportingTime, this.examStart, this.examEnd});
}

/// ALLOCATION BATCHES (exam cycles) and their sessions. Unconfirmed sessions are always kept in date
/// order after the confirmed ones (R4); confirmed sessions are never renumbered.
class CycleService {
  CycleService(this.db);
  final AppDatabase db;

  List<ExamCycle> cycles() => db.query('SELECT * FROM exam_cycles ORDER BY created_at DESC, id DESC').map(ExamCycle.fromRow).toList();

  ExamCycle? cycle(int id) {
    final r = db.queryOne('SELECT * FROM exam_cycles WHERE id=?', [id]);
    return r == null ? null : ExamCycle.fromRow(r);
  }

  ExamCycle createCycle(String name, String academicYear) {
    final problem = validateBatchName(name) ?? validateAcademicYear(academicYear);
    if (problem != null) throw ArgumentError(problem);
    final r = db.run('INSERT INTO exam_cycles(name,academic_year,status) VALUES(?,?,?)', [name.trim(), academicYear.trim(), 'draft']);
    return cycle(r.lastInsertRowid)!;
  }

  List<ExamSession> sessions(int cycleId) => db.query('SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step', [cycleId]).map(ExamSession.fromRow).toList();

  ExamSession? session(int id) {
    final r = db.queryOne('SELECT * FROM exam_sessions WHERE id=?', [id]);
    return r == null ? null : ExamSession.fromRow(r);
  }

  static String _slotName(String type) => type == 'FN' ? 'Forenoon (FN)' : 'Afternoon (AN)';

  void _checkTimes(String? reporting, String? start, String? end) {
    if (reporting == null && start == null && end == null) return;
    final problem = validateSessionTimes(reporting, start, end);
    if (problem != null) throw ArgumentError(problem);
  }

  static SessionSlot _slotOf(SessionInput d) => SessionSlot(date: d.examDate, type: d.sessionType, from: d.reportingTime ?? d.examStart, to: d.examEnd);

  /// FN and AN of one date of a batch are separate sessions: their times must not overlap.
  void _checkSameDay(int cycleId, SessionInput d, {int exceptId = 0}) {
    final clash = sessionsAtSameTime(db, _slotOf(d), exceptId: exceptId, inCycle: cycleId).firstOrNull;
    if (clash != null) {
      throw ArgumentError('The ${_slotName(d.sessionType)} session (${_slotOf(d).text}) overlaps the ${_slotName(clash.sessionType)} session of the same batch (${clash.slot.text}). Give each session its own time.');
    }
  }

  /// A seated session cannot move to a time at which some of its students or halls are already seated in another batch.
  void _checkMove(int sessionId, SessionInput d) {
    final mine = asInt(db.queryOne('SELECT COUNT(*) AS c FROM seat_allocations WHERE session_id = ?', [sessionId])?['c']);
    if (mine == 0) return;
    for (final other in sessionsAtSameTime(db, _slotOf(d), exceptId: sessionId, withSeating: true)) {
      final students = asInt(db.queryOne('SELECT COUNT(*) AS c FROM seat_allocations a JOIN seat_allocations b ON b.student_id = a.student_id AND b.session_id = ? WHERE a.session_id = ?', [other.id, sessionId])?['c']);
      final halls = db.query('SELECT DISTINCT h.hall_code FROM seat_allocations a JOIN seat_allocations b ON b.hall_id = a.hall_id AND b.session_id = ? JOIN halls h ON h.id = a.hall_id WHERE a.session_id = ?', [other.id, sessionId]);
      if (students > 0 || halls.isNotEmpty) {
        throw ArgumentError('This session cannot move to ${_slotOf(d).text}: ${other.text} is at the same time and ${[
          if (students > 0) '$students of its students are also seated there',
          if (halls.isNotEmpty) 'hall${halls.length == 1 ? '' : 's'} ${halls.map((h) => h['hall_code']).join(', ')} ${halls.length == 1 ? 'is' : 'are'} in use there',
        ].join(' and ')}. A student cannot write two exams at once and a hall cannot hold two.');
      }
    }
  }

  /// A batch's status follows its sessions: confirmed once all are confirmed, published once all are published.
  void refreshCycleStatus(int cycleId) {
    final c = db.queryOne('''SELECT COUNT(*) as total,
        SUM(CASE WHEN status IN ('confirmed','published') THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published
        FROM exam_sessions WHERE cycle_id=?''', [cycleId]);
    final total = asInt(c?['total']);
    final status = total > 0 && asInt(c?['published']) == total
        ? 'published'
        : total > 0 && asInt(c?['confirmed']) == total
            ? 'confirmed'
            : 'draft';
    db.run("UPDATE exam_cycles SET status=?, updated_at=datetime('now') WHERE id=?", [status, cycleId]);
  }

  void renumberUnconfirmedSessions(int cycleId) {
    final rows = db.query('SELECT id, exam_date, session_type, rotation_step, status FROM exam_sessions WHERE cycle_id=?', [cycleId])
        .map((r) => SessionOrderRow(id: asInt(r['id']), examDate: asStr(r['exam_date']), sessionType: asStr(r['session_type']), rotationStep: asInt(r['rotation_step']), status: asStr(r['status'])))
        .toList();
    for (final c in unconfirmedStepChanges(rows)) {
      db.run("UPDATE exam_sessions SET rotation_step=?, updated_at=datetime('now') WHERE id=? AND status NOT IN ('confirmed','published')", [c.rotationStep, c.id]);
    }
  }

  /// The batch wizard: replaces the batch's unconfirmed sessions with [list] (confirmed ones stay).
  void createSessions(int cycleId, List<SessionInput> list) {
    if (list.any((s) => isPastDate(s.examDate))) throw ArgumentError(pastDateMessage);
    for (final s in list) {
      _checkTimes(s.reportingTime, s.examStart, s.examEnd);
    }
    db.transaction(() {
      for (final s in db.query("SELECT id FROM exam_sessions WHERE cycle_id=? AND status NOT IN ('confirmed','published')", [cycleId])) {
        db.run('DELETE FROM exam_sessions WHERE id=?', [s['id']]);
      }
      var step = asInt(db.queryOne('SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?', [cycleId])?['m']) + 1;
      final seen = {for (final e in db.query('SELECT exam_date, session_type FROM exam_sessions WHERE cycle_id=?', [cycleId])) '${e['exam_date']}_${e['session_type']}'};
      for (final s in list) {
        final key = '${s.examDate}_${s.sessionType}';
        if (!seen.add(key)) continue;
        _checkSameDay(cycleId, s);
        db.run('INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)',
            [cycleId, s.examDate, s.sessionType, step++, s.reportingTime, s.examStart, s.examEnd, 'pending']);
      }
      renumberUnconfirmedSessions(cycleId);
    });
  }

  ExamSession addSession(int cycleId, SessionInput data) {
    if (isPastDate(data.examDate)) throw ArgumentError(pastDateMessage);
    _checkTimes(data.reportingTime, data.examStart, data.examEnd);
    if (db.queryOne('SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=?', [cycleId, data.examDate, data.sessionType]) != null) {
      throw ArgumentError('A ${_slotName(data.sessionType)} session already exists for ${data.examDate} in this cycle.');
    }
    _checkSameDay(cycleId, data);
    final maxStep = asInt(db.queryOne('SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?', [cycleId])?['m']);
    final r = db.run('INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)',
        [cycleId, data.examDate, data.sessionType, maxStep + 1, data.reportingTime, data.examStart, data.examEnd, 'pending']);
    renumberUnconfirmedSessions(cycleId);
    refreshCycleStatus(cycleId);
    return session(r.lastInsertRowid)!;
  }

  /// Reschedules a session (date, slot, times); status and rotation step never come from the caller.
  ExamSession? updateSession(int id, SessionInput data) {
    final current = session(id);
    if (current == null) return null;
    if (data.examDate != current.examDate && isPastDate(data.examDate)) throw ArgumentError(pastDateMessage);
    if (db.queryOne('SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=? AND id!=?', [current.cycleId, data.examDate, data.sessionType, id]) != null) {
      throw ArgumentError('A ${_slotName(data.sessionType)} session already exists for ${data.examDate} in this cycle.');
    }
    if (data.reportingTime != null && data.examStart != null && data.examEnd != null) _checkTimes(data.reportingTime, data.examStart, data.examEnd);
    _checkSameDay(current.cycleId, data, exceptId: id);
    _checkMove(id, data);
    db.run("UPDATE exam_sessions SET exam_date=?,session_type=?,reporting_time=?,exam_start=?,exam_end=?,updated_at=datetime('now') WHERE id=?",
        [data.examDate, data.sessionType, data.reportingTime, data.examStart, data.examEnd, id]);
    renumberUnconfirmedSessions(current.cycleId);
    return session(id);
  }

  ActionResult<void> deleteSession(int id) {
    final s = session(id);
    if (s == null) return const ActionResult.fail('Session not found.');
    if (s.isConfirmed) return const ActionResult.fail('Cannot delete a confirmed or published session.');
    db.transaction(() {
      db.run('DELETE FROM seat_allocations WHERE session_id=?', [id]);
      db.run('DELETE FROM seating_configs WHERE session_id=?', [id]);
      db.run('DELETE FROM allocations WHERE session_id=?', [id]);
      db.run('DELETE FROM exam_sessions WHERE id=?', [id]);
      renumberUnconfirmedSessions(s.cycleId);
      refreshCycleStatus(s.cycleId);
    });
    return const ActionResult.ok();
  }

  /// Deletes a whole batch (even a confirmed one). The rotation history stays, with its session link
  /// cleared, so later allocations still count the duties done. The person deleting must be an active
  /// registered staff member whose name matches; a record is kept in deleted_batches.
  ActionResult<void> deleteCycle(int id, {required String typedBatchName, required String personName, required String staffId}) {
    final c = db.queryOne('SELECT * FROM exam_cycles WHERE id=?', [id]);
    if (c == null) return const ActionResult.fail('Allocation batch not found.');
    final problem = validateBatchDeletion(batchName: asStr(c['name']), typedBatchName: typedBatchName, personName: personName, staffId: staffId);
    if (problem != null) return ActionResult.fail(problem);
    final user = db.queryOne('SELECT id, name, staff_id, is_active FROM users WHERE LOWER(staff_id) = LOWER(?)', [staffId.trim()]);
    if (user == null) return ActionResult.fail('No one with Staff ID "${staffId.trim()}" is registered, so this batch cannot be deleted.');
    String norm(String s) => s.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();
    if (norm(asStr(user['name'])) != norm(personName)) return ActionResult.fail('The name does not match the registered name for Staff ID ${user['staff_id']}.');
    if (!asBool(user['is_active'])) return ActionResult.fail('${user['name']} is no longer active and cannot delete a batch.');
    final name = asStr(user['name']), sid = asStr(user['staff_id']);
    db.transaction(() {
      final sessions = db.query('SELECT id, status FROM exam_sessions WHERE cycle_id=?', [id]);
      var allocationCount = 0;
      for (final s in sessions) {
        allocationCount += asInt(db.queryOne('SELECT COUNT(*) AS c FROM allocations WHERE session_id=?', [s['id']])?['c']);
      }
      db.run('''INSERT INTO deleted_batches(batch_name, academic_year, status, batch_created_at, session_count, confirmed_session_count, allocation_count, deleted_at, deleted_by_name, deleted_by_staff_id)
                VALUES(?,?,?,?,?,?,?,?,?,?)''', [
        c['name'], c['academic_year'], c['status'], c['created_at'], sessions.length,
        sessions.where((s) => s['status'] == 'confirmed' || s['status'] == 'published').length,
        allocationCount, DateTime.now().toUtc().toIso8601String(), name, sid
      ]);
      for (final s in sessions) {
        db.run('UPDATE rotation_history SET session_id=NULL WHERE session_id=?', [s['id']]);
        db.run('DELETE FROM seat_allocations WHERE session_id=?', [s['id']]);
        db.run('DELETE FROM seating_configs WHERE session_id=?', [s['id']]);
        db.run('DELETE FROM allocations WHERE session_id=?', [s['id']]);
      }
      db.run('DELETE FROM exam_sessions WHERE cycle_id=?', [id]);
      db.run('DELETE FROM exam_cycles WHERE id=?', [id]);
      db.writeAuditLog(asInt(user['id']), 'CYCLE_DELETE',
          'Allocation batch deleted: ${c['name']} (${c['academic_year']}) — ${sessions.length} session(s) removed — by $name ($sid)',
          {'id': id, 'name': c['name'], 'sessionCount': sessions.length, 'deletedByName': name, 'deletedByStaffId': sid});
    });
    return const ActionResult.ok();
  }

  List<DeletedBatch> deletedBatches() => db.query('SELECT * FROM deleted_batches ORDER BY id DESC').map(DeletedBatch.fromRow).toList();
}
