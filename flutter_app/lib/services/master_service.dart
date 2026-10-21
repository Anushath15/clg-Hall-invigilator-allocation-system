import '../core/database.dart';
import '../core/format.dart';
import '../models/domain/hall_layout.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';

/// MASTER DATA: departments, staff, halls, settings and the dashboard numbers. Department codes,
/// Staff IDs and hall codes are unique ignoring letter case; a clash is reported by name.
class MasterService {
  MasterService(this.db);
  final AppDatabase db;

  // ── Departments ─────────────────────────────────────────

  List<Department> departments() => db.query('SELECT * FROM departments ORDER BY name').map(Department.fromRow).toList();

  ActionResult<Department> saveDepartment({int? id, required String code, required String name, bool isActive = true}) {
    code = code.trim();
    name = name.trim();
    if (code.isEmpty || name.isEmpty) return const ActionResult.fail('Code and Name are required.');
    final problem = validateDepartmentCode(code) ?? validateDepartmentName(name);
    if (problem != null) return ActionResult.fail(problem);
    final clash = db.queryOne('SELECT code FROM departments WHERE code = ? COLLATE NOCASE AND id != ?', [code, id ?? 0]);
    if (clash != null) return ActionResult.fail('A department with code "${clash['code']}" already exists (codes are not case-sensitive).');
    if (id != null) {
      db.run('UPDATE departments SET code=?,name=?,is_active=? WHERE id=?', [code, name, isActive, id]);
      return ActionResult.ok(Department.fromRow(db.queryOne('SELECT * FROM departments WHERE id=?', [id])!));
    }
    final r = db.run('INSERT INTO departments(code,name) VALUES(?,?)', [code, name]);
    return ActionResult.ok(Department.fromRow(db.queryOne('SELECT * FROM departments WHERE id=?', [r.lastInsertRowid])!));
  }

  ActionResult<void> deleteDepartment(int id) {
    if (db.queryOne('SELECT id FROM users WHERE department_id=?', [id]) != null) return const ActionResult.fail('Cannot delete: staff assigned to this department.');
    if (db.queryOne('SELECT id FROM students WHERE department_id=?', [id]) != null) return const ActionResult.fail('Cannot delete: students belong to this department.');
    db.run('DELETE FROM departments WHERE id=?', [id]);
    return const ActionResult.ok();
  }

  /// The department an import row names, by code or name; a code match wins.
  int? findDepartmentId(String value) => asIntOrNull(db.queryOne(
      'SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE ORDER BY (code = ? COLLATE NOCASE) DESC, id LIMIT 1',
      [value, value, value])?['id']);

  // ── Staff ───────────────────────────────────────────────

  static const _userColumns = 'u.id, u.staff_id, u.name, u.email, u.designation, u.role, u.department_id, u.is_active, u.created_at, u.updated_at';

  List<Staff> staff({String? role, bool? isActive, int? departmentId}) {
    var sql = 'SELECT $_userColumns, d.name as department_name, d.code as department_code FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE 1=1';
    final params = <Object?>[];
    if (role != null) {
      sql += ' AND u.role=?';
      params.add(role);
    }
    if (isActive != null) {
      sql += ' AND u.is_active=?';
      params.add(isActive);
    }
    if (departmentId != null) {
      sql += ' AND u.department_id=?';
      params.add(departmentId);
    }
    sql += ' ORDER BY d.code COLLATE NOCASE, u.name';
    return db.query(sql, params).map(Staff.fromRow).toList();
  }

  ActionResult<void> saveStaff({int? id, required String staffId, required String name, String? email, String? designation, int? departmentId, bool isActive = true}) {
    final problem = validateStaff(staffId: staffId, name: name, designation: designation, email: email);
    if (problem != null) return ActionResult.fail(problem);
    staffId = staffId.trim();
    name = name.trim();
    final mail = (email ?? '').trim().isEmpty ? null : email!.trim();
    final desig = (designation ?? '').trim().isEmpty ? null : designation!.trim();
    final clash = db.queryOne('SELECT staff_id, name FROM users WHERE staff_id = ? COLLATE NOCASE AND id != ?', [staffId, id ?? 0]);
    if (clash != null) return ActionResult.fail('Staff ID ${clash['staff_id']} is already used by ${clash['name']}. Each Staff ID can be used only once.');
    if (id != null) {
      db.run("UPDATE users SET staff_id=?,name=?,email=?,designation=?,role='staff',department_id=?,is_active=?,updated_at=datetime('now') WHERE id=?",
          [staffId, name, mail, desig, departmentId, isActive, id]);
    } else {
      db.run("INSERT INTO users(staff_id,name,email,designation,role,department_id,is_active) VALUES(?,?,?,?,'staff',?,1)", [staffId, name, mail, desig, departmentId]);
    }
    return const ActionResult.ok();
  }

  void deactivateStaff(int id) => db.run('UPDATE users SET is_active=0 WHERE id=?', [id]);

