import 'dart:convert';

import 'package:collection/collection.dart';

import '../core/database.dart';
import '../core/format.dart';
import '../models/domain/categories.dart';
import '../models/domain/hall_layout.dart';
import '../models/domain/seating.dart';
import '../models/domain/seating_report.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';

class SavedSeating {
  final SeatingConfig config;
  final List<int> studentIds;
  final List<UnallocatedStudent> unallocated;
  const SavedSeating(this.config, this.studentIds, this.unallocated);
}

class SessionClass {
  final String key, label, batch;
  final int? departmentId;
  final int count, mapped;
  const SessionClass({required this.key, required this.label, required this.departmentId, required this.batch, required this.count, required this.mapped});
}

class AutoConfigResult {
  final String? error;
  final SeatingConfig? config, separateConfig, rollConfig;
  final List<SessionClass> classes;
  final List<({int id, int count})> mappedSubjects;
  final int boys, girls;
  final String? shortfall;
  const AutoConfigResult({this.error, this.config, this.separateConfig, this.rollConfig, this.classes = const [], this.mappedSubjects = const [], this.boys = 0, this.girls = 0, this.shortfall});
  bool get success => error == null;
}

class PlanStudent {
  final int id;
  final String rollNo, name, gender, batch, year, category;
  final String? deptCode;
  const PlanStudent({required this.id, required this.rollNo, required this.name, required this.gender, required this.batch, this.deptCode, required this.year, required this.category});
}

class PreviewResult {
  final String? error;
  final SeatingConfig? config;
  final SeatingPlan? plan;
  final List<PlanStudent> students;
  final List<String> errors, warnings;
  /// Which rules were met, relaxed or kept students without a seat (and which rule stopped each of them).
  final PlanReport? report;
  const PreviewResult({this.error, this.config, this.plan, this.students = const [], this.errors = const [], this.warnings = const [], this.report});
  bool get success => error == null;
}

class ConfirmResult {
  final bool success, needsConfirmation;
  final String? error;
  final List<UnallocatedStudent> unallocated;
  final List<String> warnings;
  final int seated;
  const ConfirmResult({required this.success, this.needsConfirmation = false, this.error, this.unallocated = const [], this.warnings = const [], this.seated = 0});
}

/// The outcome of moving one student to another seat by hand.
class MoveSeatResult {
  final bool success;
  final String? error;
  /// Every rule the move would break (empty when it is allowed), each naming the students and the bench.
  final List<String> reasons;
  /// The student who was in the target seat and took the seat the mover left (a swap), if any.
  final String? swappedWith;
  const MoveSeatResult({required this.success, this.error, this.reasons = const [], this.swappedWith});
}

class SeatingSelection {
  final int id, cycleId, studentCount;
  final String cycleName, examDate, sessionType;
  final List<int> hallIds;
  const SeatingSelection({required this.id, required this.cycleId, required this.cycleName, required this.examDate, required this.sessionType, required this.studentCount, required this.hallIds});
}

/// The halls whose seating is locked in a session, with their saved seats and bench patterns.
class _Locks {
  final Set<int> halls;
  final List<Seat> seats;
  final Map<int, List<String>> patterns;
  const _Locks(this.halls, this.seats, this.patterns);
  static const none = _Locks({}, [], {});
}

class _SeatingInput {
  final String academicYear;
  final List<SeatHall> halls;
  final List<SeatStudent> students;
  const _SeatingInput(this.academicYear, this.halls, this.students);
}

/// STUDENTS AND SEATING: the student master list and each session's seating plan.
class StudentService {
  StudentService(this.db);
  final AppDatabase db;

  static const _select = '''SELECT s.id, s.roll_no, s.register_no, s.name, s.gender, s.department_id, s.section, s.batch, s.is_active,
    d.code as department_code, d.name as department_name FROM students s LEFT JOIN departments d ON s.department_id = d.id''';

  List<Student> list({String? batch, int? departmentId, String? section, String? gender, bool? isActive}) {
    var sql = '$_select WHERE 1=1';
    final params = <Object?>[];
    if (batch != null) {
      sql += ' AND s.batch = ?';
      params.add(batch);
    }
    if (departmentId != null) {
      sql += ' AND s.department_id = ?';
      params.add(departmentId);
    }
    if (section != null) {
      sql += ' AND s.section = ?';
      params.add(normalizeStudentSection(section));
    }
    if (gender != null) {
      sql += ' AND s.gender = ?';
      params.add(gender);
    }
    if (isActive != null) {
      sql += ' AND s.is_active = ?';
      params.add(isActive);
    }
    final rows = db.query('$sql ORDER BY s.batch, d.code COLLATE NOCASE, s.roll_no', params).map(Student.fromRow).toList();
    mergeSort(rows, compare: (a, b) {
      final c = a.batch.compareTo(b.batch);
      return c != 0 ? c : naturalCompare(a.rollNo, b.rollNo);
    });
    return rows;
  }

