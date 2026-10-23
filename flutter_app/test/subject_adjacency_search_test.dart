import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';

import 'support/seat_oracle.dart';

/// A student left with "a seat only beside a student writing the same subject" is not accepted: the plan tries other
/// orders of the classes until the rule holds for everyone it can, then goes on to the next rule.
///
/// These sessions come from a family where one quick pass left 1 to 10 students without a seat, blamed on same-subject
/// adjacency and the class limit, although another order seats everybody.
void main() {
  ({List<SeatStudent> students, List<SeatHall> halls}) session(int seed) {
    final rnd = Random(seed * 101);
    final students = <SeatStudent>[];
    var id = 1;
    final depts = 3 + rnd.nextInt(3), batches = 2 + rnd.nextInt(2);
    for (var d = 1; d <= depts; d++) {
      for (var b = 0; b < batches; b++) {
        final paper = 'sub:${1 + rnd.nextInt(5)}';
        for (var i = 0, n = 4 + rnd.nextInt(14); i < n; i++) {
          students.add(SeatStudent(id: id++, rollNo: 'S$id', gender: rnd.nextBool() ? 'M' : 'F', batch: '${2022 + b}-${2026 + b}', departmentId: d, deptCode: 'D$d', paper: paper));
        }
      }
    }
    final want = (students.length * (1.0 + rnd.nextDouble() * 0.2)).ceil();
    final halls = <SeatHall>[];
    var seats = 0;
    while (seats < want) {
      halls.add(SeatHall(halls.length + 1, 'H${halls.length + 1}', HallLayout(rows: 3 + rnd.nextInt(3), cols: 2 + rnd.nextInt(3))));
      seats += seatCount(halls.last.layout);
    }
    return (students: students, halls: halls);
  }

  for (final seed in [7, 17, 43, 49, 57, 58]) {
    test('session $seed: one quick pass leaves students out, the search seats everyone, and every condition holds', () {
      final x = session(seed);
      final cfg = normalizeConfig(autoConfigure(x.students, x.halls), x.halls);
      final quick = planSeating(x.students, x.halls, cfg, '2026-2027');
      expect(quick.unallocated, isNotEmpty, reason: 'this is a session the quick pass cannot finish');
      final plan = planSeatingWithLocks(x.students, x.halls, cfg, '2026-2027', const []);
      expect(plan.unallocated, isEmpty, reason: 'everyone has a seat');
      expect(plan.seats.length, x.students.length);
      final who = {for (final s in x.students) s.id: Sitter(s.gender, seatClassKey(s), s.paper)};
      expect(violations(x.halls, {for (final c in cfg.halls) c.hallId: c.pattern}, who, plan.seats.map(placed).toList()), isEmpty);
    });
  }

  test('the search never seats fewer students than the quick pass, and the plan is the same every time', () {
    for (var seed = 1; seed <= 60; seed++) {
      final x = session(seed);
      final cfg = normalizeConfig(autoConfigure(x.students, x.halls), x.halls);
      final quick = planSeating(x.students, x.halls, cfg, '2026-2027');
      final a = planSeatingWithLocks(x.students, x.halls, cfg, '2026-2027', const []);
      expect(a.unallocated.length, lessThanOrEqualTo(quick.unallocated.length), reason: 'seed $seed');
      if (quick.unallocated.isEmpty) {
        // Nothing left out: the first answer stands, untouched by the search.
        expect(a.seats.map((s) => '${s.studentId}@${s.hallId}${s.benchNo}${s.seat}').toList(), quick.seats.map((s) => '${s.studentId}@${s.hallId}${s.benchNo}${s.seat}').toList(), reason: 'seed $seed');
      }
    }
  });
}
