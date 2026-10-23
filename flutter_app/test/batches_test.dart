import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/format.dart';
import 'package:hias/services/cycle_service.dart';

import 'support/world.dart';

/// ALLOCATION BATCHES (exam cycles) and their sessions: creating, scheduling, editing, deleting.
void main() {
  late World w;
  setUp(() => w = World());

  group('creating a batch', () {
    test('a batch has a name and an academic year, starts as a draft and is listed newest first', () {
      final a = w.s.cycles.createCycle('  November Series  ', '2026-27');
      expect(a.name, 'November Series');
      expect(a.academicYear, '2026-27');
      expect(a.status, 'draft');
      final b = w.s.cycles.createCycle('Model Exam', '2026-2027');
      expect(w.s.cycles.cycles().map((c) => c.id), [b.id, a.id]);
      expect(w.s.cycles.cycle(a.id)!.name, 'November Series');
      expect(w.s.cycles.cycle(9999), isNull);
    });

    test('a name without letters and a wrong academic year are refused', () {
      expect(() => w.s.cycles.createCycle('2026', '2026-27'), throwsA(isA<ArgumentError>()));
      expect(() => w.s.cycles.createCycle('', '2026-27'), throwsA(isA<ArgumentError>()));
      expect(() => w.s.cycles.createCycle('Series', '2026-28'), throwsA(isA<ArgumentError>()));
      expect(w.s.cycles.cycles(), isEmpty);
    });
  });

  group('sessions of a batch', () {
    test('the wizard makes sessions in date order, forenoon before afternoon, numbered from 1', () {
      final c = w.cycle();
      w.s.cycles.createSessions(c.id, [
        World.session(World.day(5), 'AN'),
        World.session(World.day(3), 'FN'),
        World.session(World.day(5), 'FN'),
        World.session(World.day(3), 'AN'),
      ]);
      final list = w.s.cycles.sessions(c.id);
      expect(list.map((x) => '${x.examDate} ${x.sessionType}'), [
        '${World.day(3)} FN', '${World.day(3)} AN', '${World.day(5)} FN', '${World.day(5)} AN',
      ]);
      expect(list.map((x) => x.rotationStep), [1, 2, 3, 4]);
      expect(list.every((x) => x.status == 'pending'), isTrue);
    });

    test('a repeated date and slot is made once', () {
      final c = w.cycle();
      w.s.cycles.createSessions(c.id, [World.session(World.day(3)), World.session(World.day(3))]);
      expect(w.s.cycles.sessions(c.id), hasLength(1));
    });

    test('a past date is refused, for creating, adding and editing', () {
      final c = w.cycle();
      expect(() => w.s.cycles.createSessions(c.id, [World.session(World.day(-1))]), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', pastDateMessage)));
      expect(() => w.s.cycles.addSession(c.id, World.session(World.day(-2))), throwsA(isA<ArgumentError>()));
      final s = w.s.cycles.addSession(c.id, World.session(World.day(4)));
      expect(() => w.s.cycles.updateSession(s.id, World.session(World.day(-3))), throwsA(isA<ArgumentError>()));
      expect(w.s.cycles.sessions(c.id), hasLength(1), reason: 'nothing past was added');
    });

    test('times are checked: reporting <= start < end', () {
      final c = w.cycle();
      SessionInput withTimes(String r, String s, String e) => SessionInput(examDate: World.day(3), sessionType: 'FN', reportingTime: r, examStart: s, examEnd: e);
      expect(() => w.s.cycles.addSession(c.id, withTimes('10:30', '10:00', '13:00')), throwsA(isA<ArgumentError>()));
      expect(() => w.s.cycles.addSession(c.id, withTimes('09:30', '10:00', '09:00')), throwsA(isA<ArgumentError>()));
      expect(() => w.s.cycles.addSession(c.id, withTimes('9:30', '10:00', '13:00')), throwsA(isA<ArgumentError>()));
      expect(() => w.s.cycles.createSessions(c.id, [withTimes('09:30', '10:00', '09:00')]), throwsA(isA<ArgumentError>()));
      expect(w.s.cycles.sessions(c.id), isEmpty);
    });

    test('adding a session twice for the same date and slot is refused, naming the slot', () {
      final c = w.cycle();
      w.s.cycles.addSession(c.id, World.session(World.day(3)));
      expect(() => w.s.cycles.addSession(c.id, World.session(World.day(3))), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('Forenoon (FN) session already exists'))));
      // the other slot of the day is fine
      w.s.cycles.addSession(c.id, World.session(World.day(3), 'AN'));
      expect(w.s.cycles.sessions(c.id), hasLength(2));
    });

    test('an added session is put in date order among the unconfirmed ones', () {
      final b = w.batch([3, 7]);
      w.s.cycles.addSession(b.cycle.id, World.session(World.day(5)));
      expect(w.s.cycles.sessions(b.cycle.id).map((x) => x.examDate), [World.day(3), World.day(5), World.day(7)]);
      expect(w.s.cycles.sessions(b.cycle.id).map((x) => x.rotationStep), [1, 2, 3]);
    });

    test('a session is rescheduled: date, slot and times change, status and step never come from the caller', () {
      final b = w.batch([3, 5]);
      final first = b.sessions.first;
      final moved = w.s.cycles.updateSession(first.id, SessionInput(examDate: World.day(8), sessionType: 'AN', reportingTime: '13:00', examStart: '13:30', examEnd: '16:30'))!;
      expect(moved.examDate, World.day(8));
      expect(moved.sessionType, 'AN');
      expect(moved.examStart, '13:30');
      expect(moved.status, 'pending');
      expect(w.s.cycles.sessions(b.cycle.id).map((x) => x.examDate), [World.day(5), World.day(8)], reason: 'renumbered into date order');
      expect(w.s.cycles.updateSession(9999, World.session(World.day(3))), isNull);
    });

    test('moving a session onto a slot the batch already has is refused', () {
      final b = w.batch([3, 5]);
      expect(() => w.s.cycles.updateSession(b.sessions.first.id, World.session(World.day(5))), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('already exists'))));
    });

    test('forenoon and afternoon of one day must not overlap in time, and may touch', () {
      final c = w.cycle();
      w.s.cycles.addSession(c.id, World.session(World.day(3)));
      expect(
          () => w.s.cycles.addSession(c.id, SessionInput(examDate: World.day(3), sessionType: 'AN', reportingTime: '12:00', examStart: '12:30', examEnd: '15:00')),
          throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('overlaps'))));
      // the AN session reports exactly when the FN session ends: allowed
      w.s.cycles.addSession(c.id, SessionInput(examDate: World.day(3), sessionType: 'AN', reportingTime: '13:00', examStart: '13:30', examEnd: '16:00'));
      expect(w.s.cycles.sessions(c.id), hasLength(2));
    });
  });

  group('deleting a session', () {
    test('an unconfirmed session goes with its allocation, and the others are renumbered', () {
      final b = w.batch([3, 5, 7]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      expect(w.s.cycles.deleteSession(b.sessions[1].id).success, isTrue);
      expect(w.s.cycles.sessions(b.cycle.id).map((x) => x.rotationStep), [1, 2]);
      expect(w.s.db.query('SELECT id FROM allocations WHERE session_id = ?', [b.sessions[1].id]), isEmpty);
    });

    test('a confirmed session cannot be deleted, and a missing one is reported', () {
      final b = w.batch([3]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions.single.id, staff, halls);
      expect(w.s.allocation.confirm(b.sessions.single.id).success, isTrue);
      expect(w.s.cycles.deleteSession(b.sessions.single.id).error, contains('confirmed'));
      expect(w.s.cycles.deleteSession(9999).error, contains('not found'));
    });
  });

  group('batch status', () {
    test('a batch is a draft until every session is confirmed, then confirmed', () {
      final b = w.batch([3, 5]);
      final staff = w.staff(2), halls = w.halls(2);
      expect(w.s.cycles.cycle(b.cycle.id)!.status, 'draft');
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      expect(w.s.cycles.cycle(b.cycle.id)!.status, 'draft', reason: 'one of two');
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      w.s.allocation.confirm(b.sessions[1].id);
      expect(w.s.cycles.cycle(b.cycle.id)!.status, 'confirmed');
    });

    test('the wizard replaces unconfirmed sessions and keeps confirmed ones', () {
      final b = w.batch([3, 5]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      w.s.cycles.createSessions(b.cycle.id, [World.session(World.day(9))]);
      final list = w.s.cycles.sessions(b.cycle.id);
      expect(list.map((x) => x.examDate), [World.day(3), World.day(9)]);
      expect(list.first.status, 'confirmed');
      expect(list.last.rotationStep, 2);
    });
  });

  group('deleting a whole batch', () {
    test('the batch name, a registered active person with their own name and Staff ID are all needed', () {
      final b = w.batch([3]);
      w.registrar();
      final id = b.cycle.id;
      expect(w.s.cycles.deleteCycle(id, typedBatchName: '', personName: 'Registrar One', staffId: 'REG1').error, contains('Type the batch name'));
      expect(w.s.cycles.deleteCycle(id, typedBatchName: 'Wrong', personName: 'Registrar One', staffId: 'REG1').error, contains('does not match'));
      expect(w.s.cycles.deleteCycle(id, typedBatchName: 'Test Batch', personName: 'Registrar One', staffId: 'NOBODY').error, contains('No one with Staff ID'));
      expect(w.s.cycles.deleteCycle(id, typedBatchName: 'Test Batch', personName: 'Someone Else', staffId: 'REG1').error, contains('name does not match'));
      expect(w.s.cycles.cycle(id), isNotNull, reason: 'refused every time');
      // an inactive person may not delete
      w.s.master.deactivateStaff(w.s.master.staff(role: 'staff').firstWhere((u) => u.staffId == 'REG1').id);
      expect(w.s.cycles.deleteCycle(id, typedBatchName: 'Test Batch', personName: 'Registrar One', staffId: 'REG1').error, contains('no longer active'));
      expect(w.s.cycles.deleteCycle(9999, typedBatchName: 'x', personName: 'x', staffId: 'x').error, contains('not found'));
    });

    test('a confirmed batch can be deleted: it is recorded, its duties still count for fairness', () {
      final b = w.batch([3, 5]);
      w.registrar();
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      final historyBefore = w.s.db.query('SELECT user_id, hall_id FROM rotation_history');
      expect(historyBefore, hasLength(2));
      final r = w.s.cycles.deleteCycle(b.cycle.id, typedBatchName: 'test batch', personName: ' registrar  one ', staffId: 'reg1');
      expect(r.success, isTrue, reason: '${r.error}');
      expect(w.s.cycles.cycle(b.cycle.id), isNull);
      expect(w.s.cycles.sessions(b.cycle.id), isEmpty);
      expect(w.s.db.query('SELECT id FROM allocations'), isEmpty);
      // rotation history is kept, with the link to the session removed
      final after = w.s.db.query('SELECT user_id, hall_id, session_id FROM rotation_history');
      expect(after, hasLength(2));
      expect(after.every((x) => x['session_id'] == null), isTrue);
      // the record of who deleted what
      final record = w.s.cycles.deletedBatches().single;
      expect(record.batchName, 'Test Batch');
      expect(record.sessionCount, 2);
      expect(record.confirmedSessionCount, 1);
      expect(record.allocationCount, 2);
      expect(record.deletedByName, 'Registrar One');
      expect(record.deletedByStaffId, 'REG1');
      expect(w.s.db.query('SELECT description FROM audit_log WHERE action = ?', ['CYCLE_DELETE']).single['description'], contains('Test Batch'));
    });

    test('a new batch cannot repeat a hall a person already had in a deleted batch', () {
      final first = w.batch([3], name: 'First Batch');
      w.registrar();
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(first.sessions.single.id, staff, halls);
      w.s.allocation.confirm(first.sessions.single.id);
      final hallOf = {for (final a in w.s.allocation.sessionAllocation(first.sessions.single.id)) a.userId: a.hallId};
      w.s.cycles.deleteCycle(first.cycle.id, typedBatchName: 'First Batch', personName: 'Registrar One', staffId: 'REG1');
      final second = w.batch([4], name: 'Second Batch');
      w.s.allocation.generate(second.sessions.single.id, staff, halls);
      for (final a in w.s.allocation.sessionAllocation(second.sessions.single.id)) {
        expect(a.hallId, isNot(hallOf[a.userId]), reason: 'the duty in the deleted batch still counts');
      }
    });
  });
}