  String? _clash(String rollNo, String registerNo, int id) {
    final roll = db.queryOne('SELECT roll_no, name FROM students WHERE roll_no = ? COLLATE NOCASE AND id != ?', [rollNo, id]);
    if (roll != null) return 'Roll Number ${roll['roll_no']} is already used by ${roll['name']}.';
    final reg = db.queryOne('SELECT register_no, name FROM students WHERE register_no = ? COLLATE NOCASE AND id != ?', [registerNo, id]);
    if (reg != null) return 'Register Number ${reg['register_no']} is already used by ${reg['name']}.';
    return null;
  }

  ActionResult<void> save({int? id, required String rollNo, required String registerNo, required String name, required String gender, int? departmentId, required String section, required String batch, bool isActive = true}) {
    final problem = validateStudent(rollNo: rollNo, registerNo: registerNo, name: name, gender: gender, section: section, batch: batch);
    if (problem != null) return ActionResult.fail(problem);
    final roll = rollNo.trim(), reg = registerNo.trim(), nm = name.trim().replaceAll(RegExp(r'\s+'), ' ');
    final g = parseGender(gender)!, sec = normalizeStudentSection(section), b = normalizeStudentBatch(batch);
    if (departmentId == null || departmentId == 0) return const ActionResult.fail('Department is required.');
    final clash = _clash(roll, reg, id ?? 0);
    if (clash != null) return ActionResult.fail(clash);
    if (id != null) {
      db.run("UPDATE students SET roll_no=?, register_no=?, name=?, gender=?, department_id=?, section=?, batch=?, is_active=?, updated_at=datetime('now') WHERE id=?",
          [roll, reg, nm, g, departmentId, sec, b, isActive, id]);
    } else {
      db.run('INSERT INTO students(roll_no, register_no, name, gender, department_id, section, batch, is_active) VALUES(?,?,?,?,?,?,?,1)', [roll, reg, nm, g, departmentId, sec, b]);
    }
    return const ActionResult.ok();
  }

  ActionResult<void> delete(int id) {
    if (db.queryOne('SELECT id FROM seat_allocations WHERE student_id = ? LIMIT 1', [id]) != null) {
      return const ActionResult.fail('This student has seating records, so they cannot be deleted. Edit them and untick Active instead.');
    }
    db.run('DELETE FROM students WHERE id = ?', [id]);
    return const ActionResult.ok();
  }

  static const importColumns = ['Roll No', 'Register No', 'Name', 'Gender', 'Department', 'Section', 'Batch'];

  ImportResult importStudents(List<List<Object?>> rows) {
    final header = (rows.isEmpty ? <Object?>[] : rows.first).map((h) => '${h ?? ''}'.trim().toLowerCase()).toList();
    int col(List<String> names) => header.indexWhere(names.contains);
    final idx = [
      col(['roll no', 'roll number', 'roll_no', 'rollno', 'roll']),
      col(['register no', 'register number', 'register_no', 'registerno', 'reg no', 'reg number', 'reg_no', 'regno']),
      col(['name', 'student name', 'full name']),
      col(['gender', 'sex']),
      col(['department', 'department code', 'dept', 'dept code', 'department_code']),
      col(['section', 'sec', 'class section']),
      col(['batch', 'student batch', 'batch year', 'batch years']),
    ];
    final missing = [for (var i = 0; i < idx.length; i++) if (idx[i] == -1) importColumns[i]];
    if (missing.isNotEmpty) {
      return ImportResult.fail('This Excel file is missing required column(s): ${missing.join(', ')}. The first row must name the columns ${importColumns.join(', ')}.',
          missingColumns: missing);
    }
    final body = [for (var i = 1; i < rows.length; i++) if (rows[i].any((c) => '${c ?? ''}'.trim().isNotEmpty)) (r: rows[i], row: i + 1)];
    if (body.isEmpty) return const ImportResult.fail('This Excel file has no data rows below the header.');
    var inserted = 0;
    final issues = <({int row, String reason})>[];
    for (final b in body) {
      String cell(int i) => i < 0 || i >= b.r.length ? '' : '${b.r[i] ?? ''}'.trim();
      final dept = cell(idx[4]);
      if (dept.isEmpty) {
        issues.add((row: b.row, reason: 'Missing Department'));
        continue;
      }
      final d = db.queryOne('SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE ORDER BY (code = ? COLLATE NOCASE) DESC, id LIMIT 1', [dept, dept, dept]);
      if (d == null) {
        issues.add((row: b.row, reason: 'Department "$dept" does not match any existing department (check Master Data → Departments).'));
        continue;
      }
      final r = save(rollNo: cell(idx[0]), registerNo: cell(idx[1]), name: cell(idx[2]), gender: cell(idx[3]), departmentId: asInt(d['id']), section: cell(idx[5]), batch: cell(idx[6]));
      if (r.success) {
        inserted++;
      } else {
        issues.add((row: b.row, reason: '${r.error}${cell(idx[0]).isNotEmpty ? ' (Roll No "${cell(idx[0])}")' : ''}'));
      }
    }
    return ImportResult(success: true, inserted: inserted, issues: issues);
  }

