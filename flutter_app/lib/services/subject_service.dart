import 'dart:convert';

import '../core/database.dart';
import '../core/format.dart';
import '../models/domain/assignment.dart';
import '../models/domain/seating.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';

class SubjectConflictRow {
  final int userId, hallId, subjectId;
  final String userName, staffId, hallCode, subjectCode, subjectName;
  const SubjectConflictRow({required this.userId, required this.userName, required this.staffId, required this.hallId, required this.hallCode, required this.subjectId, required this.subjectCode, required this.subjectName});
}

/// SUBJECTS: the subject master, the staff who handle each subject, the students who study it,
/// and the subject clashes of a session's invigilators.
class SubjectService {
  SubjectService(this.db);
  final AppDatabase db;

  List<Subject> list() {
    final subjects = db.query('SELECT sb.id, sb.code, sb.name, sb.department_id, sb.is_active, d.code as department_code FROM subjects sb LEFT JOIN departments d ON d.id = sb.department_id');
    final staff = db.query('SELECT ss.subject_id, u.id, u.name, u.staff_id FROM staff_subjects ss JOIN users u ON u.id = ss.user_id ORDER BY u.name COLLATE NOCASE');
    final students = <int, List<int>>{};
    for (final r in db.query('SELECT subject_id, student_id FROM student_subjects')) {
      students.putIfAbsent(asInt(r['subject_id']), () => []).add(asInt(r['student_id']));
    }
    final out = subjects
        .map((s) => Subject(
              id: asInt(s['id']),
              code: asStr(s['code']),
              name: asStr(s['name']),
              departmentId: asIntOrNull(s['department_id']),
              departmentCode: asStrOrNull(s['department_code']),
              isActive: asBool(s['is_active']),
              staff: staff.where((x) => asInt(x['subject_id']) == asInt(s['id'])).map((u) => Staff(id: asInt(u['id']), staffId: asStr(u['staff_id']), name: asStr(u['name']))).toList(),
              studentIds: students[asInt(s['id'])] ?? const [],
            ))
        .toList();
    out.sort((a, b) => naturalCompare(a.code, b.code));
    return out;
  }

  ActionResult<int> save({int? id, required String code, required String name, int? departmentId, bool isActive = true, List<int>? staffIds}) {
    final problem = validateSubject(code: code, name: name);
    if (problem != null) return ActionResult.fail(problem);
    code = code.trim().replaceAll(RegExp(r'\s+'), ' ');
    name = name.trim().replaceAll(RegExp(r'\s+'), ' ');
    final clash = db.queryOne('SELECT code, name FROM subjects WHERE code = ? COLLATE NOCASE AND id != ?', [code, id ?? 0]);
    if (clash != null) return ActionResult.fail('Subject Code ${clash['code']} is already used by ${clash['name']}.');
    var sid = id ?? 0;
    if (sid != 0) {
      db.run("UPDATE subjects SET code=?, name=?, department_id=?, is_active=?, updated_at=datetime('now') WHERE id=?", [code, name, departmentId, isActive, sid]);
    } else {
      sid = db.run('INSERT INTO subjects(code, name, department_id, is_active) VALUES(?,?,?,1)', [code, name, departmentId]).lastInsertRowid;
    }
    if (staffIds != null) setStaff(sid, staffIds);
    return ActionResult.ok(sid);
  }

  void setStaff(int subjectId, List<int> userIds) {
    db.run('DELETE FROM staff_subjects WHERE subject_id = ?', [subjectId]);
    for (final u in userIds.where((n) => n > 0).toSet()) {
      db.run('INSERT OR IGNORE INTO staff_subjects(user_id, subject_id) VALUES(?,?)', [u, subjectId]);
    }
  }

  ActionResult<int> setStudents(int subjectId, List<int> studentIds) {
    if (db.queryOne('SELECT id FROM subjects WHERE id = ?', [subjectId]) == null) return const ActionResult.fail('Subject not found.');
    final ids = studentIds.where((n) => n > 0).toSet();
    db.transaction(() {
      db.run('DELETE FROM student_subjects WHERE subject_id = ?', [subjectId]);
      for (final id in ids) {
        db.run('INSERT OR IGNORE INTO student_subjects(student_id, subject_id) SELECT id, ? FROM students WHERE id = ?', [subjectId, id]);
      }
    });
    return ActionResult.ok(ids.length);
  }

  void delete(int id) {
    db.run('DELETE FROM student_subjects WHERE subject_id = ?', [id]);
    db.run('DELETE FROM staff_subjects WHERE subject_id = ?', [id]);
    db.run('DELETE FROM subjects WHERE id = ?', [id]);
  }

  static List<({List<Object?> r, int row})> _body(List<List<Object?>> rows) => [
        for (var i = 1; i < rows.length; i++)
          if (rows[i].any((c) => '${c ?? ''}'.trim().isNotEmpty)) (r: rows[i], row: i + 1)
      ];

