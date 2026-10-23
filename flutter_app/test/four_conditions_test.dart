import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/services/app_services.dart';

import 'support/seat_oracle.dart';

void main() {
  test('the checker itself catches each of the four violations', () {
    final halls = [SeatHall(1, 'H1', const HallLayout(rows: 2, cols: 2))];
    const patterns = {1: ['MM']};
    final who = {1: const Sitter('M', 'A', 'p'), 2: const Sitter('M', 'A', 'p'), 3: const Sitter('F', 'B', 'q'), 4: const Sitter('M', 'C', 'p')};
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 1, col: 1, seat: 'L'), (studentId: 3, hallId: 1, row: 1, col: 1, seat: 'R')]), isNotEmpty, reason: 'a girl in a boys seat');
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 1, col: 1, seat: 'L'), (studentId: 2, hallId: 1, row: 1, col: 1, seat: 'R')]), isNotEmpty, reason: 'one class on a bench');
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 1, col: 1, seat: 'R'), (studentId: 4, hallId: 1, row: 1, col: 2, seat: 'L')]), isNotEmpty, reason: 'one subject across the aisle');
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 1, col: 1, seat: 'L'), (studentId: 4, hallId: 1, row: 1, col: 1, seat: 'L')]), isNotEmpty, reason: 'a seat twice');
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 9, col: 9, seat: 'L')]), isNotEmpty, reason: 'a seat that does not exist');
    expect(violations(halls, patterns, who, [(studentId: 1, hallId: 1, row: 1, col: 1, seat: 'L'), (studentId: 4, hallId: 1, row: 2, col: 2, seat: 'L')]), isEmpty, reason: 'a legal pair is accepted');
  });

  test('generated plans, with and without subjects, satisfy all four conditions', () {
    var seated = 0, plans = 0;
    for (var seed = 1; seed <= 120; seed++) {
      final rnd = Random(seed);
      final subjects = seed.isEven;
      final students = <SeatStudent>[];
      var id = 1;
      for (var d = 1; d <= 3 + rnd.nextInt(4); d++) {
        for (var b = 0; b < 2 + rnd.nextInt(3); b++) {
          final paper = subjects ? 'sub:${1 + rnd.nextInt(4)}' : null;
          for (var i = 0, n = 2 + rnd.nextInt(24); i < n; i++) {
            students.add(SeatStudent(id: id++, rollNo: 'S$id', gender: rnd.nextBool() ? 'M' : 'F', batch: '${2022 + b}-${2026 + b}', departmentId: d, deptCode: 'D$d', paper: paper));
          }
        }
      }
      final want = (students.length * (0.7 + rnd.nextDouble() * 0.9)).ceil();
      final halls = <SeatHall>[];
      var seats = 0;
      while (seats < want) {
        final rows = 3 + rnd.nextInt(4), cols = 2 + rnd.nextInt(3);
        final disabled = rnd.nextInt(3) == 0 ? ['1-$cols'] : const <String>[];
        final chairs = rnd.nextInt(3) == 0 ? {'2-1': SeatKind.chair} : const <String, SeatKind>{};
        halls.add(SeatHall(halls.length + 1, 'H${halls.length + 1}', HallLayout(rows: rows, cols: cols, disabled: disabled, kinds: chairs)));
        seats += seatCount(halls.last.layout);
      }
      final cfg = normalizeConfig(autoConfigure(students, halls), halls);
      final plan = planSeatingWithLocks(students, halls, cfg, '2026-2027', const []);
      final who = {for (final s in students) s.id: Sitter(s.gender, '${s.departmentId}|${s.batch}', s.paper)};
      final found = violations(halls, {for (final c in cfg.halls) c.hallId: c.pattern}, who, plan.seats.map(placed).toList());
      expect(found, isEmpty, reason: 'seed $seed: $found');
      seated += plan.seats.length;
      plans++;
    }
    expect(plans, 120);
    expect(seated, greaterThan(2000), reason: 'the plans are big enough to mean something');
  });

  test('plans with locked halls, after the students change, still satisfy all four conditions', () {
    for (var seed = 1; seed <= 60; seed++) {
      final rnd = Random(seed * 31);
      final students = <SeatStudent>[];
      var id = 1;
      for (var d = 1; d <= 4; d++) {
        for (var b = 0; b < 3; b++) {
          final paper = 'sub:${1 + rnd.nextInt(3)}';
          for (var i = 0, n = 4 + rnd.nextInt(14); i < n; i++) {
            students.add(SeatStudent(id: id++, rollNo: 'S$id', gender: rnd.nextBool() ? 'M' : 'F', batch: '${2022 + b}-${2026 + b}', departmentId: d, deptCode: 'D$d', paper: paper));
          }
        }
      }
      final halls = [for (var h = 1; h <= 8; h++) SeatHall(h, 'H$h', HallLayout(rows: 4 + rnd.nextInt(3), cols: 3 + rnd.nextInt(2)))];
      final first = normalizeConfig(autoConfigure(students, halls), halls);
      final plan1 = planSeatingWithLocks(students, halls, first, '2026-2027', const []);
      // Lock some halls, drop some students and add others, and seat the rest again.
      final locked = (halls.map((h) => h.id).toList()..shuffle(rnd)).take(3).toList();
      final kept = students.where((s) => rnd.nextInt(5) != 0).toList();
      final newcomers = [for (var i = 0; i < 6; i++) SeatStudent(id: 1000 + i, rollNo: 'N$i', gender: i.isEven ? 'M' : 'F', batch: '2025-2029', departmentId: 9, deptCode: 'D9', paper: 'sub:${1 + i % 3}')];
      final now = [...kept, ...newcomers];
      final openStudents = now.where((s) => !plan1.seats.any((x) => locked.contains(x.hallId) && x.studentId == s.id)).toList();
      final openHalls = halls.where((h) => !locked.contains(h.id)).toList();
      final cfg2 = autoConfigure(openStudents, openHalls);
      final merged = first.copyWith(
          halls: [...first.halls.where((c) => locked.contains(c.hallId)), ...cfg2.halls.where((c) => !locked.contains(c.hallId))], lockedHalls: locked);
      final plan2 = planSeatingWithLocks(now, halls, merged, '2026-2027', plan1.seats);
      final who = {for (final s in now) s.id: Sitter(s.gender, '${s.departmentId}|${s.batch}', s.paper)};
      final norm = normalizeConfig(merged, halls);
      final found = violations(halls, {for (final c in norm.halls) c.hallId: c.pattern}, who, plan2.seats.map(placed).toList());
      expect(found, isEmpty, reason: 'seed $seed: $found');
      // The locked halls kept exactly their seats (for the students who are still selected).
      for (final x in plan1.seats.where((x) => locked.contains(x.hallId) && now.any((s) => s.id == x.studentId))) {
        expect(plan2.seats.any((y) => y.studentId == x.studentId && y.hallId == x.hallId && y.row == x.row && y.col == x.col && y.seat == x.seat), isTrue, reason: 'seed $seed: locked seat moved');
      }
    }
  });

  test('on a real database, after saving and after many manual moves, the four conditions still hold', () {
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    final session = demo.sessionIds[1];
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    final hallIds = [for (final c in ['H101', 'H102', 'H201', 'H202']) s.master.halls().firstWhere((h) => h.hallCode == c).id];
    s.allocation.generate(session, staff.take(4).toList(), hallIds);
    final subjects = s.subjects.list().where((x) => x.studentIds.isNotEmpty).take(3).map((x) => x.id).toList();
    final ids = s.students.list(isActive: true).map((x) => x.id).toList();
    final auto = s.students.autoConfigureSeating(session, ids, sessionSubjects: subjects);
    expect(auto.success, isTrue, reason: '${auto.error}');
    expect(s.students.confirm(session, ids, auto.config!.copyWith(sessionSubjects: subjects), acceptUnallocated: true).success, isTrue);

    List<String> check() {
      final saved = s.students.savedSeating(session)!;
      final halls = [for (final h in s.master.halls().where((h) => hallIds.contains(h.id))) SeatHall(h.id, h.hallCode, h.layout)];
      final mapped = <int, List<int>>{};
      for (final r in s.db.query('SELECT student_id, subject_id FROM student_subjects')) {
        mapped.putIfAbsent(r['student_id'] as int, () => []).add(r['subject_id'] as int);
      }
      final rows = s.students.sessionSeating(session);
      final who = {
        for (final x in rows)
          x.studentId: Sitter(x.gender, '${x.deptCode}|${x.batch}', (mapped[x.studentId] ?? const <int>[]).where(subjects.contains).map((id) => 'sub:$id').firstOrNull)
      };
      // A student with no chosen subject writes with their class; papers are compared only between students who have one.
      return violations(halls, {for (final c in saved.config.halls) c.hallId: c.pattern}, who, [for (final x in rows) (studentId: x.studentId, hallId: x.hallId, row: x.benchRow, col: x.benchCol, seat: x.seat)]);
    }

    expect(check(), isEmpty);
    var moved = 0;
    for (var round = 0; round < 60; round++) {
      final all = s.students.sessionSeating(session);
      final a = all[(round * 7 + 1) % all.length], b = all[(round * 11 + 3) % all.length];
      if (a.studentId == b.studentId) continue;
      if (s.students.moveSeat(session, a.studentId, hallId: b.hallId, row: b.benchRow, col: b.benchCol, seat: b.seat).success) moved++;
      expect(check(), isEmpty, reason: 'after move $round');
    }
    expect(moved, greaterThan(0));
    // Locking and seating the rest again keeps them too.
    s.students.setHallsLocked(session, [hallIds.first], true);
    expect(s.students.regenerateRemaining(session).success, isTrue);
    expect(check(), isEmpty);
  });
}