  // ── Session seating ─────────────────────────────────────

  List<SeatHall> _sessionHalls(int sessionId) => db
      .query('SELECT DISTINCT h.* FROM allocations a JOIN halls h ON h.id = a.hall_id WHERE a.session_id = ? ORDER BY h.sort_order, h.id', [sessionId])
      .map((h) => SeatHall(asInt(h['id']), asStr(h['hall_code']), hallLayoutOf(h)))
      .toList();

  String? _academicYear(int sessionId) =>
      asStrOrNull(db.queryOne('SELECT ec.academic_year FROM exam_sessions es JOIN exam_cycles ec ON ec.id = es.cycle_id WHERE es.id = ?', [sessionId])?['academic_year']);

  Object _input(int sessionId, List<int> studentIds) {
    if (db.queryOne('SELECT id FROM exam_sessions WHERE id = ?', [sessionId]) == null) return 'Exam session not found.';
    final ids = studentIds.toSet().toList();
    if (ids.isEmpty) return 'Select the students writing this session.';
    final halls = _sessionHalls(sessionId);
    if (halls.isEmpty) return 'Generate the invigilator allocation first: students are seated in the same halls.';
    final marks = List.filled(ids.length, '?').join(',');
    final rows = db.query('''SELECT s.id, s.roll_no, s.name, s.gender, s.batch, s.department_id, s.is_active, d.code as dept_code
       FROM students s LEFT JOIN departments d ON d.id = s.department_id WHERE s.id IN ($marks)''', ids);
    if (rows.length != ids.length) return 'Some of the selected students no longer exist. Reopen the selection and try again.';
    final inactive = rows.where((s) => !asBool(s['is_active'])).toList();
    if (inactive.isNotEmpty) {
      return 'Inactive students cannot be seated: ${inactive.take(5).map((s) => s['roll_no']).join(', ')}${inactive.length > 5 ? '…' : ''}.';
    }
    final mapped = <int, List<int>>{};
    for (final r in db.query('SELECT student_id, subject_id FROM student_subjects WHERE student_id IN ($marks)', ids)) {
      mapped.putIfAbsent(asInt(r['student_id']), () => []).add(asInt(r['subject_id']));
    }
    final students = rows
        .map((s) => SeatStudent(
              id: asInt(s['id']),
              rollNo: asStr(s['roll_no']),
              name: asStrOrNull(s['name']),
              gender: asStr(s['gender']),
              batch: asStr(s['batch']),
              departmentId: asIntOrNull(s['department_id']),
              deptCode: asStrOrNull(s['dept_code']),
              subjectIds: mapped[asInt(s['id'])],
            ))
        .toList();
    return _SeatingInput(_academicYear(sessionId) ?? '', halls, students);
  }

  SavedSeating? savedSeating(int sessionId) {
    final row = db.queryOne('SELECT config, student_ids, unallocated FROM seating_configs WHERE session_id = ?', [sessionId]);
    if (row == null) return null;
    Object? parse(Object? text) {
      try {
        return jsonDecode(asStr(text));
      } catch (_) {
        return null;
      }
    }

    final ids = parse(row['student_ids']);
    final un = parse(row['unallocated']);
    return SavedSeating(
      SeatingConfig.fromJson(parse(row['config'])),
      ids is List ? ids.whereType<num>().map((e) => e.toInt()).toList() : const [],
      un is List ? un.whereType<Map>().map(UnallocatedStudent.fromJson).toList() : const [],
    );
  }

  AutoConfigResult autoConfigureSeating(int sessionId, List<int> studentIds, {ClassLimit? classLimit, Map<String, int>? subjects, List<int>? sessionSubjects}) {
    final raw = _input(sessionId, studentIds);
    if (raw is String) return AutoConfigResult(error: raw);
    final input = raw as _SeatingInput;
    final all = applySessionSubjects(input.students, subjects, sessionSubjects);
    // Students in a locked hall keep their seat: the configuration is worked out for the others, in the other halls.
    final locks = _locks(sessionId, input);
    final kept = locks.seats.map((x) => x.studentId).toSet();
    final students = locks.halls.isEmpty ? all : all.where((s) => !kept.contains(s.id)).toList();
    final halls = input.halls.where((h) => !locks.halls.contains(h.id)).toList();
    final boys = students.where((s) => s.gender == 'M').length;
    SeatingConfig configure({bool separateOnly = false, bool mixGenders = false}) {
      if (halls.isEmpty || students.isEmpty) return SeatingConfig(halls: [for (final h in halls) HallSeatingConfig(h.id, const [])], classLimit: normalizeClassLimit(classLimit));
      return autoConfigure(students, halls, separateOnly: separateOnly, mixGenders: mixGenders, classLimit: classLimit);
    }

    return AutoConfigResult(
      classes: _sessionClasses(input.students, input.academicYear, sessionSubjects),
      mappedSubjects: _mappedSubjectCounts(input.students),
      config: configure(),
      separateConfig: configure(separateOnly: true),
      rollConfig: configure(mixGenders: true),
      boys: boys,
      girls: students.length - boys,
      shortfall: students.isEmpty ? null : (halls.isEmpty ? 'Every hall is locked: unlock a hall to seat the other students.' : seatingShortfall(students, halls, classLimit)),
    );
  }

