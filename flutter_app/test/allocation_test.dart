import 'package:flutter_test/flutter_test.dart';
import 'package:hias/models/entities.dart';

import 'support/world.dart';

/// INVIGILATOR ALLOCATION: every staff member gets one hall and every hall one staff member; nobody gets a hall twice
/// until they have been through the others; sessions are confirmed in order; a manual edit is a checked swap.
void main() {
  late World w;
  setUp(() => w = World());

  Map<int, int> hallOf(int session) => {for (final a in w.s.allocation.sessionAllocation(session)) a.userId: a.hallId};

  group('generating', () {
    test('every staff member gets one hall and every hall one staff member, as a draft', () {
      final b = w.batch([3]);
      final staff = w.staff(5), halls = w.halls(5);
      final r = w.s.allocation.generate(b.sessions.single.id, staff, halls);
      expect(r.validation.isValid, isTrue, reason: '${r.validation.blockingErrors.map((e) => e.message)}');
      expect(r.entries, hasLength(5));
      expect(r.entries.map((a) => a.userId).toSet(), staff.toSet());
      expect(r.entries.map((a) => a.hallId).toSet(), halls.toSet());
      expect(w.s.cycles.session(b.sessions.single.id)!.status, 'draft');
      expect(r.entries.every((a) => !a.isManuallyEdited), isTrue);
    });

    test('the same draft always gives the same allocation; another set of staff gives another', () {
      final b = w.batch([3]);
      final staff = w.staff(6), halls = w.halls(6);
      final id = b.sessions.single.id;
      final first = hallOf(id)..clear();
      w.s.allocation.generate(id, staff, halls);
      final one = hallOf(id);
      w.s.allocation.generate(id, staff, halls);
      expect(hallOf(id), one, reason: 'regenerating the same draft is repeatable');
      expect(first, isEmpty);
      w.s.allocation.generate(id, staff.take(5).toList(), halls.take(5).toList());
      expect(hallOf(id).length, 5);
    });

    test('regenerating replaces the earlier draft completely', () {
      final b = w.batch([3]);
      final staff = w.staff(4), halls = w.halls(4);
      final id = b.sessions.single.id;
      w.s.allocation.generate(id, staff, halls);
      w.s.allocation.generate(id, staff.take(2).toList(), halls.take(2).toList());
      expect(w.s.allocation.sessionAllocation(id), hasLength(2));
    });

    test('the number of staff must equal the number of halls, each once', () {
      final b = w.batch([3]);
      final staff = w.staff(4), halls = w.halls(4);
      final id = b.sessions.single.id;
      expect(() => w.s.allocation.generate(id, staff, halls.take(3).toList()), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('must equal'))));
      expect(() => w.s.allocation.generate(id, [staff[0], staff[0], staff[1], staff[2]], halls), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('more than once'))));
      expect(() => w.s.allocation.generate(id, staff, [halls[0], halls[0], halls[1], halls[2]]), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('more than once'))));
      expect(() => w.s.allocation.generate(9999, staff, halls), throwsA(isA<ArgumentError>()));
      expect(w.s.allocation.sessionAllocation(id), isEmpty, reason: 'nothing was saved');
    });

    test('an inactive person or an inactive hall is reported by the checks, and cannot be confirmed', () {
      final b = w.batch([3]);
      final staff = w.staff(3), halls = w.halls(3);
      w.s.master.deactivateStaff(staff.first);
      final hall = w.s.master.halls().last;
      w.s.master.saveHall(id: hall.id, hallCode: hall.hallCode, layout: hall.layout, isActive: false);
      final id = b.sessions.single.id;
      final r = w.s.allocation.generate(id, staff, halls);
      expect(r.validation.isValid, isFalse);
      expect(r.validation.blockingErrors.map((e) => e.rule), containsAll(['R5', 'R6']));
      final c = w.s.allocation.confirm(id);
      expect(c.success, isFalse);
      expect(c.validation!.blockingErrors.map((e) => e.rule), containsAll(['R5', 'R6']));
      expect(w.s.db.query('SELECT id FROM rotation_history'), isEmpty);
    });
  });

  group('the rotation: nobody repeats a hall until they have been through the others', () {
    test('over three sessions with three halls each person has each hall once', () {
      final b = w.batch([3, 4, 5]);
      final staff = w.staff(3), halls = w.halls(3);
      final seen = {for (final u in staff) u: <int>{}};
      for (final s in b.sessions) {
        final r = w.s.allocation.generate(s.id, staff, halls);
        expect(r.validation.isValid, isTrue, reason: '${r.validation.blockingErrors.map((e) => e.message)}');
        expect(w.s.allocation.confirm(s.id).success, isTrue);
        hallOf(s.id).forEach((u, h) => expect(seen[u]!.add(h), isTrue, reason: 'user $u got hall $h twice in one cycle'));
      }
      for (final u in staff) {
        expect(seen[u], halls.toSet());
      }
    });

    test('after a full cycle a new cycle starts cleanly', () {
      final b = w.batch([3, 4, 5, 6]);
      final staff = w.staff(3), halls = w.halls(3);
      for (final s in b.sessions) {
        final r = w.s.allocation.generate(s.id, staff, halls);
        expect(r.validation.isValid, isTrue, reason: 'session ${s.rotationStep}: ${r.validation.blockingErrors.map((e) => e.message)}');
        expect(w.s.allocation.confirm(s.id).success, isTrue, reason: 'session ${s.rotationStep}');
      }
      expect(w.s.db.query('SELECT id FROM rotation_history'), hasLength(12));
    });

    test('with more halls than a person visits, the least visited halls come first', () {
      final b = w.batch([3, 4]);
      final staff = w.staff(2), halls = w.halls(4);
      w.s.allocation.generate(b.sessions[0].id, staff, halls.take(2).toList());
      w.s.allocation.confirm(b.sessions[0].id);
      final first = hallOf(b.sessions[0].id);
      // the second session offers all four halls to the same two people: they must go to the two halls they have not had
      final r = w.s.allocation.generate(b.sessions[1].id, staff, halls.skip(2).toList());
      expect(r.validation.isValid, isTrue);
      final second = hallOf(b.sessions[1].id);
      for (final u in staff) {
        expect(second[u], isNot(first[u]));
      }
    });
  });

  group('confirming', () {
    test('there must be an allocation, and the earlier sessions must be confirmed first', () {
      final b = w.batch([3, 4]);
      final staff = w.staff(2), halls = w.halls(2);
      expect(w.s.allocation.confirm(b.sessions[0].id).error, contains('No allocations'));
      expect(w.s.allocation.confirm(9999).error, isNotNull);
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      final r = w.s.allocation.confirm(b.sessions[1].id);
      expect(r.success, isFalse);
      expect(r.validation!.blockingErrors.map((e) => e.rule), contains('R4'));
      expect(r.validation!.blockingErrors.firstWhere((e) => e.rule == 'R4').message, contains('Confirm sessions in order'));
    });

    test('confirming writes the rotation history, locks the session and is recorded', () {
      final b = w.batch([3]);
      final staff = w.staff(3), halls = w.halls(3);
      final id = b.sessions.single.id;
      w.s.allocation.generate(id, staff, halls);
      expect(w.s.allocation.confirm(id).success, isTrue);
      expect(w.s.cycles.session(id)!.status, 'confirmed');
      expect(w.s.db.query('SELECT id FROM rotation_history WHERE session_id = ?', [id]), hasLength(3));
      expect(w.s.db.query('SELECT id FROM audit_log WHERE action = ?', ['CONFIRM_ALLOCATION']), hasLength(1));
      // locked: no regenerating, no editing
      expect(() => w.s.allocation.generate(id, staff, halls), throwsA(isA<ArgumentError>().having((e) => e.message, 'message', contains('already confirmed'))));
      expect(w.s.allocation.edit(id, staff.first, halls.last).error!.rule, 'LOCKED');
    });
  });

  group('manual edits are swaps, checked for both people', () {
    late ({ExamCycle cycle, List<ExamSession> sessions}) b;
    late List<int> staff, halls;

    setUp(() {
      b = w.batch([3, 4, 5]);
      staff = w.staff(3);
      halls = w.halls(3);
    });

    test('giving a person another hall gives their hall to the one who had it, and is marked as edited', () {
      final id = b.sessions[0].id;
      w.s.allocation.generate(id, staff, halls);
      final before = hallOf(id);
      final target = before[staff[1]]!;
      final r = w.s.allocation.edit(id, staff[0], target, 'Requested by HOD');
      expect(r.success, isTrue, reason: '${r.error?.message}');
      expect(r.swappedWithUserId, staff[1]);
      final after = hallOf(id);
      expect(after[staff[0]], target);
      expect(after[staff[1]], before[staff[0]]);
      expect(after[staff[2]], before[staff[2]]);
      final rows = {for (final a in w.s.allocation.sessionAllocation(id)) a.userId: a};
      expect(rows[staff[0]]!.isManuallyEdited, isTrue);
      expect(rows[staff[0]]!.editReason, 'Requested by HOD');
      expect(rows[staff[2]]!.isManuallyEdited, isFalse);
      expect(w.s.db.query('SELECT id FROM audit_log WHERE action = ?', ['SWAP_ALLOCATION']), hasLength(1));
    });

    test('swapping back marks the pair as unedited again', () {
      final id = b.sessions[0].id;
      w.s.allocation.generate(id, staff, halls);
      final before = hallOf(id);
      w.s.allocation.edit(id, staff[0], before[staff[1]]!);
      w.s.allocation.edit(id, staff[0], before[staff[0]]!);
      expect(hallOf(id), before);
      expect(w.s.allocation.sessionAllocation(id).every((a) => !a.isManuallyEdited), isTrue);
    });

    test('the hall a person already has, and a hall outside the session, are refused', () {
      final id = b.sessions[0].id;
      w.s.allocation.generate(id, staff.take(2).toList(), halls.take(2).toList());
      expect(w.s.allocation.edit(id, staff[0], hallOf(id)[staff[0]]!).error!.rule, 'NO_CHANGE');
      expect(w.s.allocation.edit(id, staff[0], halls[2]).error!.rule, 'SESSION_POOL');
      expect(w.s.allocation.edit(id, staff[2], halls[0]).error!.rule, 'SESSION', reason: 'a person with no hall in this session');
      expect(w.s.allocation.edit(9999, staff[0], halls[0]).error!.rule, 'SESSION');
    });

    test('a swap that would repeat a hall for either person is refused, naming the person and the earlier date', () {
      // session 1 confirmed: each person has a hall; session 2: moving a person back to their old hall repeats it
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      final first = hallOf(b.sessions[0].id);
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      final r = w.s.allocation.edit(b.sessions[1].id, staff[0], first[staff[0]]!);
      expect(r.success, isFalse);
      expect(r.error!.rule, 'R1');
      expect(r.error!.message, contains('Anu A'));
      expect(r.error!.message, contains(World.day(3)));
    });

    test('the halls offered for a person say why a hall is not allowed', () {
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      final first = hallOf(b.sessions[0].id);
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      final offered = {for (final v in w.s.allocation.validHallsFor(staff[0], b.sessions[1].id)) v.hallId: v};
      expect(offered.keys.toSet(), halls.toSet());
      expect(offered[hallOf(b.sessions[1].id)[staff[0]]!]!.reason, 'Current hall');
      expect(offered[first[staff[0]]!]!.isValid, isFalse);
      expect(offered[first[staff[0]]!]!.reason, 'Already visited in cycle');
    });
  });

  group('restarting the rotation, and the history', () {
    test('restarting clears the history, tells every active person and is recorded', () {
      final b = w.batch([3, 4]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      final first = hallOf(b.sessions[0].id);
      w.s.allocation.generate(b.sessions[1].id, staff, halls);
      expect(w.s.allocation.validHallsFor(staff[0], b.sessions[1].id).firstWhere((v) => v.hallId == first[staff[0]]).isValid, isFalse);
      w.s.allocation.restartRotation();
      expect(w.s.db.query('SELECT id FROM rotation_history'), isEmpty);
      expect(w.s.db.query('SELECT id FROM notifications WHERE title = ?', ['Rotation Restarted']), hasLength(2));
      expect(w.s.db.query('SELECT id FROM audit_log WHERE action = ?', ['ROTATION_RESTART']), hasLength(1));
      expect(w.s.allocation.validHallsFor(staff[0], b.sessions[1].id).firstWhere((v) => v.hallId == first[staff[0]]).isValid, isTrue, reason: 'every hall is open again');
    });

    test('the history lists confirmed duties only, and can be filtered', () {
      final b = w.batch([3, 4]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.confirm(b.sessions[0].id);
      w.s.allocation.generate(b.sessions[1].id, staff, halls); // a draft: not in the history
      expect(w.s.allocation.history(), hasLength(2));
      expect(w.s.allocation.history(cycleId: b.cycle.id), hasLength(2));
      expect(w.s.allocation.history(cycleId: 9999), isEmpty);
      expect(w.s.allocation.history(userId: staff[0]), hasLength(1));
      expect(w.s.allocation.history(hallId: halls[0]), hasLength(1));
      expect(w.s.allocation.history(sessionId: b.sessions[1].id), isEmpty);
      final duties = w.s.allocation.staffDutyHistory(staff[0]);
      expect(duties, hasLength(1));
      expect(duties.single.examDate, World.day(3));
    });

    test('sessions with an allocation are offered for copying, newest first', () {
      final b = w.batch([3, 4, 5]);
      final staff = w.staff(2), halls = w.halls(2);
      w.s.allocation.generate(b.sessions[0].id, staff, halls);
      w.s.allocation.generate(b.sessions[2].id, staff, halls);
      final list = w.s.allocation.sessionSelections();
      expect(list.map((x) => x.id), [b.sessions[2].id, b.sessions[0].id]);
      expect(list.first.staffCount, 2);
    });
  });
}