  static const subjectImportColumns = ['Subject Code', 'Subject Name', 'Department (optional)', 'Staff IDs (optional, separated by , or ;)'];
  static const studentSubjectImportColumns = ['Roll No (or Register No)', 'Subject Codes (separated by , or ;)'];

  /// Imports subjects; an existing code is updated and the Staff IDs listed are added to its staff.
  ImportResult importSubjects(List<List<Object?>> rows) {
    final header = (rows.isEmpty ? <Object?>[] : rows.first).map((h) => '${h ?? ''}'.trim().toLowerCase()).toList();
    int col(List<String> names) => header.indexWhere(names.contains);
    final codeCol = col(['subject code', 'code', 'subject_code', 'course code', 'paper code']);
    final nameCol = col(['subject name', 'name', 'subject', 'subject_name', 'course name', 'paper name', 'title']);
    final deptCol = col(['department', 'dept', 'department code', 'dept code']);
    final staffCol = col(['staff ids', 'staff id', 'staff', 'handled by', 'staff_ids', 'faculty', 'faculty ids']);
    final missing = [if (codeCol < 0) 'Subject Code', if (nameCol < 0) 'Subject Name'];
    if (missing.isNotEmpty) {
      return ImportResult.fail('This Excel file is missing required column(s): ${missing.join(', ')}. The first row must name the columns ${subjectImportColumns.join(', ')}.');
    }
    final body = _body(rows);
    if (body.isEmpty) return const ImportResult.fail('This Excel file has no data rows below the header.');
    var saved = 0;
    final issues = <({int row, String reason})>[];
    for (final b in body) {
      String cell(int i) => i < 0 || i >= b.r.length ? '' : '${b.r[i] ?? ''}'.trim();
      int? departmentId;
      if (cell(deptCol).isNotEmpty) {
        final d = db.queryOne('SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE LIMIT 1', [cell(deptCol), cell(deptCol)]);
        if (d == null) {
          issues.add((row: b.row, reason: 'Department "${cell(deptCol)}" does not match any existing department.'));
          continue;
        }
        departmentId = asInt(d['id']);
      }
      final staffIds = <int>[], unknown = <String>[];
      for (final sid in cell(staffCol).split(RegExp(r'[,;\n]+')).map((x) => x.trim()).where((x) => x.isNotEmpty)) {
        final u = db.queryOne('SELECT id FROM users WHERE staff_id = ? COLLATE NOCASE', [sid]);
        if (u != null) {
          staffIds.add(asInt(u['id']));
        } else {
          unknown.add(sid);
        }
      }
      final existing = db.queryOne('SELECT id FROM subjects WHERE code = ? COLLATE NOCASE', [cell(codeCol)]);
      final before = existing == null ? <int>[] : db.query('SELECT user_id FROM staff_subjects WHERE subject_id = ?', [existing['id']]).map((x) => asInt(x['user_id'])).toList();
      final res = save(id: asIntOrNull(existing?['id']), code: cell(codeCol), name: cell(nameCol), departmentId: departmentId, staffIds: [...before, ...staffIds]);
      if (!res.success) {
        issues.add((row: b.row, reason: res.error!));
        continue;
      }
      saved++;
      if (unknown.isNotEmpty) issues.add((row: b.row, reason: 'Saved, but Staff ID(s) not found: ${unknown.join(', ')}'));
    }
    return ImportResult(success: true, inserted: saved, issues: issues);
  }

  /// Maps students to subjects: one row per student (Roll No or Register No) with the subject codes they study.
  ImportResult importStudentSubjects(List<List<Object?>> rows) {
    final header = (rows.isEmpty ? <Object?>[] : rows.first).map((h) => '${h ?? ''}'.trim().toLowerCase()).toList();
    int col(List<String> names) => header.indexWhere(names.contains);
    final rollCol = col(['roll no', 'roll number', 'roll_no', 'rollno', 'roll']);
    final regCol = col(['register no', 'register number', 'register_no', 'registerno', 'reg no', 'reg_no', 'regno']);
    final subCol = col(['subject code', 'subject codes', 'subjects', 'subject', 'code', 'codes', 'subject_code']);
    if ((rollCol < 0 && regCol < 0) || subCol < 0) return ImportResult.fail('The first row must name the columns ${studentSubjectImportColumns.join(' and ')}.');
    final body = _body(rows);
    if (body.isEmpty) return const ImportResult.fail('This Excel file has no data rows below the header.');
    var mapped = 0;
    final issues = <({int row, String reason})>[];
    for (final b in body) {
      String cell(int i) => i < 0 || i >= b.r.length ? '' : '${b.r[i] ?? ''}'.trim();
      final roll = cell(rollCol), reg = cell(regCol);
      final student = (roll.isNotEmpty ? db.queryOne('SELECT id FROM students WHERE roll_no = ? COLLATE NOCASE', [roll]) : null) ??
          (reg.isNotEmpty ? db.queryOne('SELECT id FROM students WHERE register_no = ? COLLATE NOCASE', [reg]) : null);
      if (student == null) {
        issues.add((row: b.row, reason: 'No student with ${roll.isNotEmpty ? 'Roll No "$roll"' : 'Register No "$reg"'}.'));
        continue;
      }
      final codes = cell(subCol).split(RegExp(r'[,;\n]+')).map((x) => x.trim()).where((x) => x.isNotEmpty).toList();
      if (codes.isEmpty) {
        issues.add((row: b.row, reason: 'No subject code given.'));
        continue;
      }
      final unknown = <String>[];
      for (final code in codes) {
        final sub = db.queryOne('SELECT id FROM subjects WHERE code = ? COLLATE NOCASE', [code]);
        if (sub == null) {
          unknown.add(code);
          continue;
        }
        db.run('INSERT OR IGNORE INTO student_subjects(student_id, subject_id) VALUES(?,?)', [student['id'], sub['id']]);
        mapped++;
      }
      if (unknown.isNotEmpty) issues.add((row: b.row, reason: 'Subject code(s) not found: ${unknown.join(', ')}'));
    }
    return ImportResult(success: true, inserted: mapped, issues: issues);
  }