  ActionResult<void> hardDeleteStaff(int id) {
    final inHistory = db.queryOne('SELECT id FROM rotation_history WHERE user_id = ? LIMIT 1', [id]);
    final inAllocations = db.queryOne('SELECT id FROM allocations WHERE user_id = ? LIMIT 1', [id]);
    if (inHistory != null || inAllocations != null) return const ActionResult.fail('Cannot permanently delete: this staff member has allocation history.');
    final user = db.queryOne('SELECT staff_id, name FROM users WHERE id = ?', [id]);
    db.run('DELETE FROM users WHERE id = ?', [id]);
    db.writeAuditLog(null, 'STAFF_HARD_DELETE', 'Staff permanently deleted: ${user?['staff_id'] ?? id} - ${user?['name'] ?? ''}', {'id': id, 'staff_id': user?['staff_id']});
    return const ActionResult.ok();
  }

  /// Imports staff from a sheet's rows (first row the header: Staff ID, Name, Department; Email and Designation optional).
  ImportResult importStaff(List<List<Object?>> rows) {
    final header = (rows.isEmpty ? <Object?>[] : rows.first).map((h) => '${h ?? ''}'.trim().toLowerCase()).toList();
    int col(List<String> aliases) => header.indexWhere(aliases.contains);
    final idCol = col(['staff id', 'staff_id', 'staffid', 'id']);
    final nameCol = col(['name', 'staff name', 'full name']);
    final deptCol = col(['department', 'department code', 'dept', 'dept code', 'department_code']);
    final emailCol = col(['email', 'e-mail', 'mail']);
    final desigCol = col(['designation']);
    final missing = [if (idCol < 0) 'Staff ID', if (nameCol < 0) 'Name', if (deptCol < 0) 'Department'];
    if (missing.isNotEmpty) {
      return ImportResult.fail(
          'This Excel file is missing required column(s): ${missing.join(', ')}. The first row must have a column for Staff ID, Name and Department.',
          missingColumns: missing);
    }
    final body = <({List<Object?> r, int row})>[];
    for (var i = 1; i < rows.length; i++) {
      if (rows[i].any((c) => '${c ?? ''}'.trim().isNotEmpty)) body.add((r: rows[i], row: i + 1));
    }
    if (body.isEmpty) return const ImportResult.fail('This Excel file has no data rows below the header.');
    var inserted = 0;
    final issues = <({int row, String reason})>[];
    for (final b in body) {
      String cell(int i) => i < 0 || i >= b.r.length ? '' : '${b.r[i] ?? ''}'.trim();
      final staffId = cell(idCol), name = cell(nameCol), dept = cell(deptCol);
      final miss = [if (staffId.isEmpty) 'Staff ID', if (name.isEmpty) 'Name', if (dept.isEmpty) 'Department'];
      if (miss.isNotEmpty) {
        issues.add((row: b.row, reason: 'Missing ${miss.join(', ')}'));
        continue;
      }
      final deptId = findDepartmentId(dept);
      if (deptId == null) {
        issues.add((row: b.row, reason: 'Department "$dept" does not match any existing department (check Master Data → Departments).'));
        continue;
      }
      if (db.queryOne('SELECT id FROM users WHERE staff_id = ? COLLATE NOCASE', [staffId]) != null) {
        issues.add((row: b.row, reason: 'Staff ID "$staffId" already exists — skipped.'));
        continue;
      }
      final email = cell(emailCol), designation = cell(desigCol);
      final problem = validateStaff(staffId: staffId, name: name, designation: designation, email: email);
      if (problem != null) {
        issues.add((row: b.row, reason: '$problem (Staff ID "$staffId")'));
        continue;
      }
      db.run("INSERT INTO users(staff_id,name,email,designation,department_id,role,is_active) VALUES(?,?,?,?,?,'staff',1)",
          [staffId, name, email.isEmpty ? null : email, designation.isEmpty ? null : designation, deptId]);
      inserted++;
    }
    return ImportResult(success: true, inserted: inserted, issues: issues);
  }

  // ── Halls ───────────────────────────────────────────────

  /// Halls in their fixed order (sort_order, then id).
  List<Hall> halls() => db.query('SELECT * FROM halls ORDER BY sort_order, id').map(Hall.fromRow).toList();

