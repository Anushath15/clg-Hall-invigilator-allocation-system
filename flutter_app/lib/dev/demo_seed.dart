import '../models/domain/hall_layout.dart';
import '../services/app_services.dart';
import '../services/cycle_service.dart';

/// Small, realistic demo data for trying every workflow: 3 departments, 9 staff, 6 halls,
/// 72 students in 4 classes, 5 subjects, and one batch of 4 upcoming sessions.
/// Session 1 is generated, confirmed and seated; the rest are left pending to try by hand.
class DemoSeedResult {
  final int cycleId;
  final List<int> sessionIds;
  const DemoSeedResult(this.cycleId, this.sessionIds);
}

String _date(int daysAhead) {
  var d = DateTime.now().add(Duration(days: daysAhead));
  if (d.weekday == DateTime.sunday) d = d.add(const Duration(days: 1));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

DemoSeedResult seedDemo(AppServices s, {bool runFirstSession = true}) {
  final m = s.master;

  // Departments
  for (final d in const [('CSE', 'Computer Science & Engineering'), ('ECE', 'Electronics & Communication Engineering'), ('MECH', 'Mechanical Engineering')]) {
    m.saveDepartment(code: d.$1, name: d.$2);
  }
  final dept = {for (final d in m.departments()) d.code: d.id};

  // Staff (invigilators)
  const staff = [
    ('STF001', 'Dr. R. Anitha', 'Professor', 'CSE'),
    ('STF002', 'J. Benjamin', 'Assistant Professor', 'CSE'),
    ('STF003', 'S. Kavitha', 'Associate Professor', 'CSE'),
    ('STF004', 'M. Rajesh', 'Assistant Professor', 'ECE'),
    ('STF005', 'P. Lakshmi', 'Professor', 'ECE'),
    ('STF006', 'A. Mohamed Rafi', 'Assistant Professor', 'ECE'),
    ('STF007', 'K. Suresh', 'Associate Professor', 'MECH'),
    ('STF008', 'T. Priya', 'Assistant Professor', 'MECH'),
    ('STF009', 'V. Arun Kumar', 'Assistant Professor', 'MECH'),
  ];
  for (final x in staff) {
    m.saveStaff(staffId: x.$1, name: x.$2, designation: x.$3, email: '${x.$1.toLowerCase()}@college.edu', departmentId: dept[x.$4]);
  }

  // Halls: 4 standard rooms (4 rows × 3 cols = 24 seats), one with chairs, one larger.
  m.saveHall(hallCode: 'H101', block: 'Main Block', floor: 'Ground', layout: const HallLayout(rows: 4, cols: 3));
  m.saveHall(hallCode: 'H102', block: 'Main Block', floor: 'Ground', layout: const HallLayout(rows: 4, cols: 3));
  m.saveHall(hallCode: 'H201', block: 'Main Block', floor: '1st', layout: const HallLayout(rows: 4, cols: 3, disabled: ['4-3']));
  m.saveHall(hallCode: 'H202', block: 'Main Block', floor: '1st', layout: const HallLayout(rows: 4, cols: 3));
  m.saveHall(
      hallCode: 'LAB1',
      block: 'Lab Block',
      floor: 'Ground',
      layout: HallLayout(rows: 4, cols: 3, kinds: {for (var r = 1; r <= 4; r++) benchKey(r, 3): SeatKind.chair}));
  m.saveHall(hallCode: 'AUD', block: 'Admin Block', floor: '2nd', layout: const HallLayout(rows: 5, cols: 4));

  // Students: 4 classes × 18 (alternating boys and girls).
  const classes = [('CSE', '2022-2026', '22CS'), ('CSE', '2023-2027', '23CS'), ('ECE', '2022-2026', '22EC'), ('MECH', '2023-2027', '23ME')];
  const first = ['Anu', 'Bala', 'Charu', 'Deepak', 'Esther', 'Farhan', 'Gayathri', 'Hari', 'Indhu', 'Joel', 'Keerthi', 'Lokesh', 'Meena', 'Naveen', 'Oviya', 'Prakash', 'Ramya', 'Sanjay'];
  var reg = 961200000;
  for (final c in classes) {
    for (var i = 0; i < 18; i++) {
      s.students.save(
        rollNo: '${c.$3}${(i + 1).toString().padLeft(3, '0')}',
        registerNo: '${reg++}',
        name: '${first[i]} ${String.fromCharCode(65 + (i % 26))}',
        gender: i.isEven ? 'F' : 'M',
        departmentId: dept[c.$1],
        section: i < 9 ? 'A' : 'B',
        batch: c.$2,
      );
    }
  }

  // Subjects with the staff who handle them.
  final staffId = {for (final u in m.staff(role: 'staff')) u.staffId: u.id};
  const subjects = [
    ('CS3401', 'Compiler Design', 'CSE', ['STF001']),
    ('CS3301', 'Operating Systems', 'CSE', ['STF002', 'STF003']),
    ('EC3401', 'Digital Signal Processing', 'ECE', ['STF004']),
    ('ME3301', 'Thermodynamics', 'MECH', ['STF007']),
    ('MA3101', 'Engineering Mathematics', null, ['STF005', 'STF008']),
  ];
  for (final x in subjects) {
    s.subjects.save(code: x.$1, name: x.$2, departmentId: x.$3 == null ? null : dept[x.$3], staffIds: [for (final id in x.$4) staffId[id]!]);
  }
  // Map the 2022 CSE students to Compiler Design, the 2023 CSE students to Operating Systems.
  final subj = {for (final x in s.subjects.list()) x.code: x.id};
  final all = s.students.list();
  s.subjects.setStudents(subj['CS3401']!, all.where((x) => x.rollNo.startsWith('22CS')).map((x) => x.id).toList());
  s.subjects.setStudents(subj['CS3301']!, all.where((x) => x.rollNo.startsWith('23CS')).map((x) => x.id).toList());

  // One allocation batch with 4 upcoming sessions.
  final cycle = s.cycles.createCycle('Demo November End Semester Examinations', '2025-2026');
  s.cycles.createSessions(cycle.id, [
    SessionInput(examDate: _date(3), sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00'),
    SessionInput(examDate: _date(3), sessionType: 'AN', reportingTime: '13:30', examStart: '14:00', examEnd: '17:00'),
    SessionInput(examDate: _date(5), sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00'),
    SessionInput(examDate: _date(6), sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '12:00'),
  ]);
  final sessions = s.cycles.sessions(cycle.id);

  if (runFirstSession) {
    // Session 1: 4 invigilators in 4 halls, confirmed, and all 72 students seated.
    final halls = m.halls().where((h) => ['H101', 'H102', 'H201', 'H202'].contains(h.hallCode)).map((h) => h.id).toList();
    final users = ['STF001', 'STF004', 'STF007', 'STF009'].map((x) => staffId[x]!).toList();
    s.allocation.generate(sessions.first.id, users, halls);
    s.allocation.confirm(sessions.first.id);
    final ids = s.students.list(isActive: true).map((x) => x.id).toList();
    final auto = s.students.autoConfigureSeating(sessions.first.id, ids);
    if (auto.success) s.students.confirm(sessions.first.id, ids, auto.config!, acceptUnallocated: true);
  }
  return DemoSeedResult(cycle.id, sessions.map((x) => x.id).toList());
}