  List<SessionClass> _sessionClasses(List<SeatStudent> students, String academicYear, List<int>? sessionSubjects) {
    final out = <String, ({String key, String label, int? dept, String batch, int count, int mapped})>{};
    for (final s in students) {
      final cat = studentCategory(s, academicYear);
      final e = out[cat.key] ?? (key: cat.key, label: cat.label, dept: s.departmentId, batch: s.batch, count: 0, mapped: 0);
      final m = sessionSubjectOf(s, const {}, sessionSubjects) != null ? 1 : 0;
      out[cat.key] = (key: e.key, label: e.label, dept: e.dept, batch: e.batch, count: e.count + 1, mapped: e.mapped + m);
    }
    final list = out.values.map((e) => SessionClass(key: e.key, label: e.label, departmentId: e.dept, batch: e.batch, count: e.count, mapped: e.mapped)).toList();
    mergeSort(list, compare: (a, b) {
      final c = a.batch.compareTo(b.batch);
      return c != 0 ? c : textCompare(a.label, b.label);
    });
    return list;
  }

  List<({int id, int count})> _mappedSubjectCounts(List<SeatStudent> students) {
    final counts = <int, int>{};
    for (final s in students) {
      for (final id in s.subjectIds ?? const <int>[]) {
        counts[id] = (counts[id] ?? 0) + 1;
      }
    }
    return [for (final e in counts.entries) (id: e.key, count: e.value)];
  }

  /// The locked halls of a session that are still halls of the session, with the seats saved in them.
  _Locks _locks(int sessionId, _SeatingInput input) {
    final saved = savedSeating(sessionId);
    if (saved == null || saved.config.lockedHalls.isEmpty) return _Locks.none;
    final inSession = input.halls.map((h) => h.id).toSet();
    final halls = saved.config.lockedHalls.where(inSession.contains).toSet();
    if (halls.isEmpty) return _Locks.none;
    final seats = db
        .query('SELECT student_id, hall_id, bench_row, bench_col, bench_no, seat FROM seat_allocations WHERE session_id = ?', [sessionId])
        .where((r) => halls.contains(asInt(r['hall_id'])))
        .map((r) => Seat(studentId: asInt(r['student_id']), hallId: asInt(r['hall_id']), row: asInt(r['bench_row']), col: asInt(r['bench_col']), benchNo: asInt(r['bench_no']), seat: asStr(r['seat'])))
        .toList();
    final patterns = {for (final c in saved.config.halls) if (halls.contains(c.hallId)) c.hallId: c.pattern};
    return _Locks(halls, seats, patterns);
  }

  PreviewResult _build(_SeatingInput raw, SeatingConfig rawConfig, [_Locks locks = _Locks.none]) {
    // Locked halls keep the bench pattern they were seated with; only the other halls take the configuration given.
    final merged = locks.halls.isEmpty
        ? rawConfig
        : rawConfig.copyWith(
            halls: [
              ...rawConfig.halls.where((h) => !locks.halls.contains(h.hallId)),
              for (final id in locks.halls) HallSeatingConfig(id, locks.patterns[id] ?? const []),
            ],
            lockedHalls: locks.halls.toList()..sort());
    final config = normalizeConfig(merged, raw.halls);
    final students = applySessionSubjects(raw.students, config.subjects, config.sessionSubjects);
    final twice = raw.students.where((s) => (sessionSubjectOf(s, config.subjects, config.sessionSubjects)?.also.length ?? 0) > 0).toList();
    final twiceWarning = twice.isEmpty
        ? <String>[]
        : [
            '${twice.length} student(s) are mapped to more than one subject of this exam and are seated for the first one chosen: ${twice.take(5).map((s) => s.rollNo).join(', ')}${twice.length > 5 ? '…' : ''}. Check their subjects in Master Data → Subjects.'
          ];
    final plan = locks.halls.isEmpty ? planSeating(students, raw.halls, config, raw.academicYear) : planSeatingWithLocks(students, raw.halls, config, raw.academicYear, locks.seats);
    final checked = checkConfig(config, raw.halls, students);
    final valid = validateSeatingPlan(plan.seats, plan.unallocated, students, raw.halls, config);
    // Which rules were kept, which relaxed, and which one stopped each student left without a seat: never silent.
    final subjectNames = {for (final r in db.query('SELECT id, code, name FROM subjects')) 'sub:${asInt(r['id'])}': '${asStr(r['code'])} ${asStr(r['name'])}'.trim()};
    final report = reportPlan(
      students: students,
      halls: raw.halls,
      config: config,
      academicYear: raw.academicYear,
      plan: plan,
      lockedSeats: locks.seats,
      classLabel: (st) => st.paper != null ? 'Subject ${subjectNames[st.paper] ?? st.paper}' : studentCategory(st, raw.academicYear).label,
    );
    final reported = SeatingPlan(seats: plan.seats, hallGender: plan.hallGender, halls: plan.halls, unallocated: report.unallocated, warnings: plan.warnings, groups: plan.groups);
    final info = students.map((s) {
      final y = yearOfStudy(s.batch, raw.academicYear);
      return PlanStudent(id: s.id, rollNo: s.rollNo, name: s.name ?? '', gender: s.gender, batch: s.batch, deptCode: s.deptCode, year: y.ok ? y.label : '', category: studentCategory(s, raw.academicYear).label);
    }).toList();
    return PreviewResult(config: config, plan: reported, students: info, errors: [...checked.errors, ...valid], warnings: [...checked.warnings, ...plan.warnings, ...twiceWarning], report: report);
  }

