import '../models/domain/hall_layout.dart';
import '../services/app_services.dart';
import '../services/cycle_service.dart';

String _date(int daysAhead) {
  var d = DateTime.now().add(Duration(days: daysAhead));
  if (d.weekday == DateTime.sunday) d = d.add(const Duration(days: 1));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// More data for exploring every option: extra departments, staff (one inactive), halls (one inactive), classes
/// (a girls-only class, an inactive student), electives that cut across classes, a registrar for deleting batches,
/// a draft invigilator allocation to confirm, and a second batch. Safe to call again: it does nothing the second time.
void seedDemoExtras(AppServices s) {
  final m = s.master;
  if (m.departments().any((d) => d.code == 'IT')) return;
  for (final d in const [('IT', 'Information Technology'), ('CIVIL', 'Civil Engineering')]) {
    m.saveDepartment(code: d.$1, name: d.$2);
  }
  final dept = {for (final d in m.departments()) d.code: d.id};

  const staff = [
    ('STF010', 'N. Divya', 'Assistant Professor', 'IT'),
    ('STF011', 'G. Karthik', 'Associate Professor', 'IT'),
    ('STF012', 'B. Sheela', 'Professor', 'IT'),
    ('STF013', 'D. Vignesh', 'Assistant Professor', 'CIVIL'),
    ('STF014', 'L. Janani', 'Assistant Professor', 'CIVIL'),
    ('STF015', 'R. Murugan', 'Professor', 'CIVIL'),
    ('STF016', 'C. Nithya', 'Assistant Professor', 'CSE'),
    ('STF017', 'H. Imran', 'Assistant Professor', 'ECE'),
    ('STF018', 'E. Stephen', 'Associate Professor', 'MECH'),
    ('REG001', 'Dr. S. Registrar', 'Registrar', 'CSE'),
  ];
  for (final x in staff) {
    m.saveStaff(staffId: x.$1, name: x.$2, designation: x.$3, email: '${x.$1.toLowerCase()}@college.edu', departmentId: dept[x.$4]);
  }
  final staffId = {for (final u in m.staff()) u.staffId: u.id};
  m.deactivateStaff(staffId['STF018']!);

  m.saveHall(hallCode: 'H301', block: 'New Block', floor: '2nd', layout: const HallLayout(rows: 5, cols: 3));
  m.saveHall(hallCode: 'H302', block: 'New Block', floor: '2nd', layout: const HallLayout(rows: 5, cols: 3));
  m.saveHall(hallCode: 'SEM', block: 'Admin Block', floor: 'Ground', layout: const HallLayout(rows: 3, cols: 2));
  m.saveHall(hallCode: 'OLD1', block: 'Old Block', floor: 'Ground', layout: const HallLayout(rows: 4, cols: 3));
  final old = m.halls().firstWhere((h) => h.hallCode == 'OLD1');
  m.saveHall(id: old.id, hallCode: old.hallCode, block: old.block, floor: old.floor, isActive: false, layout: old.layout);

  const first = ['Aruna', 'Bharath', 'Chitra', 'Dinesh', 'Elango', 'Fathima', 'Gokul', 'Harini', 'Ilango', 'Jeeva', 'Kavin', 'Latha', 'Madhan', 'Nila', 'Oli', 'Pavithra', 'Rohit', 'Sudha', 'Tamil', 'Uma'];
  var reg = 961300000;
  // (department, batch, roll prefix, count, girls only)
  const classes = [('IT', '2024-2028', '24IT', 20, false), ('CIVIL', '2024-2028', '24CE', 15, true), ('ECE', '2023-2027', '23EC', 18, false)];
  for (final c in classes) {
    for (var i = 0; i < c.$4; i++) {
      s.students.save(
        rollNo: '${c.$3}${(i + 1).toString().padLeft(3, '0')}',
        registerNo: '${reg++}',
        name: '${first[i % first.length]} ${String.fromCharCode(65 + (i % 26))}',
        gender: c.$5 || i.isEven ? 'F' : 'M',
        departmentId: dept[c.$1],
        section: i < c.$4 ~/ 2 ? 'A' : 'B',
        batch: c.$2,
      );
    }
  }
  // One student who has left: kept on record, never seated.
  final left = s.students.list().firstWhere((x) => x.rollNo == '24IT020');
  s.students.save(id: left.id, rollNo: left.rollNo, registerNo: left.registerNo, name: left.name, gender: left.gender, departmentId: left.departmentId, section: left.section, batch: left.batch, isActive: false);

  const subjects = [
    ('IT3401', 'Data Structures', 'IT', ['STF010', 'STF011']),
    ('IT3301', 'Database Management Systems', 'IT', ['STF012']),
    ('CE3301', 'Strength of Materials', 'CIVIL', ['STF013', 'STF014']),
    ('EC3301', 'Electronic Circuits', 'ECE', ['STF006', 'STF017']),
    ('OE1001', 'Open Elective: Python Programming', null, ['STF016', 'STF015']),
  ];
  for (final x in subjects) {
    s.subjects.save(code: x.$1, name: x.$2, departmentId: x.$3 == null ? null : dept[x.$3], staffIds: [for (final id in x.$4) staffId[id]!]);
  }
  final subj = {for (final x in s.subjects.list()) x.code: x.id};
  final all = s.students.list();
  List<int> of(String prefix) => all.where((x) => x.rollNo.startsWith(prefix)).map((x) => x.id).toList();
  s.subjects.setStudents(subj['IT3401']!, of('24IT'));
  s.subjects.setStudents(subj['CE3301']!, of('24CE'));
  s.subjects.setStudents(subj['EC3301']!, of('23EC'));
  s.subjects.setStudents(subj['EC3401']!, of('22EC'));
  s.subjects.setStudents(subj['ME3301']!, of('23ME'));
  // An elective written by students of several classes, so those classes have more than one subject.
  s.subjects.setStudents(subj['OE1001']!, [...of('23CS').take(6), ...of('24IT').take(6), ...of('23EC').take(6)]);

  // The first demo batch: a draft invigilator allocation for its second session, ready to confirm or edit.
  final demoCycle = s.cycles.cycles().where((c) => c.name.startsWith('Demo November')).firstOrNull;
  if (demoCycle != null) {
    final sessions = s.cycles.sessions(demoCycle.id);
    if (sessions.length > 1 && s.allocation.sessionAllocation(sessions[1].id).isEmpty) {
      final halls = m.halls().where((h) => ['H301', 'H302', 'AUD', 'LAB1'].contains(h.hallCode)).map((h) => h.id).toList();
      final users = ['STF002', 'STF005', 'STF010', 'STF013'].map((x) => staffId[x]!).toList();
      s.allocation.generate(sessions[1].id, users, halls);
    }
  }

  // A second batch with nothing allocated yet.
  final model = s.cycles.createCycle('Demo Model Examinations', '2025-2026');
  s.cycles.createSessions(model.id, [
    SessionInput(examDate: _date(12), sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '12:30'),
    SessionInput(examDate: _date(12), sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '16:30'),
    SessionInput(examDate: _date(13), sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '12:30'),
  ]);
}
