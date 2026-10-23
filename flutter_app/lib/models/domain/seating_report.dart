/// RULE REPORT of a seating plan: which rules were met, which had to be relaxed, and - when students could not be
/// seated - which rule was the one that stopped each of them. Pure logic.
///
/// The rules, checked and satisfied in this order (a rule is given up only after every rule above it has been kept;
/// the first is physical and never given up, and none of 1 to 4 is ever broken):
///   1. Hall capacity            is there a seat for everyone? (per group, and a seat that really exists)
///   2. Same subject adjacency   students writing the same subject never sit side by side (bench mate or across the aisle)
///   3. Gender / bench pattern   a seat is used only by the gender its bench pattern gives it
///   4. Same class on one bench  two students of one class never share a bench
///   5. Classes per hall         3 by default (the preferred number), 4 at the most; the 4th class is allowed only
///                               when otherwise somebody would be left without a seat
///
/// The planner never breaks rules 1 to 4, and never goes past the limit of 5: a student for whom no seat satisfies
/// them stays "unallocated". This report says, in plain words, which rule that was (the first one in the order above
/// that held the student back), and whenever rule 5 was relaxed.
library;

import 'hall_layout.dart';
import 'seating.dart';

enum RuleStatus { met, relaxed, blocking, notApplicable }

class RuleFinding {
  final int priority;
  final String rule;
  final RuleStatus status;
  final String detail;
  /// Students affected: left without a seat because of this rule (blocking), or seated only because it was relaxed.
  final int students;
  final String? suggestion;
  const RuleFinding({required this.priority, required this.rule, required this.status, required this.detail, this.students = 0, this.suggestion});
}

class PlanReport {
  final List<RuleFinding> findings;
  /// The students left without a seat, each with the rule that stopped them.
  final List<UnallocatedStudent> unallocated;
  const PlanReport(this.findings, this.unallocated);

  Iterable<RuleFinding> get blocking => findings.where((f) => f.status == RuleStatus.blocking);
  Iterable<RuleFinding> get relaxed => findings.where((f) => f.status == RuleStatus.relaxed);

  /// Every rule kept as asked: nothing relaxed and nobody left out.
  bool get allMet => blocking.isEmpty && relaxed.isEmpty;

  /// One line for each rule that was relaxed or that stopped students, for warnings.
  List<String> get warnings => [
        for (final f in findings)
          if (f.status == RuleStatus.blocking || f.status == RuleStatus.relaxed) '${f.rule}: ${f.detail}',
      ];
}

String _word(String g) => g == 'M' ? 'boys' : (g == 'F' ? 'girls' : 'students');

