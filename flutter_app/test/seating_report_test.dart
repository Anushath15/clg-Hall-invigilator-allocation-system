import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';
import 'package:hias/models/domain/seating_report.dart';

/// Smart allocation: every hard rule is tried first; when they cannot all be satisfied the report says which rule
/// stopped whom, and a rule is never broken without saying so.
void main() {
  const year = '2026-2027';
  SeatStudent st(int id, String g, int dept, {String batch = '2023-2027', String? paper}) =>
      SeatStudent(id: id, rollNo: 'S$id', gender: g, batch: batch, departmentId: dept, deptCode: 'D$dept', paper: paper);
  SeatHall hall(int id, int rows, int cols) => SeatHall(id, 'H$id', HallLayout(rows: rows, cols: cols));

  ({SeatingPlan plan, PlanReport report, SeatingConfig config}) run(List<SeatStudent> students, List<SeatHall> halls, {SeatingConfig? config, ClassLimit? limit}) {
    final cfg = normalizeConfig(config ?? autoConfigure(students, halls, classLimit: limit), halls);
    final plan = planSeatingWithLocks(students, halls, cfg, year, const []);
    return (plan: plan, report: reportPlan(students: students, halls: halls, config: cfg, academicYear: year, plan: plan), config: cfg);
  }

  RuleFinding rule(PlanReport r, String name) => r.findings.firstWhere((f) => f.rule == name);

  test('everything fits: every rule is met, nobody is left out, nothing is said', () {
    final students = [for (var i = 1; i <= 8; i++) st(i, 'M', 1 + i % 4)];
    final r = run(students, [hall(1, 3, 2), hall(2, 3, 2)]);
    expect(r.plan.unallocated, isEmpty);
    expect(r.report.allMet, isTrue);
    expect(r.report.warnings, isEmpty);
    expect(r.report.findings.map((f) => f.priority), [1, 2, 3, 4, 5], reason: 'rules are listed in priority order');
  });

  test('not enough seats: Hall capacity is named with the exact shortfall, and only for the students it held back', () {
    final students = [for (var i = 1; i <= 10; i++) st(i, 'M', i)]; // 10 boys of 10 classes
    final r = run(students, [hall(1, 3, 1)]); // 3 benches = 6 seats, and a hall holds at most 4 classes
    final f = rule(r.report, 'Hall capacity');
    expect(f.status, RuleStatus.blocking);
    expect(f.students, 4);
    expect(f.detail, contains('short by 4'));
    // 4 students are short of seats; 2 more cannot sit because the hall may hold only 4 classes: each is told its own rule.
    final reasons = r.report.unallocated.map((u) => u.reason).toList();
    expect(reasons.length, r.plan.unallocated.length);
    expect(reasons.where((x) => x.startsWith('Blocked by hall capacity')).length, 4);
    expect(reasons.where((x) => x.startsWith('Blocked by the class limit')).length, reasons.length - 4);
    expect(reasons.first, contains('only 6 seats'));
  });

  test('no seats for a gender: the Gender rule is named, not a generic message', () {
    final students = [for (var i = 1; i <= 4; i++) st(i, 'M', i), for (var i = 5; i <= 7; i++) st(i, 'F', i)];
    final cfg = SeatingConfig(halls: const [HallSeatingConfig(1, ['MM'])], classLimit: defaultClassLimit);
    final r = run(students, [hall(1, 3, 1)], config: cfg);
    final f = rule(r.report, 'Gender rule');
    expect(f.status, RuleStatus.blocking);
    expect(f.students, 3);
    expect(r.report.unallocated.map((u) => u.rollNo), unorderedEquals(['S5', 'S6', 'S7']));
    for (final u in r.report.unallocated) {
      expect(u.reason, startsWith('Blocked by the gender rule'));
    }
  });

  test('a class too big for the benches: the same-class bench rule is named', () {
    final students = [for (var i = 1; i <= 8; i++) st(i, 'M', 1)]; // one class of 8 boys
    final r = run(students, [hall(1, 4, 1)]); // 4 benches, 8 seats: enough seats, but one per bench for a class
    expect(r.plan.unallocated.length, 4);
    expect(rule(r.report, 'Hall capacity').status, RuleStatus.met, reason: 'there are enough seats');
    final f = rule(r.report, 'Same class never on one bench');
    expect(f.status, RuleStatus.blocking);
    expect(f.detail, contains('8 boys'));
    expect(f.detail, contains('only 4 benches'));
    for (final u in r.report.unallocated) {
      expect(u.reason, startsWith('Blocked by the same-class bench rule'));
    }
  });

  test('random sessions: no rule is broken, and nobody is left out without a named rule', () {
    var withLeftovers = 0, relaxedSeen = 0, sideSeen = 0, limitSeen = 0;
    for (var seed = 1; seed <= 120; seed++) {
      final rnd = Random(seed);
      final useSubjects = seed.isEven;
      final students = <SeatStudent>[];
      var id = 1;
      final depts = 3 + rnd.nextInt(4), batches = 2 + rnd.nextInt(3);
      for (var d = 1; d <= depts; d++) {
        for (var b = 0; b < batches; b++) {
          final size = 2 + rnd.nextInt(24);
          final paper = useSubjects ? 'sub:${1 + rnd.nextInt(4)}' : null;
          for (var i = 0; i < size; i++) {
            students.add(st(id++, rnd.nextBool() ? 'M' : 'F', d, batch: '${2022 + b}-${2026 + b}', paper: paper));
          }
        }
      }
      final want = (students.length * (0.7 + rnd.nextDouble() * 0.9)).ceil(); // from short of seats to roomy
      final halls = <SeatHall>[];
      var seats = 0;
      while (seats < want) {
        final rows = 3 + rnd.nextInt(4), cols = 2 + rnd.nextInt(3);
        halls.add(hall(halls.length + 1, rows, cols));
        seats += rows * cols * 2;
      }
      final r = run(students, halls);
      // Hard rules: the independent validator finds nothing wrong, whatever was left out.
      expect(validateSeatingPlan(r.plan.seats, r.plan.unallocated, students, halls, r.config), isEmpty, reason: 'seed $seed');
      // Nobody is left out without a finding that blocks, and each student's reason names a rule.
      if (r.plan.unallocated.isNotEmpty) {
        withLeftovers++;
        expect(r.report.blocking, isNotEmpty, reason: 'seed $seed: students are left out but no rule is blamed');
        for (final u in r.report.unallocated) {
          expect(u.reason, startsWith('Blocked by'), reason: 'seed $seed: ${u.rollNo} has no named rule');
        }
      } else {
        expect(r.report.blocking, isEmpty, reason: 'seed $seed');
      }
      // The class limit is reported whenever it was stretched, and never stretched past the maximum.
      if (rule(r.report, 'Classes per hall').status == RuleStatus.relaxed) relaxedSeen++;
      if (rule(r.report, 'Classes per hall').status == RuleStatus.blocking) limitSeen++;
      if (rule(r.report, 'Subject separation').status == RuleStatus.blocking) sideSeen++;
      final classesIn = <int, Set<String>>{};
      final byId = {for (final s in students) s.id: s};
      for (final x in r.plan.seats) {
        classesIn.putIfAbsent(x.hallId, () => {}).add(seatClassKey(byId[x.studentId]!));
      }
      final most = classesIn.values.fold(0, (m, v) => max(m, v.length));
      expect(most, lessThanOrEqualTo(4), reason: 'seed $seed');
      expect(rule(r.report, 'Classes per hall').status == RuleStatus.relaxed || rule(r.report, 'Classes per hall').status == RuleStatus.blocking || most <= 3, isTrue,
          reason: 'seed $seed: a 4th class in a hall must be reported');
    }
    // The scenarios must really cover the interesting cases.
    expect(withLeftovers, greaterThan(10));
    expect(relaxedSeen, greaterThan(0));
    // ignore: avoid_print
    print('120 sessions: $withLeftovers had students left out, class limit relaxed in $relaxedSeen, class limit blocking in $limitSeen, subject separation blocking in $sideSeen');
  });
}
