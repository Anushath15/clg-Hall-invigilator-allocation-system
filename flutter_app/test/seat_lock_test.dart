import 'package:collection/collection.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/entities.dart';
import 'package:hias/services/app_services.dart';

/// Locking halls: a locked hall keeps its students and seats when the students or the halls change; only the
/// remaining students are seated again, in the halls that are not locked.
void main() {
  late AppServices s;
  late int session;
  late int h101, h102, h201, h202, lab1;

  List<int> allIds() => s.students.list(isActive: true).map((x) => x.id).toList();
  int hall(String code) => s.master.halls().firstWhere((h) => h.hallCode == code).id;
  Map<int, String> seatMap(int hallId) => {for (final x in s.students.sessionSeating(session).where((x) => x.hallId == hallId)) x.studentId: '${x.benchNo}${x.seat}'};
  Set<int> seatedIds() => s.students.sessionSeating(session).map((x) => x.studentId).toSet();

  /// Seats `ids` with the automatic configuration, like the screen does.
  ConfirmResultLike seat(List<int> ids) {
    final auto = s.students.autoConfigureSeating(session, ids);
    expect(auto.success, isTrue, reason: '${auto.error}');
    final saved = s.students.savedSeating(session);
    final r = s.students.confirm(session, ids, auto.config!.copyWith(classLimit: saved?.config.classLimit), acceptUnallocated: true);
    expect(r.success, isTrue, reason: '${r.error}');
    return ConfirmResultLike(r.seated, r.unallocated.length);
  }

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    session = demo.sessionIds[1]; // still pending, so its halls can be changed
    h101 = hall('H101');
    h102 = hall('H102');
    h201 = hall('H201');
    h202 = hall('H202');
    lab1 = hall('LAB1');
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    s.allocation.generate(session, staff.take(4).toList(), [h101, h102, h201, h202]);
    seat(allIds());
  });

  test('only a hall that has students can be locked, and a lock is kept in the saved plan', () {
    expect(s.students.setHallsLocked(session, [hall('AUD')], true), isNotNull, reason: 'a hall of no student has nothing to keep');
    expect(s.students.setHallsLocked(session, [h101], true), isNull);
    expect(s.students.savedSeating(session)!.config.lockedHalls, [h101]);
    expect(s.students.setHallsLocked(session, [h101], false), isNull);
    expect(s.students.savedSeating(session)!.config.lockedHalls, isEmpty);
  });

  test('fewer students: locked halls keep every seat, the others are seated again without the leavers', () {
    s.students.setHallsLocked(session, [h101, h102], true);
    final before101 = seatMap(h101), before102 = seatMap(h102);
    // Eight students of the unlocked halls drop out of the exam.
    final leaving = s.students.sessionSeating(session).where((x) => x.hallId == h201 || x.hallId == h202).take(8).map((x) => x.studentId).toSet();
    final ids = allIds().where((id) => !leaving.contains(id)).toList();
    final r = seat(ids);
    expect(seatMap(h101), before101);
    expect(seatMap(h102), before102);
    expect(seatedIds().intersection(leaving), isEmpty);
    expect(r.seated + r.unallocated, ids.length, reason: 'everyone selected is seated (locked halls included) or listed as unallocated');
    expect(seatedIds().length, ids.length);
    expect(s.students.savedSeating(session)!.config.lockedHalls..sort(), [h101, h102]..sort());
  });

  test('more students: the new ones are seated only in halls that are not locked', () {
    s.students.setHallsLocked(session, [h101], true);
    final before = seatMap(h101);
    final leaving = s.students.sessionSeating(session).where((x) => x.hallId == h201 || x.hallId == h202).take(8).map((x) => x.studentId).toSet();
    final dept = s.master.departments().first.id;
    final fresh = <int>[];
    for (var i = 0; i < 3; i++) {
      final r = s.students.save(rollNo: 'NEW${i + 1}', registerNo: '9999000$i', name: 'New Student $i', gender: i.isEven ? 'M' : 'F', departmentId: dept, section: 'A', batch: '2022-2026');
      expect(r.success, isTrue, reason: '${r.error}');
    }
    fresh.addAll(s.students.list().where((x) => x.rollNo.startsWith('NEW')).map((x) => x.id));
    final ids = [...allIds().where((id) => !leaving.contains(id) && !fresh.contains(id)), ...fresh];
    seat(ids);
    expect(seatMap(h101), before, reason: 'the locked hall did not change');
    final now = s.students.sessionSeating(session);
    for (final id in fresh) {
      final x = now.firstWhereOrNull((r) => r.studentId == id);
      expect(x, isNotNull, reason: 'student $id has a seat');
      expect(x!.hallId, isNot(h101), reason: '${x.rollNo} must not be put into the locked hall');
    }
  });

  test('a hall removed from the session: locked halls survive, the rest is seated again in the halls now available', () {
    s.students.setHallsLocked(session, [h101, h102], true);
    final before101 = seatMap(h101), before102 = seatMap(h102);
    final others = s.students.sessionSeating(session).where((x) => x.hallId == h201 || x.hallId == h202).map((x) => x.studentId).toSet();

    // The invigilator allocation is made again with H201 and H202 replaced by LAB1.
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    s.allocation.generate(session, staff.take(3).toList(), [h101, h102, lab1]);
    expect(seatMap(h101), before101, reason: 'a locked hall is not thrown away with the others');
    expect(seatMap(h102), before102);
    expect(seatedIds().intersection(others), isEmpty, reason: 'the seating of the removed halls is gone');
    expect(s.students.savedSeating(session)!.config.lockedHalls..sort(), [h101, h102]..sort());

    final r = s.students.regenerateRemaining(session);
    expect(r.success, isTrue, reason: '${r.error}');
    expect(seatMap(h101), before101);
    expect(seatMap(h102), before102);
    final now = s.students.sessionSeating(session);
    for (final x in now.where((x) => others.contains(x.studentId))) {
      expect(x.hallId, lab1, reason: 'the others can only sit in the hall that is open');
    }
    expect(now.length + r.unallocated.length, allIds().length, reason: 'everyone is seated or listed as unallocated');
  });

  test('with every hall locked there is no seat for a new student, and the reason says so', () {
    s.students.setHallsLocked(session, [h101, h102, h201, h202], true);
    final dept = s.master.departments().first.id;
    expect(s.students.save(rollNo: 'LATE1', registerNo: '99991111', name: 'Late Student', gender: 'M', departmentId: dept, section: 'A', batch: '2022-2026').success, isTrue);
    final ids = allIds();
    final r = s.students.confirm(session, ids, s.students.autoConfigureSeating(session, ids).config!, acceptUnallocated: true);
    expect(r.success, isTrue, reason: '${r.error}');
    expect(r.unallocated.map((u) => u.rollNo), ['LATE1']);
    expect(r.unallocated.single.reason, contains('locked'));
  });

  test('a student cannot be moved into or out of a locked hall by hand', () {
    s.students.setHallsLocked(session, [h101], true);
    final inLocked = s.students.sessionSeating(session).firstWhere((x) => x.hallId == h101);
    final outside = s.students.sessionSeating(session).firstWhere((x) => x.hallId == h102);
    final fromLocked = s.students.moveSeat(session, inLocked.studentId, hallId: h102, row: outside.benchRow, col: outside.benchCol, seat: outside.seat);
    expect(fromLocked.success, isFalse);
    expect(fromLocked.error, contains('locked'));
    final intoLocked = s.students.moveSeat(session, outside.studentId, hallId: h101, row: inLocked.benchRow, col: inLocked.benchCol, seat: inLocked.seat);
    expect(intoLocked.success, isFalse);
    expect(intoLocked.error, contains('locked'));
  });

  test('regenerating with no locked hall seats everyone afresh, as before', () {
    final r = s.students.regenerateRemaining(session);
    expect(r.success, isTrue, reason: '${r.error}');
    expect(seatedIds().length + r.unallocated.length, allIds().length);
  });
}

class ConfirmResultLike {
  final int seated, unallocated;
  const ConfirmResultLike(this.seated, this.unallocated);
}