/// Builds the report of [plan], which was made for [students] and [halls] under [config] (patterns of locked halls
/// included). [classLabel] names a student's class or subject in the messages.
PlanReport reportPlan({
  required List<SeatStudent> students,
  required List<SeatHall> halls,
  required SeatingConfig config,
  required Object? academicYear,
  required SeatingPlan plan,
  List<Seat> lockedSeats = const [],
  String Function(SeatStudent)? classLabel,
}) {
  final mix = config.mixGenders;
  String groupOf(String gender) => mix ? '*' : gender;
  final groups = mix ? const ['*'] : genders;
  String label(SeatStudent s) => classLabel?.call(s) ?? studentCategory(s, academicYear).label;

  final studentById = {for (final s in students) s.id: s};
  final hallOf = {for (final h in halls) h.id: h};
  final limit = config.classLimit ?? defaultClassLimit;

  // Totals, seats and benches for each group the rules work on (boys and girls, or everyone in roll-number order).
  final total = {for (final g in groups) g: students.where((s) => groupOf(s.gender) == g).length};
  final seatsFor = {for (final g in groups) g: 0};
  final benchesFor = {for (final g in groups) g: 0};
  final hallsFor = {for (final g in groups) g: 0};
  for (final c in config.halls) {
    final hall = hallOf[c.hallId];
    if (hall == null || c.pattern.isEmpty) continue;
    final benches = enabledBenches(hall.layout);
    final seats = patternSeats(c.pattern, benches);
    for (final g in groups) {
      final n = mix ? seats['M']! + seats['F']! : seats[g]!;
      seatsFor[g] = seatsFor[g]! + n;
      if (n > 0) hallsFor[g] = hallsFor[g]! + 1;
    }
    for (var i = 0; i < benches.length; i++) {
      for (final g in groups) {
        if (mix || seatGender(c.pattern, i, 'L') == g) benchesFor[g] = benchesFor[g]! + 1;
      }
    }
  }
  final unseated = plan.unallocated.length;

  // 1 and 2: capacity and gender.
  final noSeats = [for (final g in groups) if (total[g]! > 0 && seatsFor[g] == 0) g];
  final short = [for (final g in groups) if (total[g]! > 0 && seatsFor[g]! > 0 && total[g]! > seatsFor[g]!) g];
  final capacity = short.isNotEmpty
      ? RuleFinding(
          priority: 1,
          rule: 'Hall capacity',
          status: RuleStatus.blocking,
          students: short.fold(0, (n, g) => n + total[g]! - seatsFor[g]!),
          detail: short.map((g) => '${total[g]} ${_word(g)} are selected but the halls have only ${seatsFor[g]} seats for them (short by ${total[g]! - seatsFor[g]!})').join('; '),
          suggestion: 'Add a hall, or benches, or give another hall to ${short.map(_word).join(' and ')}.')
      : const RuleFinding(priority: 1, rule: 'Hall capacity', status: RuleStatus.met, detail: 'every group has at least as many seats as students');
  final gender = mix
      ? const RuleFinding(priority: 3, rule: 'Gender / bench pattern', status: RuleStatus.notApplicable, detail: 'boys and girls are seated together in roll-number order')
      : noSeats.isNotEmpty
          ? RuleFinding(
              priority: 3,
              rule: 'Gender / bench pattern',
              status: RuleStatus.blocking,
              students: noSeats.fold(0, (n, g) => n + total[g]!),
              detail: 'no hall has a bench pattern with seats for ${noSeats.map(_word).join(' and ')}, so ${noSeats.map((g) => '${total[g]} ${_word(g)}').join(' and ')} cannot sit anywhere',
              suggestion: 'Give a hall a bench pattern with seats for ${noSeats.map(_word).join(' and ')}.')
          : const RuleFinding(priority: 3, rule: 'Gender / bench pattern', status: RuleStatus.met, detail: 'every seat is used only by the gender its bench pattern gives it');

  // 3: one class never twice on a bench, so a class can use at most one seat per bench.
  final tooBig = <String, ({String name, int n, int benches, String group})>{};
  for (final g in groups) {
    final sizes = <String, List<SeatStudent>>{};
    for (final s in students.where((s) => groupOf(s.gender) == g)) {
      sizes.putIfAbsent(seatClassKey(s), () => []).add(s);
    }
    sizes.forEach((key, list) {
      if (benchesFor[g]! > 0 && list.length > benchesFor[g]!) tooBig['$g|$key'] = (name: label(list.first), n: list.length, benches: benchesFor[g]!, group: g);
    });
  }
  final bench = tooBig.isNotEmpty
      ? RuleFinding(
          priority: 4,
          rule: 'Same class never on one bench',
          status: RuleStatus.blocking,
          students: tooBig.values.fold(0, (n, x) => n + x.n - x.benches),
          detail: tooBig.values.take(3).map((x) => '${x.name} has ${x.n} ${_word(x.group)} but there are only ${x.benches} benches for them, and two of one class never share a bench').join('; ') +
              (tooBig.length > 3 ? '; and ${tooBig.length - 3} more' : ''),
          suggestion: 'Add benches or halls for ${tooBig.values.map((x) => _word(x.group)).toSet().join(' and ')}.')
      : const RuleFinding(priority: 4, rule: 'Same class never on one bench', status: RuleStatus.met, detail: 'no bench has two students of one class (or one subject)');

  // 4 and 5: what-if runs. Only when somebody is left without a seat, plan again with one rule switched off and see
  // how many students it was holding back.
  final bySubject = students.any((s) => s.paper != null);
  var sideGain = 0, limitGain = 0;
  if (unseated > 0) {
    if (bySubject) {
      sideGain = unseated - planWithoutRule(students, halls, config, academicYear, lockedSeats, noSideRule: true).unallocated.length;
    }
    limitGain = unseated - planWithoutRule(students, halls, config, academicYear, lockedSeats, noClassLimit: true).unallocated.length;
  }
  final side = !bySubject
      ? const RuleFinding(priority: 2, rule: 'Same subject never adjacent', status: RuleStatus.notApplicable, detail: 'no subjects were chosen for this exam')
      : sideGain > 0
          ? RuleFinding(
              priority: 2,
              rule: 'Same subject never adjacent',
              status: RuleStatus.blocking,
              students: sideGain,
              detail: '$sideGain student${sideGain == 1 ? '' : 's'} could be seated only beside a student writing the same subject',
              suggestion: 'Add halls or benches so that students writing one subject can be spread out.')
          : const RuleFinding(priority: 2, rule: 'Same subject never adjacent', status: RuleStatus.met, detail: 'nobody sits beside a student writing the same subject');

  final classesIn = <int, Set<String>>{};
  for (final x in plan.seats) {
    final s = studentById[x.studentId];
    if (s != null) classesIn.putIfAbsent(x.hallId, () => {}).add(seatClassKey(s));
  }
  final overPreferred = [for (final e in classesIn.entries) if (e.value.length > limit.preferred) (hall: hallOf[e.key]?.hallCode ?? '#${e.key}', n: e.value.length)]
    ..sort((a, b) => a.hall.compareTo(b.hall));
  final String limitNote = 'preferred ${limit.preferred}, at most ${limit.max} classes in a hall';
  final tooFewHalls = <String>[];
  var hallsMissing = 0;
  for (final g in groups) {
    final classes = students.where((s) => groupOf(s.gender) == g).map(seatClassKey).toSet().length;
    final need = (classes + limit.max - 1) ~/ limit.max;
    if (hallsFor[g]! > 0 && need > hallsFor[g]!) {
      tooFewHalls.add('${g == '*' ? 'the students' : _word(g)} are in $classes different classes, at most ${limit.max} to a hall, so they need at least $need halls but only ${hallsFor[g]} ${hallsFor[g] == 1 ? 'is' : 'are'} set for them');
      hallsMissing += need - hallsFor[g]!;
    }
  }
  final classLimit = limitGain > 0
      ? RuleFinding(
          priority: 5,
          rule: 'Classes per hall',
          status: RuleStatus.blocking,
          students: limitGain,
          detail: '$limitGain student${limitGain == 1 ? '' : 's'} could not be seated because a hall may hold at most ${limit.max} different classes ($limitNote)${tooFewHalls.isEmpty ? '' : ': ${tooFewHalls.join('; ')}'}',
          suggestion: hallsMissing > 0 ? 'Add at least $hallsMissing more hall${hallsMissing == 1 ? '' : 's'} for them, or choose fewer different subjects.' : 'Add halls so that fewer classes share one hall.')
      : overPreferred.isNotEmpty
          ? RuleFinding(
              priority: 5,
              rule: 'Classes per hall',
              status: RuleStatus.relaxed,
              students: overPreferred.length,
              detail: '${overPreferred.map((x) => '${x.hall} holds ${x.n} classes').join(', ')} instead of ${limit.preferred}, because otherwise some students would have no seat (limit: $limitNote)')
          : RuleFinding(priority: 5, rule: 'Classes per hall', status: RuleStatus.met, detail: 'no hall holds more than ${limit.preferred} classes ($limitNote)');

  final findings = [capacity, side, gender, bench, classLimit];

  // For each student left out, the first rule (in priority order) that still has students to blame: a rule is named for
  // as many students as it really held back (the shortfall of seats, the students beyond a class's benches, what
  // switching the rule off would have seated), so one rule is not blamed for another's students.
  final capacityLeft = {for (final g in groups) g: short.contains(g) ? total[g]! - seatsFor[g]! : 0};
  final benchLeft = {for (final e in tooBig.entries) e.key: e.value.n - e.value.benches};
  var sideLeft = sideGain, limitLeft = limitGain;
  String reasonFor(UnallocatedStudent u) {
    final g = groupOf(u.gender), word = _word(g == '*' ? u.gender : g);
    // 1. Hall capacity.
    if (capacityLeft[g]! > 0) {
      capacityLeft[g] = capacityLeft[g]! - 1;
      return 'Blocked by hall capacity: ${total[g]} $word are selected but the halls have only ${seatsFor[g]} seats for them. ${capacity.suggestion}';
    }
    // 2. Same subject adjacency (a student with no seat for their gender at all was not held back by it: see rule 3).
    if (sideLeft > 0 && !noSeats.contains(g)) {
      sideLeft--;
      return 'Blocked by the same-subject adjacency rule: the only free seats are beside a student writing the same subject.';
    }
    // 3. Gender / bench pattern.
    if (noSeats.contains(g)) return 'Blocked by the gender / bench pattern rule: ${gender.detail}.';
    // 4. Same class on one bench.
    final s = studentById[u.studentId];
    final key = s == null ? null : '$g|${seatClassKey(s)}';
    if (key != null && (benchLeft[key] ?? 0) > 0) {
      benchLeft[key] = benchLeft[key]! - 1;
      final big = tooBig[key]!;
      return 'Blocked by the same-class bench rule: ${big.name} has ${big.n} ${_word(big.group)} but only ${big.benches} benches are available for them, and two of one class never share a bench.';
    }
    // 5. Classes per hall.
    if (limitLeft > 0) {
      limitLeft--;
      return 'Blocked by the class limit: the free seats are in halls that already hold ${limit.max} different classes (the most allowed).';
    }
    return u.reason;
  }

  final unallocated = [
    for (final u in plan.unallocated)
      UnallocatedStudent(studentId: u.studentId, rollNo: u.rollNo, name: u.name, gender: u.gender, categoryKey: u.categoryKey, category: u.category, reason: reasonFor(u))
  ];
  return PlanReport(findings, unallocated);
}