  PreviewResult preview(int sessionId, List<int> studentIds, SeatingConfig config) {
    final input = _input(sessionId, studentIds);
    if (input is String) return PreviewResult(error: input);
    return _build(input as _SeatingInput, config, _locks(sessionId, input));
  }

  /// Makes the plan again, checks it and saves it, replacing any earlier one (one transaction).
  ConfirmResult confirm(int sessionId, List<int> studentIds, SeatingConfig config, {bool acceptUnallocated = false}) {
    final input = _input(sessionId, studentIds);
    if (input is String) return ConfirmResult(success: false, error: input);
    final inp = input as _SeatingInput;
    final built = _build(inp, config, _locks(sessionId, inp));
    final plan = built.plan!;
    if (built.errors.isNotEmpty) return ConfirmResult(success: false, error: 'The seating plan cannot be saved: ${built.errors.first}');
    if (plan.seats.isEmpty) return const ConfirmResult(success: false, error: 'No student can be seated with this configuration. Give the halls a bench pattern: boys, girls, or both.');
    final shortfall = unallocatedMessage(plan.unallocated);
    if (shortfall != null && !acceptUnallocated) return ConfirmResult(success: false, needsConfirmation: true, error: shortfall, unallocated: plan.unallocated);
    try {
      db.transaction(() {
        db.run('DELETE FROM seat_allocations WHERE session_id = ?', [sessionId]);
        for (final s in plan.seats) {
          db.run('INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)',
              [sessionId, s.studentId, s.hallId, s.row, s.col, s.benchNo, s.seat]);
        }
        db.run('DELETE FROM seating_configs WHERE session_id = ?', [sessionId]);
        db.run('INSERT INTO seating_configs(session_id, config, student_ids, unallocated) VALUES(?,?,?,?)', [
          sessionId,
          jsonEncode(built.config!.toJson()),
          jsonEncode(inp.students.map((s) => s.id).toList()),
          jsonEncode(plan.unallocated.map((u) => u.toJson()).toList()),
        ]);
      });
    } catch (e) {
      return ConfirmResult(success: false, error: 'The seating plan could not be saved, so the previous plan was kept unchanged. ($e)');
    }
    return ConfirmResult(success: true, warnings: [...plan.warnings, ...built.report!.warnings], seated: plan.seats.length, unallocated: plan.unallocated);
  }

  /// Locks or unlocks halls of the session's saved plan. A locked hall keeps its students and their seats when the
  /// session is seated again; only a hall that has students can be locked. Returns an error message, or null.
  String? setHallsLocked(int sessionId, List<int> hallIds, bool locked) {
    final saved = savedSeating(sessionId);
    if (saved == null) return 'This session has no seating plan to lock.';
    final withStudents = db.query('SELECT DISTINCT hall_id FROM seat_allocations WHERE session_id = ?', [sessionId]).map((r) => asInt(r['hall_id'])).toSet();
    final now = saved.config.lockedHalls.toSet();
    if (locked) {
      final empty = hallIds.where((id) => !withStudents.contains(id)).toList();
      if (empty.isNotEmpty) return 'Only a hall that has students can be locked.';
      now.addAll(hallIds);
    } else {
      now.removeAll(hallIds);
    }
    db.run('UPDATE seating_configs SET config = ? WHERE session_id = ?', [jsonEncode(saved.config.copyWith(lockedHalls: now.toList()..sort()).toJson()), sessionId]);
    return null;
  }

