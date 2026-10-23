import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/models/domain/validation.dart';
import 'package:hias/services/app_services.dart';

/// A student has one register number and, in one exam session, one seat in one hall - never two.
void main() {
  late AppServices s;
  late int dept;
  late int session;

  ({bool ok, String? error}) add(String roll, String reg, {String name = 'New Student'}) {
    final r = s.students.save(rollNo: roll, registerNo: reg, name: name, gender: 'M', departmentId: dept, section: 'A', batch: '2023-2027');
    return (ok: r.success, error: r.error);
  }

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    session = demo.sessionIds.first;
    dept = s.master.departments().first.id;
    expect(add('R1', '961200000001', name: 'First').ok, isTrue);
  });

  group('register number is unique', () {
    test('the same number, with spaces around it or in another case, is refused and says who has it', () {
      for (final reg in ['961200000001', ' 961200000001 ']) {
        final r = add('R2', reg);
        expect(r.ok, isFalse, reason: reg);
        expect(r.error, contains('Register Number'));
        expect(r.error, contains('First'));
      }
      expect(add('AB1', 'ab-77').ok, isTrue);
      expect(add('AB2', 'AB-77').ok, isFalse, reason: 'letters ignore case');
    });

    test('leading zeros do not make a new number (Excel drops them)', () {
      expect(add('R2', '0961200000001').ok, isFalse);
      expect(add('R3', '00961200000001').error, contains('already used by First'));
      expect(studentNumberKey('0961200000001'), studentNumberKey('961200000001'));
      // Only numbers made of digits: a code with letters is compared as written.
      expect(add('R4', 'X0123').ok, isTrue);
      expect(add('R5', 'X123').ok, isTrue);
    });

    test('a student who is no longer active keeps the number, and the message says so', () {
      final id = s.students.list().firstWhere((x) => x.rollNo == 'R1').id;
      expect(s.students.save(id: id, rollNo: 'R1', registerNo: '961200000001', name: 'First', gender: 'M', departmentId: dept, section: 'A', batch: '2023-2027', isActive: false).success, isTrue);
      final r = add('R2', '961200000001');
      expect(r.ok, isFalse);
      expect(r.error, contains('not active'));
    });

    test('editing a student keeps their own number, but cannot take another student\'s', () {
      expect(add('R2', '961200000002', name: 'Second').ok, isTrue);
      final second = s.students.list().firstWhere((x) => x.rollNo == 'R2');
      expect(s.students.save(id: second.id, rollNo: 'R2', registerNo: '961200000002', name: 'Second Renamed', gender: 'M', departmentId: dept, section: 'A', batch: '2023-2027').success, isTrue);
      final steal = s.students.save(id: second.id, rollNo: 'R2', registerNo: '0961200000001', name: 'Second', gender: 'M', departmentId: dept, section: 'A', batch: '2023-2027');
      expect(steal.success, isFalse);
      expect(steal.error, contains('First'));
      expect(s.students.numberClash(rollNo: 'R2', registerNo: '961200000002', exceptId: second.id), isNull);
      expect(s.students.numberClash(rollNo: 'R9', registerNo: '961200000001'), contains('First'));
    });

    test('an Excel import reports a number repeated inside the file with its rows, and one already saved', () {
      final code = s.master.departments().first.code;
      final r = s.students.importStudents([
        ['Roll No', 'Register No', 'Name', 'Gender', 'Department', 'Section', 'Batch'],
        ['X1', '961200000010', 'One', 'M', code, 'A', '2023-2027'],
        ['X2', '0961200000010', 'Two Repeats Row 2', 'M', code, 'A', '2023-2027'],
        ['X3', '961200000001', 'Three Already Saved', 'M', code, 'A', '2023-2027'],
        ['X1', '961200000011', 'Four Roll Repeats', 'M', code, 'A', '2023-2027'],
      ]);
      expect(r.inserted, 1, reason: 'only the first row is new');
      expect(r.issues.map((i) => i.row), [3, 4, 5]);
      expect(r.issues[0].reason, contains('row 2 of this file'));
      expect(r.issues[1].reason, contains('First'));
      expect(r.issues[2].reason, contains('Roll Number'));
      expect(s.students.list().where((x) => x.rollNo == 'X1').length, 1);
    });
  });

  group('one seat per student per session', () {
    const insert = 'INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)';

    test('the database itself refuses a second seat, or a second hall, for a student in a session, and a seat twice', () {
      final first = s.db.queryOne('SELECT * FROM seat_allocations WHERE session_id = ? LIMIT 1', [session])!;
      final otherHall = s.db.queryOne('SELECT * FROM seat_allocations WHERE session_id = ? AND hall_id != ? LIMIT 1', [session, first['hall_id']])!;
      // The same student in a second seat, in another hall, of the same session.
      expect(() => s.db.run(insert, [session, first['student_id'], otherHall['hall_id'], 9, 9, 99, 'L']), throwsA(anything));
      // The same seat given to a second student.
      final extra = s.students.list().firstWhere((x) => x.rollNo == 'R1').id;
      expect(() => s.db.run(insert, [session, extra, first['hall_id'], first['bench_row'], first['bench_col'], first['bench_no'], first['seat']]), throwsA(anything));
      // The same student may sit in another session.
      final other = s.cycles.sessions(1).firstWhere((x) => x.id != session).id;
      s.db.run(insert, [other, first['student_id'], first['hall_id'], first['bench_row'], first['bench_col'], first['bench_no'], first['seat']]);
    });

    test('a plan that lists a student twice is rejected by the validator, naming the student', () {
      final seats = s.students.sessionSeating(session);
      final a = seats.first, b = seats[1];
      final plan = [
        for (final x in seats.skip(1)) Seat(studentId: x.studentId, hallId: x.hallId, row: x.benchRow, col: x.benchCol, benchNo: x.benchNo, seat: x.seat),
        // b a second time, in the seat a had
        Seat(studentId: b.studentId, hallId: a.hallId, row: a.benchRow, col: a.benchCol, benchNo: a.benchNo, seat: a.seat),
      ];
      final students = [for (final x in seats) SeatStudent(id: x.studentId, rollNo: x.rollNo, gender: x.gender, batch: x.batch, deptCode: x.deptCode)];
      final halls = [for (final h in s.master.halls()) SeatHall(h.id, h.hallCode, h.layout)];
      final errors = validateSeatingPlan(plan, const [], students, halls, s.students.savedSeating(session)!.config);
      expect(errors.join(' '), contains('${b.rollNo} is allocated more than once'));
    });

    test('moving and swapping students again and again never gives anybody two seats, or a seat to two', () {
      final count = s.students.sessionSeating(session).length;
      var moved = 0;
      for (var round = 0; round < 40; round++) {
        final all = s.students.sessionSeating(session);
        final a = all[(round * 7) % all.length], b = all[(round * 13 + 5) % all.length];
        if (a.studentId == b.studentId) continue;
        final r = s.students.moveSeat(session, a.studentId, hallId: b.hallId, row: b.benchRow, col: b.benchCol, seat: b.seat);
        if (r.success) moved++;
        final now = s.students.sessionSeating(session);
        expect(now.map((x) => x.studentId).toSet().length, now.length, reason: 'round $round: a student has two seats');
        expect(now.map((x) => '${x.hallId}-${x.benchRow}-${x.benchCol}-${x.seat}').toSet().length, now.length, reason: 'round $round: a seat has two students');
        expect(now.length, count, reason: 'round $round: nobody lost or added');
      }
      expect(moved, greaterThan(0), reason: 'some swaps are allowed, so the check really ran');
    });

    test('a selection that names a student twice still gives them one seat', () {
      final ids = s.students.list(isActive: true).map((x) => x.id).toList();
      final auto = s.students.autoConfigureSeating(session, ids);
      final r = s.students.confirm(session, [...ids, ...ids.take(10)], auto.config!, acceptUnallocated: true);
      expect(r.success, isTrue, reason: '${r.error}');
      final seated = s.students.sessionSeating(session).map((x) => x.studentId).toList();
      expect(seated.toSet().length, seated.length);
    });

    test('a seat conflict that reaches the database is explained in plain words', () {
      expect(s.students.explainSeatError('UNIQUE constraint failed: seat_allocations.session_id, seat_allocations.student_id'), 'a student would have two seats in this session');
      expect(s.students.explainSeatError('UNIQUE constraint failed: seat_allocations.session_id, seat_allocations.hall_id, seat_allocations.bench_row, seat_allocations.bench_col, seat_allocations.seat'), 'two students would share one seat');
    });
  });
}