  // ── Subject clashes of a session ────────────────────────

  Map<int, Set<int>> _hallSubjects(int sessionId) {
    final out = <int, Set<int>>{};
    final row = db.queryOne('SELECT config FROM seating_configs WHERE session_id = ?', [sessionId]);
    Map config = {};
    try {
      final v = jsonDecode(asStr(row?['config'] ?? '{}'));
      if (v is Map) config = v;
    } catch (_) {}
    if (config['subjects'] == null && config['sessionSubjects'] == null) return out;
    final seats = db.query('''SELECT sa.hall_id, st.id, st.department_id, st.batch,
        (SELECT GROUP_CONCAT(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = st.id) as subject_ids
        FROM seat_allocations sa JOIN students st ON st.id = sa.student_id WHERE sa.session_id = ?''', [sessionId]);
    for (final s in seats) {
      final ids = asStr(s['subject_ids']).split(',').where((x) => x.isNotEmpty).map(int.parse).toList();
      final st = SeatStudent(id: asInt(s['id']), rollNo: '', gender: 'M', batch: asStr(s['batch']), departmentId: asIntOrNull(s['department_id']), subjectIds: ids);
      final sub = sessionSubjectOf(st, config['subjects'], config['sessionSubjects']);
      if (sub == null) continue;
      out.putIfAbsent(asInt(s['hall_id']), () => <int>{}).add(sub.id);
    }
    return out;
  }

  /// Whether a person handles a subject written in a hall of the session; null when unknown.
  SubjectConflict? conflictOf(int sessionId, [List<int>? hallIds]) {
    final inHall = _hallSubjects(sessionId);
    if (inHall.isEmpty) return null;
    if (hallIds != null) {
      final pool = hallIds.toSet();
      final seated = db.query('SELECT DISTINCT hall_id FROM seat_allocations WHERE session_id = ?', [sessionId]).map((r) => asInt(r['hall_id']));
      if (seated.any((h) => !pool.contains(h))) return null;
    }
    final handles = <int, Set<int>>{};
    for (final r in db.query('SELECT user_id, subject_id FROM staff_subjects')) {
      handles.putIfAbsent(asInt(r['user_id']), () => <int>{}).add(asInt(r['subject_id']));
    }
    return (userId, hallId) {
      final mine = handles[userId], there = inHall[hallId];
      return mine != null && there != null && there.any(mine.contains);
    };
  }

  List<SubjectConflictRow> conflicts(int sessionId) {
    final inHall = _hallSubjects(sessionId);
    if (inHall.isEmpty) return [];
    final rows = db.query('''SELECT a.user_id as userId, u.name as userName, u.staff_id as staffId, a.hall_id as hallId, h.hall_code,
            sb.id as subjectId, sb.code as subjectCode, sb.name as subjectName
     FROM allocations a JOIN users u ON u.id = a.user_id JOIN halls h ON h.id = a.hall_id
     JOIN staff_subjects ss ON ss.user_id = a.user_id JOIN subjects sb ON sb.id = ss.subject_id
     WHERE a.session_id = ? ORDER BY h.sort_order, h.id''', [sessionId]);
    return rows
        .where((r) => inHall[asInt(r['hallId'])]?.contains(asInt(r['subjectId'])) ?? false)
        .map((r) => SubjectConflictRow(
            userId: asInt(r['userId']),
            userName: asStr(r['userName']),
            staffId: asStr(r['staffId']),
            hallId: asInt(r['hallId']),
            hallCode: asStr(r['hall_code']),
            subjectId: asInt(r['subjectId']),
            subjectCode: asStr(r['subjectCode']),
            subjectName: asStr(r['subjectName'])))
        .toList();
  }
}