  /// Seats everyone selected for the session who is not in a locked hall, in the halls that are not locked, and saves
  /// the plan: locked halls stay exactly as they are. For when the students or the available halls have changed.
  ConfirmResult regenerateRemaining(int sessionId) {
    final saved = savedSeating(sessionId);
    if (saved == null || saved.studentIds.isEmpty) return const ConfirmResult(success: false, error: 'This session has no seating plan to regenerate.');
    final auto = autoConfigureSeating(sessionId, saved.studentIds, classLimit: saved.config.classLimit, subjects: saved.config.subjects, sessionSubjects: saved.config.sessionSubjects);
    if (!auto.success) return ConfirmResult(success: false, error: auto.error);
    final config = auto.config!.copyWith(classLimit: saved.config.classLimit, subjects: saved.config.subjects, sessionSubjects: saved.config.sessionSubjects);
    return confirm(sessionId, saved.studentIds, config, acceptUnallocated: true);
  }

  /// Moves one seated student to another seat of the session's halls, by hand. A taken target seat is a swap:
  /// its student takes the seat the mover leaves. Every rule is checked again on the plan as it would be after
  /// the move, by the same validator that checks a generated plan; the move is refused with the reasons when it
  /// would break any rule that the plan did not already break, and nothing is changed.
  MoveSeatResult moveSeat(int sessionId, int studentId, {required int hallId, required int row, required int col, required String seat}) {
    final saved = savedSeating(sessionId);
    if (saved == null) return const MoveSeatResult(success: false, error: 'This session has no seating plan to edit.');
    final input = _input(sessionId, saved.studentIds);
    if (input is String) return MoveSeatResult(success: false, error: input);
    final inp = input as _SeatingInput;
    final config = normalizeConfig(saved.config, inp.halls);
    final students = applySessionSubjects(inp.students, config.subjects, config.sessionSubjects);

    final current = db
        .query('SELECT student_id, hall_id, bench_row, bench_col, bench_no, seat FROM seat_allocations WHERE session_id = ?', [sessionId])
        .map((r) => Seat(studentId: asInt(r['student_id']), hallId: asInt(r['hall_id']), row: asInt(r['bench_row']), col: asInt(r['bench_col']), benchNo: asInt(r['bench_no']), seat: asStr(r['seat'])))
        .toList();
    final mover = current.firstWhereOrNull((x) => x.studentId == studentId);
    if (mover == null) return const MoveSeatResult(success: false, error: 'Only a seated student can be moved.');
    String codeOf(int id) => inp.halls.firstWhereOrNull((h) => h.id == id)?.hallCode ?? '#$id';
    for (final id in {mover.hallId, hallId}) {
      if (saved.config.lockedHalls.contains(id)) {
        return MoveSeatResult(success: false, error: 'Hall ${codeOf(id)} is locked. Unlock it to change its seating.');
      }
    }

    final hall = inp.halls.firstWhereOrNull((h) => h.id == hallId);
    if (hall == null) return const MoveSeatResult(success: false, error: 'That hall is not one of the halls of this session.');
    final bench = enabledBenches(hall.layout).firstWhereOrNull((b) => b.row == row && b.col == col);
    if (bench == null) return MoveSeatResult(success: false, error: 'Hall ${hall.hallCode} has no bench there.');
    if (seat != 'L' && seat != 'R') return const MoveSeatResult(success: false, error: 'Choose the left or the right seat.');
    if (seat == 'R' && bench.seats == 1) return MoveSeatResult(success: false, error: 'Hall ${hall.hallCode}, seat ${bench.benchNo} is a single chair: it has no right seat.');
    if (mover.hallId == hallId && mover.row == row && mover.col == col && mover.seat == seat) return const MoveSeatResult(success: false, error: 'The student is already in that seat.');

    final occupant = current.firstWhereOrNull((x) => x.hallId == hallId && x.row == row && x.col == col && x.seat == seat);
    final after = [
      for (final x in current)
        if (x.studentId == studentId)
          Seat(studentId: studentId, hallId: hallId, row: row, col: col, benchNo: bench.benchNo, seat: seat)
        else if (occupant != null && x.studentId == occupant.studentId)
          Seat(studentId: x.studentId, hallId: mover.hallId, row: mover.row, col: mover.col, benchNo: mover.benchNo, seat: mover.seat)
        else
          x
    ];

    // Only what the move itself breaks counts: a plan that already had a problem is not blamed on this move.
    final before = validateSeatingPlan(current, saved.unallocated, students, inp.halls, config).toSet();
    final broken = validateSeatingPlan(after, saved.unallocated, students, inp.halls, config).where((e) => !before.contains(e)).toList();
    if (broken.isNotEmpty) return MoveSeatResult(success: false, error: 'This move is not allowed: ${broken.first}', reasons: broken);

    final other = occupant == null ? null : students.firstWhereOrNull((x) => x.id == occupant.studentId)?.rollNo;
    try {
      db.transaction(() {
        // Delete first: the table refuses a student or a seat used twice, even for a moment during a swap.
        for (final x in current.where((x) => x.studentId == studentId || x.studentId == occupant?.studentId)) {
          db.run('DELETE FROM seat_allocations WHERE session_id = ? AND student_id = ?', [sessionId, x.studentId]);
        }
        for (final x in after.where((x) => x.studentId == studentId || x.studentId == occupant?.studentId)) {
          db.run('INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)',
              [sessionId, x.studentId, x.hallId, x.row, x.col, x.benchNo, x.seat]);
        }
      });
    } catch (e) {
      return MoveSeatResult(success: false, error: 'The move could not be saved, so the seating was left unchanged. ($e)');
    }
    return MoveSeatResult(success: true, swappedWith: other);
  }

