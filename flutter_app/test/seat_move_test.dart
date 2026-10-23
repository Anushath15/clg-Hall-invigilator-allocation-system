import 'package:collection/collection.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/entities.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/services/student_service.dart';

/// Moving a seated student by hand: every rule is checked again and a move that breaks one is refused.
/// The demo session has boys' halls (H101, H201) and girls' halls (H102, H202); H201 and H202 have chairs.
void main() {
  late AppServices s;
  late int session;

  SeatRow seatOf(String roll) => s.students.sessionSeating(session).firstWhere((x) => x.rollNo == roll);
  int hallId(String code) => s.master.halls().firstWhere((h) => h.hallCode == code).id;
  String where(String roll) {
    final x = seatOf(roll);
    return '${x.hallCode}-${x.benchNo}${x.seat}';
  }

  MoveSeatResult moveTo(String roll, String hallCode, String targetRoll) {
    final t = seatOf(targetRoll);
    return s.students.moveSeat(session, seatOf(roll).studentId, hallId: hallId(hallCode), row: t.benchRow, col: t.benchCol, seat: t.seat);
  }

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    session = seedDemo(s).sessionIds.first;
  });

  test('a swap that keeps every rule is saved, for both students', () {
    // 23CS018 and 22CS004 are both boys of different classes: after the swap no bench pairs one class twice.
    final a = where('23CS018'), b = where('22CS004');
    final r = moveTo('23CS018', 'H101', '22CS004');
    expect(r.success, isTrue, reason: '${r.error}');
    expect(r.swappedWith, '22CS004');
    expect(where('23CS018'), b);
    expect(where('22CS004'), a);
  });

  test('a move that puts two students of one class on a bench is refused, with the reason', () {
    // Swapping 22CS004 with 22EC002 would seat 22EC002 beside 22EC004 on bench 2.
    final before = s.students.sessionSeating(session).map((x) => '${x.rollNo}@${x.hallCode}${x.benchNo}${x.seat}').toList();
    final r = moveTo('22CS004', 'H101', '22EC002');
    expect(r.success, isFalse);
    expect(r.reasons.join(' '), contains('same class'));
    expect(r.reasons.join(' '), contains('22EC002'));
    expect(s.students.sessionSeating(session).map((x) => '${x.rollNo}@${x.hallCode}${x.benchNo}${x.seat}').toList(), before, reason: 'a refused move changes nothing');
  });

  test('a boy cannot take a seat the bench pattern gives to a girl', () {
    final r = moveTo('23CS018', 'H102', '23CS017');
    expect(r.success, isFalse);
    expect(r.reasons.join(' '), contains('bench pattern gives to a girl'));
    expect(r.reasons.join(' '), contains('bench pattern gives to a boy'), reason: 'the girl taking his seat is refused too');
  });

  test('a chair has no right seat, and a bench that does not exist cannot be used', () {
    // Turn a bench of H201 that has only a left student into a chair.
    var h = s.master.halls().firstWhere((x) => x.hallCode == 'H201');
    final spot = enabledBenches(h.layout).firstWhere((b) => b.benchNo == 5);
    final saved = s.master.saveHall(id: h.id, hallCode: h.hallCode, block: h.block, floor: h.floor, layout: h.layout.copyWith(kinds: {benchKey(spot.row, spot.col): SeatKind.chair}));
    expect(saved.success, isTrue, reason: '${saved.error}');
    h = s.master.halls().firstWhere((x) => x.hallCode == 'H201');
    final chair = enabledBenches(h.layout).firstWhere((b) => b.seats == 1);
    final mover = seatOf('23CS018').studentId;
    final onChair = s.students.moveSeat(session, mover, hallId: h.id, row: chair.row, col: chair.col, seat: 'R');
    expect(onChair.success, isFalse);
    expect(onChair.error, contains('single chair'));
    final off = s.students.moveSeat(session, mover, hallId: h.id, row: 4, col: 3, seat: 'L');
    expect(off.success, isFalse);
    expect(off.error, contains('no bench'));
  });

  test('a free seat can be taken when every rule still holds, and the move is saved', () {
    final h = s.master.halls().firstWhere((x) => x.hallCode == 'H201');
    final taken = s.students.sessionSeating(session).where((x) => x.hallId == h.id).map((x) => '${x.benchRow}-${x.benchCol}-${x.seat}').toSet();
    final mover = seatOf('23ME018');
    MoveSeatResult? done;
    for (final b in enabledBenches(h.layout)) {
      for (final seat in b.seats == 2 ? ['L', 'R'] : ['L']) {
        if (taken.contains('${b.row}-${b.col}-$seat')) continue;
        final r = s.students.moveSeat(session, mover.studentId, hallId: h.id, row: b.row, col: b.col, seat: seat);
        if (r.success) {
          done = r;
          expect(r.swappedWith, isNull);
          final now = seatOf('23ME018');
          expect([now.benchRow, now.benchCol, now.seat], [b.row, b.col, seat]);
          break;
        }
      }
      if (done != null) break;
    }
    expect(done, isNotNull, reason: 'at least one free seat of H201 accepts him');
  });

  test('the same seat, an unseated student and a foreign hall are refused', () {
    final x = seatOf('23CS018');
    expect(s.students.moveSeat(session, x.studentId, hallId: x.hallId, row: x.benchRow, col: x.benchCol, seat: x.seat).error, contains('already'));
    expect(s.students.moveSeat(session, 999999, hallId: x.hallId, row: 1, col: 1, seat: 'L').error, contains('seated student'));
    expect(s.students.moveSeat(session, x.studentId, hallId: hallId('AUD'), row: 1, col: 1, seat: 'L').error, contains('halls of this session'));
  });
}