  ActionResult<void> saveHall({int? id, required String hallCode, String? block, String? floor, int capacity = 0, bool isActive = true, required HallLayout layout}) {
    final code = hallCode.trim();
    if (code.isEmpty) return const ActionResult.fail('Hall Code is required.');
    final place = validateHallPlace('Block', block) ?? validateHallPlace('Floor', floor);
    if (place != null) return ActionResult.fail(place);
    final problem = validateHallLayout(layout.rows, layout.cols);
    if (problem != null) return ActionResult.fail(problem);
    final disabled = cleanDisabled(layout);
    final kinds = cleanKinds(layout.copyWith(disabled: disabled));
    final clean = layout.copyWith(disabled: disabled, kinds: kinds);
    final benches = benchCount(clean);
    if (layout.rows > 0 && benches == 0) return const ActionResult.fail('Every bench is switched off. Keep at least one bench or chair, or set rows and columns to 0.');
    final cap = layout.rows > 0 ? seatCount(clean) : capacity;
    if (cap < 0) return const ActionResult.fail('Capacity cannot be negative.');
    final clash = db.queryOne('SELECT hall_code FROM halls WHERE hall_code = ? COLLATE NOCASE AND id != ?', [code, id ?? 0]);
    if (clash != null) {
      return ActionResult.fail('Hall ${clash['hall_code']} already exists. Each hall code can be used only once (capital and small letters count as the same).');
    }
    final fl = (floor ?? '').trim().isEmpty ? null : floor!.trim();
    final bl = (block ?? '').trim().isEmpty ? null : block!.trim();
    final dj = '[${disabled.map((d) => '"$d"').join(',')}]';
    final kj = kindsToJson(kinds);
    if (id != null) {
      db.run('UPDATE halls SET hall_code=?,name=?,floor=?,capacity=?,block=?,is_active=?,bench_rows=?,bench_cols=?,disabled_benches=?,seat_kinds=? WHERE id=?',
          [code, code, fl, cap, bl, isActive, layout.rows, layout.cols, dj, kj, id]);
    } else {
      final maxOrder = asInt(db.queryOne('SELECT MAX(sort_order) as m FROM halls')?['m']);
      db.run('INSERT INTO halls(hall_code,name,floor,capacity,block,is_active,sort_order,bench_rows,bench_cols,disabled_benches,seat_kinds) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [code, code, fl, cap, bl, 1, maxOrder + 1, layout.rows, layout.cols, dj, kj]);
    }
    return const ActionResult.ok();
  }

  ActionResult<void> deleteHall(int id) {
    final inUse = db.queryOne('SELECT id FROM allocations WHERE hall_id=?', [id]) ?? db.queryOne('SELECT id FROM seat_allocations WHERE hall_id=?', [id]);
    if (inUse != null) return const ActionResult.fail('Cannot delete: hall has existing allocations.');
    db.run('DELETE FROM halls WHERE id=?', [id]);
    return const ActionResult.ok();
  }

  // ── Settings ────────────────────────────────────────────

  Map<String, String> settings() => {for (final r in db.query('SELECT key,value FROM settings')) asStr(r['key']): asStr(r['value'])};

  ActionResult<void> saveSetting(String key, String value) {
    final problem = key == 'college.name'
        ? validateCollegeName(value)
        : key == 'college.short_name'
            ? validateCollegeShortName(value)
            : RegExp(r'^session\.(fn|an)_(reporting|start|end)_time$').hasMatch(key)
                ? validateTimeOfDay(value)
                : null;
    if (problem != null) return ActionResult.fail(problem);
    final v = value.trim();
    if (db.queryOne('SELECT key FROM settings WHERE key=?', [key]) == null) {
      db.run('INSERT INTO settings(key,value) VALUES(?,?)', [key, v]);
    } else {
      db.run('UPDATE settings SET value=? WHERE key=?', [v, key]);
    }
    return const ActionResult.ok();
  }

  // ── Dashboard ───────────────────────────────────────────

  /// "Upcoming" sessions have not finished yet by the computer's clock.
  DashboardStats dashboardStats([DateTime? now]) {
    final today = todayLocal(now), time = timeNowLocal(now);
    int count(String sql, [List<Object?> p = const []]) => asInt(db.queryOne(sql, p)?['c']);
    return DashboardStats(
      totalStaff: count("SELECT COUNT(*) as c FROM users WHERE is_active=1 AND role='staff'"),
      totalHalls: count('SELECT COUNT(*) as c FROM halls WHERE is_active=1'),
      totalStudents: count('SELECT COUNT(*) as c FROM students WHERE is_active=1'),
      totalBoys: count("SELECT COUNT(*) as c FROM students WHERE is_active=1 AND gender='M'"),
      totalCycles: count('SELECT COUNT(*) as c FROM exam_cycles'),
      confirmedSessions: count("SELECT COUNT(*) as c FROM exam_sessions WHERE status IN ('confirmed','published')"),
      upcomingSessions: count("SELECT COUNT(*) as c FROM exam_sessions WHERE exam_date > ? OR (exam_date = ? AND (exam_end IS NULL OR exam_end = '' OR exam_end > ?))", [today, today, time]),
      pendingAllocations: count("SELECT COUNT(*) as c FROM exam_sessions WHERE status NOT IN ('confirmed','published')"),
      allocatedHalls: count("SELECT COUNT(DISTINCT a.hall_id) as c FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.status IN ('confirmed','published')"),
      totalExamDays: count('SELECT COUNT(DISTINCT exam_date) as c FROM exam_sessions'),
    );
  }
}
