import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/services/app_services.dart';

import 'support/seat_oracle.dart';

/// GENDER BASED ALLOCATION of the halls: whole halls for boys and for girls. Only when the halls are too few for that,
/// ONE hall holds both boys and girls (of the same classes too) - on separate benches: a boy and a girl never share a
/// bench, and never more than one hall is mixed.
void main() {
  SeatStudent st(int id, String g, int dept, {String batch = '2023-2027'}) => SeatStudent(id: id, rollNo: 'S$id', gender: g, batch: batch, departmentId: dept, deptCode: 'D$dept');
  SeatHall hall(int id, int rows, int cols) => SeatHall(id, 'H$id', HallLayout(rows: rows, cols: cols));

  ({SeatingPlan plan, SeatingConfig config, List<String> problems}) run(List<SeatStudent> students, List<SeatHall> halls) {
    final cfg = normalizeConfig(autoConfigure(students, halls), halls);
    final plan = planSeatingWithLocks(students, halls, cfg, '2026-2027', const []);
    final who = {for (final s in students) s.id: Sitter(s.gender, '${s.departmentId}|${s.batch}', s.paper)};
    return (plan: plan, config: cfg, problems: violations(halls, {for (final c in cfg.halls) c.hallId: c.pattern}, who, plan.seats.map(placed).toList()));
  }

  int mixedHalls(SeatingConfig c) => c.halls.where((h) => patternIsMixed(h.pattern)).length;

  test('enough halls: boys and girls get whole halls of their own, and no hall is mixed', () {
    // 40 boys and 40 girls of four classes, two halls of 40 seats.
    final students = [for (var c = 1; c <= 4; c++) ...[for (var i = 0; i < 10; i++) st(c * 100 + i, 'M', c), for (var i = 0; i < 10; i++) st(c * 100 + 50 + i, 'F', c)]];
    final r = run(students, [hall(1, 4, 5), hall(2, 4, 5)]);
    expect(r.problems, isEmpty);
    expect(r.plan.unallocated, isEmpty);
    expect(mixedHalls(r.config), 0);
    expect(r.plan.hallGender.values.toSet(), {'M', 'F'});
  });

  test('too few halls for a clean split: exactly one hall holds boys and girls, on separate benches, and everybody sits', () {
    // 48 boys and 24 girls (every class has both): two halls of 40 seats cannot be shared out whole (48 boys > 40), but
    // they have the 80 seats that 72 students need.
    final students = [for (var c = 1; c <= 4; c++) ...[for (var i = 0; i < 12; i++) st(c * 100 + i, 'M', c), for (var i = 0; i < 6; i++) st(c * 100 + 50 + i, 'F', c)]];
    final halls = [hall(1, 4, 5), hall(2, 4, 5)];
    final whole = normalizeConfig(autoConfigure(students, halls, separateOnly: true), halls);
    final leftWhole = planSeating(students, halls, whole, '2026-2027').unallocated.length;
    expect(leftWhole, greaterThan(0), reason: 'whole halls alone leave students without a seat');

    final r = run(students, halls);
    expect(r.problems, isEmpty, reason: '${r.problems}');
    expect(r.plan.unallocated, isEmpty, reason: 'with one mixed hall everybody is seated');
    expect(mixedHalls(r.config), 1);
    // The mixed hall really holds both genders, and no bench holds a boy with a girl (the checker verifies it too).
    final gender = {for (final s in students) s.id: s.gender};
    final byHall = <int, Set<String>>{};
    final byBench = <String, Set<String>>{};
    for (final x in r.plan.seats) {
      byHall.putIfAbsent(x.hallId, () => {}).add(gender[x.studentId]!);
      byBench.putIfAbsent('${x.hallId}-${x.row}-${x.col}', () => {}).add(gender[x.studentId]!);
    }
    expect(byHall.values.where((g) => g.length == 2).length, 1, reason: 'one hall has both genders');
    expect(byBench.values.where((g) => g.length == 2), isEmpty, reason: 'no bench has a boy and a girl');
  });

  test('random sessions: never more than one mixed hall, a mixed hall only when it seats more, and no bench with a boy and a girl', () {
    var usedMixed = 0, sessions = 0;
    for (var seed = 1; seed <= 100; seed++) {
      final rnd = Random(seed * 29);
      final students = <SeatStudent>[];
      var id = 1;
      final boysShare = 0.2 + rnd.nextDouble() * 0.6;
      for (var d = 1; d <= 3 + rnd.nextInt(4); d++) {
        for (var b = 0; b < 2 + rnd.nextInt(2); b++) {
          for (var i = 0, n = 5 + rnd.nextInt(25); i < n; i++) {
            students.add(st(id++, rnd.nextDouble() < boysShare ? 'M' : 'F', d, batch: '${2022 + b}-${2026 + b}'));
          }
        }
      }
      final halls = <SeatHall>[];
      var seats = 0;
      while (seats < (students.length * (1.0 + rnd.nextDouble() * 0.2)).ceil()) {
        halls.add(hall(halls.length + 1, 5 + rnd.nextInt(6), 4 + rnd.nextInt(4)));
        seats += seatCount(halls.last.layout);
      }
      final r = run(students, halls);
      expect(r.problems, isEmpty, reason: 'seed $seed: ${r.problems}');
      expect(mixedHalls(r.config), lessThanOrEqualTo(1), reason: 'seed $seed');
      if (mixedHalls(r.config) == 1) {
        usedMixed++;
        final whole = normalizeConfig(autoConfigure(students, halls, separateOnly: true), halls);
        expect(r.plan.unallocated.length, lessThan(planSeating(students, halls, whole, '2026-2027').unallocated.length), reason: 'seed $seed: the mixed hall must seat more than whole halls do');
      }
      sessions++;
    }
    expect(sessions, 100);
    expect(usedMixed, greaterThan(3), reason: 'the sessions really needed a mixed hall now and then');
  });

  test('a configuration with two halls that hold both boys and girls is refused, naming them', () {
    final students = [for (var i = 1; i <= 8; i++) st(i, i.isEven ? 'M' : 'F', 1 + i % 3)];
    final halls = [hall(1, 3, 2), hall(2, 3, 2)];
    final cfg = SeatingConfig(halls: const [HallSeatingConfig(1, ['MM', 'FF']), HallSeatingConfig(2, ['MM', 'FF'])], classLimit: defaultClassLimit);
    final plan = planSeating(students, halls, cfg, '2026-2027');
    final errors = validateSeatingPlan(plan.seats, plan.unallocated, students, halls, cfg);
    expect(errors.join(' '), contains('Only one hall may hold both boys and girls'));
    expect(errors.join(' '), contains('H1, H2'));
    // One mixed hall and a whole hall is fine.
    final ok = SeatingConfig(halls: const [HallSeatingConfig(1, ['MM', 'FF']), HallSeatingConfig(2, ['MM'])], classLimit: defaultClassLimit);
    final okPlan = planSeating(students, halls, ok, '2026-2027');
    expect(validateSeatingPlan(okPlan.seats, okPlan.unallocated, students, halls, ok).where((e) => e.contains('Only one hall')), isEmpty);
  });

  test('roll number order says that it lets a boy and a girl share a bench', () {
    final students = [for (var i = 1; i <= 8; i++) st(i, i.isEven ? 'M' : 'F', 1 + i % 3)];
    final halls = [hall(1, 3, 2)];
    final cfg = autoConfigure(students, halls, mixGenders: true);
    final warnings = checkConfig(cfg, halls, students).warnings;
    expect(warnings.join(' '), contains('a boy and a girl can share a bench'));
  });

  test('through the application: the plan says which hall is mixed and why', () {
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    final session = demo.sessionIds[1];
    final staff = s.master.staff(role: 'staff').map((u) => u.id).toList();
    s.allocation.generate(session, staff.take(2).toList(), [for (final c in ['H101', 'H102']) s.master.halls().firstWhere((h) => h.hallCode == c).id]);
    // 30 boys and 18 girls: the two halls have 24 seats each, so whole halls cannot hold 30 boys.
    final all = s.students.list(isActive: true);
    final ids = [...all.where((x) => x.gender == 'M').take(30).map((x) => x.id), ...all.where((x) => x.gender == 'F').take(18).map((x) => x.id)];
    final auto = s.students.autoConfigureSeating(session, ids);
    expect(auto.success, isTrue, reason: '${auto.error}');
    final p = s.students.preview(session, ids, auto.separateConfig!);
    expect(p.errors, isEmpty, reason: '${p.errors}');
    expect(p.plan!.unallocated, isEmpty);
    expect(p.warnings.where((w) => w.contains('holds both boys and girls, on separate benches')).length, 1);
    expect(p.plan!.hallGender.values.where((g) => g == 'mixed').length, 1);
  });
}