  /// The saved seating of a session, in hall and bench order, with each student's academic year.
  List<SeatRow> sessionSeating(int sessionId) {
    final academicYear = _academicYear(sessionId);
    return db.query('''SELECT sa.student_id as studentId, st.roll_no, st.register_no, st.name as studentName, st.gender, st.batch,
            d.code as deptCode, d.name as deptName, sa.hall_id as hallId, h.hall_code, h.block as hallBlock, h.floor as hallFloor,
            sa.bench_row, sa.bench_col, sa.bench_no, sa.seat
     FROM seat_allocations sa JOIN students st ON st.id = sa.student_id JOIN halls h ON h.id = sa.hall_id
     LEFT JOIN departments d ON d.id = st.department_id
     WHERE sa.session_id = ? ORDER BY h.sort_order, h.id, sa.bench_no, sa.seat''', [sessionId]).map((r) {
      final y = yearOfStudy(asStr(r['batch']), academicYear);
      final year = y.ok ? y.label : '';
      return SeatRow(
        studentId: asInt(r['studentId']),
        rollNo: asStr(r['roll_no']),
        registerNo: asStr(r['register_no']),
        studentName: asStr(r['studentName']),
        gender: asStr(r['gender']),
        batch: asStr(r['batch']),
        deptCode: asStrOrNull(r['deptCode']),
        deptName: asStrOrNull(r['deptName']),
        hallId: asInt(r['hallId']),
        hallCode: asStr(r['hall_code']),
        hallBlock: asStrOrNull(r['hallBlock']),
        hallFloor: asStrOrNull(r['hallFloor']),
        benchRow: asInt(r['bench_row']),
        benchCol: asInt(r['bench_col']),
        benchNo: asInt(r['bench_no']),
        seat: asStr(r['seat']),
        year: year,
        category: categoryLabel(asStrOrNull(r['deptCode']), year.isEmpty ? asStr(r['batch']) : year),
      );
    }).toList();
  }

  void clear(int sessionId) {
    db.run('DELETE FROM seat_allocations WHERE session_id = ?', [sessionId]);
    db.run('DELETE FROM seating_configs WHERE session_id = ?', [sessionId]);
  }

  /// "Same as previous exam": exactly the seating of another session (same halls only).
  ConfirmResult copy(int sessionId, int fromSessionId) {
    if (sessionId == fromSessionId) return const ConfirmResult(success: false, error: 'Choose a different exam to copy the seating from.');
    final rows = db.query('SELECT student_id, hall_id, bench_row, bench_col, bench_no, seat FROM seat_allocations WHERE session_id = ?', [fromSessionId]);
    if (rows.isEmpty) return const ConfirmResult(success: false, error: 'That exam has no seating plan to copy.');
    List<DbRow> hallsOf(int id) => db.query('SELECT DISTINCT h.* FROM allocations a JOIN halls h ON h.id = a.hall_id WHERE a.session_id = ? ORDER BY h.hall_code', [id]);
    final here = hallsOf(sessionId), there = hallsOf(fromSessionId);
    String codes(List<DbRow> l) => l.isEmpty ? 'none' : l.map((h) => h['hall_code']).join(', ');
    if (codes(here) != codes(there)) {
      return ConfirmResult(success: false, error: 'The seating can be copied only between exams with the same halls. The previous exam has ${codes(there)}; this exam has ${codes(here)}.');
    }
    final halls = {for (final h in here) asInt(h['id']): h};
    final usedHalls = rows.map((r) => asInt(r['hall_id'])).toSet();
    final benches = {
      for (final id in usedHalls)
        id: {
          for (final b in enabledBenches(hallLayoutOf(halls[id]!)))
            for (final side in (b.seats == 2 ? const ['L', 'R'] : const ['L'])) '${benchKey(b.row, b.col)}-$side'
        }
    };
    final gone = rows.where((r) => !benches[asInt(r['hall_id'])]!.contains('${benchKey(asInt(r['bench_row']), asInt(r['bench_col']))}-${r['seat']}')).toList();
    if (gone.isNotEmpty) {
      final c = gone.map((r) => halls[asInt(r['hall_id'])]!['hall_code']).toSet();
      return ConfirmResult(success: false, error: 'The bench layout of ${c.join(', ')} has changed since the previous exam, so its seats cannot be reused. Configure the seating afresh.');
    }
    final config = db.queryOne('SELECT config, student_ids, unallocated FROM seating_configs WHERE session_id = ?', [fromSessionId]);
    // Locks belong to the plan they were made for: a copy starts with every hall unlocked.
    final copiedConfig = config == null ? null : jsonEncode(SeatingConfig.fromJson(jsonDecode(asStr(config['config']))).copyWith(lockedHalls: const []).toJson());
    try {
      db.transaction(() {
        db.run('DELETE FROM seat_allocations WHERE session_id = ?', [sessionId]);
        for (final r in rows) {
          db.run('INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)',
              [sessionId, r['student_id'], r['hall_id'], r['bench_row'], r['bench_col'], r['bench_no'], r['seat']]);
        }
        db.run('DELETE FROM seating_configs WHERE session_id = ?', [sessionId]);
        if (config != null) {
          db.run('INSERT INTO seating_configs(session_id, config, student_ids, unallocated) VALUES(?,?,?,?)', [sessionId, copiedConfig, config['student_ids'], config['unallocated']]);
        }
      });
    } catch (e) {
      return ConfirmResult(success: false, error: 'The seating could not be copied, so this exam\'s plan was kept unchanged. ($e)');
    }
    var unallocated = <UnallocatedStudent>[];
    try {
      final v = jsonDecode(asStr(config?['unallocated'] ?? '[]'));
      if (v is List) unallocated = v.whereType<Map>().map(UnallocatedStudent.fromJson).toList();
    } catch (_) {}
    return ConfirmResult(success: true, seated: rows.length, unallocated: unallocated);
  }

