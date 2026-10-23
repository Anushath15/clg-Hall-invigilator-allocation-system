import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/services/cycle_service.dart';

/// MASTER DATA: departments, staff, halls, settings, the Excel imports and the dashboard numbers.
void main() {
  late AppServices s;

  setUp(() => s = AppServices(AppDatabase.open(':memory:', appVersion: 'test')));

  int dept(String code, [String? name]) {
    final r = s.master.saveDepartment(code: code, name: name ?? '$code Department');
    expect(r.success, isTrue, reason: '${r.error}');
    return r.value!.id;
  }

  group('departments', () {
    test('a department is added with a trimmed code and name', () {
      final r = s.master.saveDepartment(code: ' CSE ', name: '  Computer Science  ');
      expect(r.success, isTrue);
      expect(r.value!.code, 'CSE');
      expect(r.value!.name, 'Computer Science');
      expect(s.master.departments().map((d) => d.code), contains('CSE'));
    });

    test('code and name are required and checked', () {
      expect(s.master.saveDepartment(code: '', name: 'X').error, contains('required'));
      expect(s.master.saveDepartment(code: 'CSE', name: '').error, contains('required'));
      expect(s.master.saveDepartment(code: '123', name: 'Numbers').error, contains('at least one letter'));
      expect(s.master.saveDepartment(code: 'CSE', name: '2024').error, contains('letters'));
    });

    test('a code is used once, in any letter case, and the message names it', () {
      dept('CSE');
      final r = s.master.saveDepartment(code: 'cse', name: 'Another');
      expect(r.success, isFalse);
      expect(r.error, contains('"CSE"'));
      expect(r.error, contains('not case-sensitive'));
    });

    test('editing keeps its own code, renames, and can switch off', () {
      final id = dept('CSE');
      final r = s.master.saveDepartment(id: id, code: 'CSE', name: 'Computing', isActive: false);
      expect(r.success, isTrue);
      expect(r.value!.name, 'Computing');
      expect(r.value!.isActive, isFalse);
      // taking another department's code is refused
      final other = dept('ECE');
      expect(s.master.saveDepartment(id: other, code: 'cse', name: 'Electronics').success, isFalse);
    });

    test('a department with staff or students cannot be deleted; an empty one can', () {
      final used = dept('CSE'), empty = dept('ECE');
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', departmentId: used).success, isTrue);
      expect(s.master.deleteDepartment(used).error, contains('staff assigned'));
      expect(s.master.deleteDepartment(empty).success, isTrue);
      expect(s.master.departments().map((d) => d.id), isNot(contains(empty)));
      // students
      final withStudents = dept('MECH');
      expect(s.students.save(rollNo: 'R1', registerNo: 'G1', name: 'Ravi Kumar', gender: 'M', departmentId: withStudents, section: 'A', batch: '2023-2027').success, isTrue);
      expect(s.master.deleteDepartment(withStudents).error, contains('students belong'));
    });

    test('a department is found by code or by name, the code first', () {
      final cse = dept('CSE', 'Computer Science');
      expect(s.master.findDepartmentId('cse'), cse);
      expect(s.master.findDepartmentId('COMPUTER SCIENCE'), cse);
      expect(s.master.findDepartmentId('unknown'), isNull);
      final tricky = dept('ECE', 'CSE'); // the name of this one equals the code of the first
      expect(s.master.findDepartmentId('CSE'), cse, reason: 'a code match wins over a name match');
      expect(tricky, isNot(cse));
    });
  });

  group('staff', () {
    test('a staff member is added, listed with the department, and filtered', () {
      final cse = dept('CSE'), ece = dept('ECE');
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', email: 'anu@college.in', designation: 'Professor', departmentId: cse).success, isTrue);
      expect(s.master.saveStaff(staffId: 'S2', name: 'Bala Murugan', departmentId: ece).success, isTrue);
      final all = s.master.staff(role: 'staff');
      expect(all.map((u) => u.staffId), unorderedEquals(['S1', 'S2']));
      final anu = all.firstWhere((u) => u.staffId == 'S1');
      expect(anu.departmentCode, 'CSE');
      expect(anu.email, 'anu@college.in');
      expect(anu.designation, 'Professor');
      expect(s.master.staff(role: 'staff', departmentId: ece).map((u) => u.staffId), ['S2']);
      expect(s.master.staff(role: 'staff', isActive: false), isEmpty);
    });

    test('blank e-mail and designation are stored as nothing', () {
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', email: '  ', designation: '').success, isTrue);
      final u = s.master.staff(role: 'staff').single;
      expect(u.email, isNull);
      expect(u.designation, isNull);
    });

    test('the field rules apply: a designation of digits, a bad e-mail, a bad name', () {
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', designation: '1010').error, contains('Designation'));
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', email: 'nope').error, contains('E-mail'));
      expect(s.master.saveStaff(staffId: 'S1', name: '12').error, contains('Full Name'));
      expect(s.master.saveStaff(staffId: 'S 1', name: 'Anu Priya').error, contains('Staff ID'));
      expect(s.master.staff(role: 'staff'), isEmpty, reason: 'nothing was saved');
    });

    test('a Staff ID is used once in any letter case, and the message names the holder', () {
      s.master.saveStaff(staffId: 'STF001', name: 'Anu Priya');
      final r = s.master.saveStaff(staffId: 'stf001', name: 'Someone Else');
      expect(r.success, isFalse);
      expect(r.error, contains('STF001'));
      expect(r.error, contains('Anu Priya'));
    });

    test('editing changes the details and keeps the Staff ID free for itself', () {
      s.master.saveStaff(staffId: 'S1', name: 'Anu Priya');
      final id = s.master.staff(role: 'staff').single.id;
      expect(s.master.saveStaff(id: id, staffId: 'S1', name: 'Anu Priya S', designation: 'HOD', isActive: false).success, isTrue);
      final u = s.master.staff().firstWhere((x) => x.id == id);
      expect(u.name, 'Anu Priya S');
      expect(u.designation, 'HOD');
      expect(u.isActive, isFalse);
    });

    test('deactivating hides a member from the active list but keeps them', () {
      s.master.saveStaff(staffId: 'S1', name: 'Anu Priya');
      final id = s.master.staff(role: 'staff').single.id;
      s.master.deactivateStaff(id);
      expect(s.master.staff(role: 'staff', isActive: true), isEmpty);
      expect(s.master.staff(role: 'staff', isActive: false).single.id, id);
    });

    test('permanent delete works for a member with no history, is recorded, and is refused with history', () {
      s.master.saveStaff(staffId: 'S1', name: 'Anu Priya');
      s.master.saveStaff(staffId: 'S2', name: 'Bala Murugan');
      final anu = s.master.staff(role: 'staff').firstWhere((u) => u.staffId == 'S1').id;
      final bala = s.master.staff(role: 'staff').firstWhere((u) => u.staffId == 'S2').id;
      // Bala has a rotation record
      final cycle = s.cycles.createCycle('Test Batch', '2026-2027');
      final tomorrow = DateTime.now().add(const Duration(days: 3));
      final date = '${tomorrow.year}-${tomorrow.month.toString().padLeft(2, '0')}-${tomorrow.day.toString().padLeft(2, '0')}';
      final session = s.cycles.addSession(cycle.id, sessionOn(date));
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 2));
      s.allocation.generate(session.id, [bala], [s.master.halls().first.id]);
      expect(s.master.hardDeleteStaff(bala).error, contains('allocation history'));
      expect(s.master.hardDeleteStaff(anu).success, isTrue);
      expect(s.master.staff(role: 'staff').map((u) => u.staffId), ['S2']);
      expect(s.db.query('SELECT description FROM audit_log WHERE action = ?', ['STAFF_HARD_DELETE']).single['description'], contains('S1'));
    });
  });

  group('importing staff from Excel rows', () {
    final header = ['Staff ID', 'Name', 'Department', 'Email', 'Designation'];

    test('rows are imported by department code or name, with the optional columns', () {
      dept('CSE', 'Computer Science');
      dept('ECE', 'Electronics');
      final r = s.master.importStaff([
        header,
        ['S1', 'Anu Priya', 'CSE', 'anu@c.in', 'Professor'],
        ['S2', 'Bala Murugan', 'Electronics', '', ''],
      ]);
      expect(r.success, isTrue);
      expect(r.inserted, 2);
      expect(r.issues, isEmpty);
      expect(s.master.staff(role: 'staff').firstWhere((u) => u.staffId == 'S2').departmentCode, 'ECE');
    });

    test('other names for the columns are understood, in any order and case', () {
      dept('CSE');
      final r = s.master.importStaff([
        ['DEPT', 'Staff Name', 'STAFFID'],
        ['CSE', 'Anu Priya', 'S1'],
      ]);
      expect(r.inserted, 1);
    });

    test('a missing required column stops the import and names the column', () {
      final r = s.master.importStaff([['Name', 'Department'], ['Anu', 'CSE']]);
      expect(r.success, isFalse);
      expect(r.missingColumns, ['Staff ID']);
      expect(r.error, contains('Staff ID'));
    });

    test('an empty sheet or a header only is reported', () {
      expect(s.master.importStaff([]).success, isFalse);
      expect(s.master.importStaff([header]).error, contains('no data rows'));
    });

    test('each bad row is reported with its row number, and good rows still go in', () {
      dept('CSE');
      s.master.saveStaff(staffId: 'OLD1', name: 'Existing Person');
      final r = s.master.importStaff([
        header,
        ['S1', 'Anu Priya', 'CSE', '', ''], // row 2 good
        ['', 'No Id', 'CSE', '', ''], // row 3 missing
        ['S3', 'Lost Dept', 'MARS', '', ''], // row 4 unknown department
        ['old1', 'Dup Id', 'CSE', '', ''], // row 5 already exists (any case)
        ['S5', '1234', 'CSE', '', ''], // row 6 bad name
        ['S6', 'Bad Mail', 'CSE', 'x', ''], // row 7 bad email
        ['', '', '', '', ''], // blank rows are skipped
        ['S8', 'Last Good', 'CSE', '', 'Lecturer'],
      ]);
      expect(r.success, isTrue);
      expect(r.inserted, 2);
      expect({for (final i in r.issues) i.row: i.reason}.keys, [3, 4, 5, 6, 7]);
      final why = {for (final i in r.issues) i.row: i.reason};
      expect(why[3], contains('Missing Staff ID'));
      expect(why[4], contains('"MARS"'));
      expect(why[5], contains('already exists'));
      expect(why[6], contains('Full Name'));
      expect(why[7], contains('E-mail'));
    });
  });

  group('halls', () {
    test('a hall with a bench layout gets its seat count as capacity', () {
      expect(s.master.saveHall(hallCode: 'H1', block: 'A Block', floor: '1st', layout: const HallLayout(rows: 4, cols: 3)).success, isTrue);
      final h = s.master.halls().single;
      expect(h.capacity, 24, reason: '12 benches of two seats');
      expect(h.benches, 12);
      expect(h.seats, 24);
      expect(h.block, 'A Block');
      expect(h.floor, '1st');
      expect(h.isActive, isTrue);
    });

    test('switched-off benches and chairs change the seat count', () {
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 3, cols: 3, disabled: ['1-1'], kinds: {'2-2': SeatKind.chair}));
      final h = s.master.halls().single;
      expect(h.benches, 8);
      expect(h.seats, 15, reason: '7 benches of two seats and one chair');
    });

    test('a hall without a layout keeps the capacity typed', () {
      s.master.saveHall(hallCode: 'H1', capacity: 40, layout: const HallLayout(rows: 0, cols: 0));
      expect(s.master.halls().single.capacity, 40);
      expect(s.master.halls().single.seats, 0);
    });

    test('rules: a code, a sensible layout, at least one bench, no negative capacity', () {
      expect(s.master.saveHall(hallCode: '  ', layout: const HallLayout(rows: 2, cols: 2)).error, contains('Hall Code is required'));
      expect(s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 0)).error, contains('both'));
      expect(s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 999, cols: 2)).error, contains('at most'));
      expect(s.master.saveHall(hallCode: 'H1', block: 'B' * 50, layout: const HallLayout(rows: 2, cols: 2)).error, contains('Block'));
      expect(s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 1, cols: 1, disabled: ['1-1'])).error, contains('Every bench is switched off'));
      expect(s.master.saveHall(hallCode: 'H1', capacity: -5, layout: const HallLayout(rows: 0, cols: 0)).error, contains('negative'));
      expect(s.master.halls(), isEmpty);
    });

    test('a hall code is used once in any letter case, and halls keep their order', () {
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 2));
      expect(s.master.saveHall(hallCode: 'h1', layout: const HallLayout(rows: 2, cols: 2)).error, contains('already exists'));
      s.master.saveHall(hallCode: 'H2', layout: const HallLayout(rows: 2, cols: 2));
      s.master.saveHall(hallCode: 'A0', layout: const HallLayout(rows: 2, cols: 2));
      expect(s.master.halls().map((h) => h.hallCode), ['H1', 'H2', 'A0'], reason: 'in the order they were added, not alphabetical');
    });

    test('editing rebuilds the seat count, and can switch a hall off', () {
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 2));
      final id = s.master.halls().single.id;
      expect(s.master.saveHall(id: id, hallCode: 'H1', layout: const HallLayout(rows: 5, cols: 2), isActive: false).success, isTrue);
      final h = s.master.halls().single;
      expect(h.seats, 20);
      expect(h.isActive, isFalse);
    });

    test('a hall used by an allocation or by seating cannot be deleted', () {
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 2));
      s.master.saveHall(hallCode: 'H2', layout: const HallLayout(rows: 2, cols: 2));
      final h1 = s.master.halls().first.id, h2 = s.master.halls().last.id;
      expect(s.master.saveStaff(staffId: 'S1', name: 'Anu Priya').success, isTrue);
      final staff = s.master.staff(role: 'staff').single.id;
      final cycle = s.cycles.createCycle('Test Batch', '2026-2027');
      final tomorrow = DateTime.now().add(const Duration(days: 3));
      final date = '${tomorrow.year}-${tomorrow.month.toString().padLeft(2, '0')}-${tomorrow.day.toString().padLeft(2, '0')}';
      final session = s.cycles.addSession(cycle.id, sessionOn(date));
      s.allocation.generate(session.id, [staff], [h1]);
      expect(s.master.deleteHall(h1).error, contains('existing allocations'));
      expect(s.master.deleteHall(h2).success, isTrue);
      expect(s.master.halls().map((h) => h.id), [h1]);
    });
  });

  group('settings and the dashboard', () {
    test('the defaults are there, and each setting is checked before it is saved', () {
      final all = s.master.settings();
      expect(all['college.name'], isNotEmpty);
      expect(all['college.short_name'], isNotEmpty);
      expect(s.master.saveSetting('college.name', '').error, contains('required'));
      expect(s.master.saveSetting('college.short_name', 'X' * 20).error, contains('at most 12'));
      expect(s.master.saveSetting('session.fn_start_time', '25:00').error, contains('valid'));
      expect(s.master.saveSetting('session.an_end_time', '17:30').success, isTrue);
      expect(s.master.settings()['session.an_end_time'], '17:30');
    });

    test('a new key is added and an old one is updated, trimmed', () {
      expect(s.master.saveSetting('college.short_name', '  SXCCE  ').success, isTrue);
      expect(s.master.settings()['college.short_name'], 'SXCCE');
      expect(s.master.saveSetting('some.new.key', 'v').success, isTrue);
      expect(s.master.settings()['some.new.key'], 'v');
    });

    test('the dashboard counts what is there, and "upcoming" follows the clock', () {
      final d = dept('CSE');
      s.master.saveStaff(staffId: 'S1', name: 'Anu Priya', departmentId: d);
      s.master.saveStaff(staffId: 'S2', name: 'Bala Murugan', departmentId: d);
      s.master.saveHall(hallCode: 'H1', layout: const HallLayout(rows: 2, cols: 2));
      s.students.save(rollNo: 'R1', registerNo: 'G1', name: 'Ravi Kumar', gender: 'M', departmentId: d, section: 'A', batch: '2023-2027');
      s.students.save(rollNo: 'R2', registerNo: 'G2', name: 'Latha Devi', gender: 'F', departmentId: d, section: 'A', batch: '2023-2027');
      final cycle = s.cycles.createCycle('Test Batch', '2026-2027');
      final soon = DateTime.now().add(const Duration(days: 3));
      final date = '${soon.year}-${soon.month.toString().padLeft(2, '0')}-${soon.day.toString().padLeft(2, '0')}';
      s.cycles.addSession(cycle.id, sessionOn(date));
      final stats = s.master.dashboardStats();
      expect(stats.totalStaff, 2);
      expect(stats.totalHalls, 1);
      expect(stats.totalStudents, 2);
      expect(stats.totalBoys, 1);
      expect(stats.totalCycles, 1);
      expect(stats.upcomingSessions, 1);
      expect(stats.pendingAllocations, 1);
      expect(stats.confirmedSessions, 0);
      expect(stats.totalExamDays, 1);
      // a month later the session is over
      expect(s.master.dashboardStats(soon.add(const Duration(days: 30))).upcomingSessions, 0);
    });
  });
}

/// A forenoon session on [date] with the usual times.
SessionInput sessionOn(String date) => SessionInput(examDate: date, sessionType: 'FN', reportingTime: '09:30', examStart: '10:00', examEnd: '13:00');