  /// Sessions that have a seating plan, newest first, with the halls of their invigilator allocation.
  List<SeatingSelection> selections() {
    return db.query('''SELECT es.id, es.cycle_id as cycleId, ec.name as cycleName, es.exam_date, es.session_type,
            COUNT(sa.id) as seated, sc.student_ids,
            (SELECT GROUP_CONCAT(DISTINCT a.hall_id) FROM allocations a WHERE a.session_id = es.id) as halls
     FROM exam_sessions es JOIN exam_cycles ec ON es.cycle_id = ec.id
     LEFT JOIN seat_allocations sa ON sa.session_id = es.id LEFT JOIN seating_configs sc ON sc.session_id = es.id
     WHERE sa.id IS NOT NULL OR sc.session_id IS NOT NULL
     GROUP BY es.id
     ORDER BY es.exam_date DESC, CASE es.session_type WHEN 'FN' THEN 1 ELSE 0 END, es.id DESC''').map((r) {
      Object? selected;
      try {
        selected = jsonDecode(asStr(r['student_ids'] ?? 'null'));
      } catch (_) {}
      final hallIds = asStr(r['halls']).split(',').where((x) => x.isNotEmpty).map(int.parse).toList()..sort();
      return SeatingSelection(
        id: asInt(r['id']),
        cycleId: asInt(r['cycleId']),
        cycleName: asStr(r['cycleName']),
        examDate: asStr(r['exam_date']),
        sessionType: asStr(r['session_type']),
        studentCount: selected is List ? selected.length : asInt(r['seated']),
        hallIds: hallIds,
      );
    }).toList();
  }

  /// After the invigilator allocation is regenerated: seating made for other halls is removed.
  bool dropSeatingIfHallsChanged(int sessionId) {
    final seatHalls = db.query('SELECT DISTINCT hall_id FROM seat_allocations WHERE session_id = ?', [sessionId]).map((r) => asInt(r['hall_id'])).toList();
    if (seatHalls.isEmpty) return false;
    final halls = db.query('SELECT hall_id FROM allocations WHERE session_id = ?', [sessionId]).map((r) => asInt(r['hall_id'])).toSet();
    if (seatHalls.every(halls.contains)) return false;
    final saved = savedSeating(sessionId);
    final keep = (saved?.config.lockedHalls ?? const <int>[]).where(halls.contains).toSet();
    if (saved == null || keep.isEmpty) {
      clear(sessionId);
      return true;
    }
    // Locked halls that are still in the session keep their seats; the rest is removed and has to be seated again
    // (Regenerate remaining): the students of the removed halls have no seat until then.
    final marks = List.filled(keep.length, '?').join(',');
    db.run('DELETE FROM seat_allocations WHERE session_id = ? AND hall_id NOT IN ($marks)', [sessionId, ...keep]);
    db.run('UPDATE seating_configs SET config = ?, unallocated = ? WHERE session_id = ?', [jsonEncode(saved.config.copyWith(lockedHalls: keep.toList()..sort()).toJson()), '[]', sessionId]);
    return true;
  }
}
