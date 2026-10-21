import 'package:collection/collection.dart';

import '../../core/format.dart';
import 'categories.dart';
import 'hall_layout.dart';

/// STUDENT SEATING for one exam session (pure logic, ported from shared/seating.ts).
///
/// Each hall follows a BENCH PATTERN, repeated bench by bench: "MM" both seats boys, "FF" both
/// seats girls (a boy and a girl never share a bench). Two students of the same class (department
/// + batch, or the same paper when subjects are entered) never share a bench. Seats are filled hall
/// by hall, column by column, the left-seat column then the right-seat column; each seat column
/// takes one class in roll-number order and the classes take the seat columns in turn. Every hall
/// holds at most `classLimit.preferred` classes, relaxed up to `classLimit.max` only to seat everyone.
/// Leftovers are then seated by swaps where possible; anyone still left is listed as unallocated.

const genders = ['M', 'F'];
const genderGroup = {'M': 'Boys', 'F': 'Girls'};
const benchTypes = ['MM', 'FF'];
const benchTypeLabel = {'MM': 'Boy + Boy', 'FF': 'Girl + Girl'};
const maxPatternLength = 600;
const minClassesPerHall = 2, maxClassesPerHall = 4;

class ClassLimit {
  final int preferred, max;
  const ClassLimit(this.preferred, this.max);
  Map<String, Object?> toJson() => {'preferred': preferred, 'max': max};
  @override
  bool operator ==(Object other) => other is ClassLimit && other.preferred == preferred && other.max == max;
  @override
  int get hashCode => Object.hash(preferred, max);
}

const defaultClassLimit = ClassLimit(3, 4);

ClassLimit normalizeClassLimit(Object? limit) {
  Object? p, m;
  if (limit is ClassLimit) {
    p = limit.preferred;
    m = limit.max;
  } else if (limit is Map) {
    p = limit['preferred'];
    m = limit['max'];
  }
  int clamp(Object? v, int lo, int fallback) {
    final n = v is num ? v.floor() : num.tryParse('${v ?? ''}')?.floor();
    return n == null ? fallback : n.clamp(lo, maxClassesPerHall);
  }

  final preferred = clamp(p, minClassesPerHall, defaultClassLimit.preferred);
  return ClassLimit(preferred, clamp(m, preferred, preferred > defaultClassLimit.max ? preferred : defaultClassLimit.max));
}

class SeatStudent {
  final int id;
  final String rollNo, gender, batch;
  final int? departmentId;
  final String? deptCode, name;
  final String? paper;
  final List<int>? subjectIds;
  const SeatStudent({required this.id, required this.rollNo, required this.gender, required this.batch, this.departmentId, this.deptCode, this.name, this.paper, this.subjectIds});

  SeatStudent copyWith({String? gender, String? paper, bool clearPaper = false}) => SeatStudent(
      id: id, rollNo: rollNo, gender: gender ?? this.gender, batch: batch, departmentId: departmentId, deptCode: deptCode, name: name,
      paper: clearPaper ? null : (paper ?? this.paper), subjectIds: subjectIds);
}

class SeatHall {
  final int id;
  final String hallCode;
  final HallLayout layout;
  const SeatHall(this.id, this.hallCode, this.layout);
}

class Seat {
  int studentId;
  final int hallId, row, col, benchNo;
  final String seat; // "L" | "R"
  Seat({required this.studentId, required this.hallId, required this.row, required this.col, required this.benchNo, required this.seat});
}

class HallSeatingConfig {
  final int hallId;
  final List<String> pattern;
  const HallSeatingConfig(this.hallId, this.pattern);
  Map<String, Object?> toJson() => {'hallId': hallId, 'pattern': pattern};
}

class SeatingConfig {
  final List<HallSeatingConfig> halls;
  final ClassLimit? classLimit;
  final bool mixGenders;
  final Map<String, int>? subjects;
  final List<int>? sessionSubjects;
  const SeatingConfig({required this.halls, this.classLimit, this.mixGenders = false, this.subjects, this.sessionSubjects});

  SeatingConfig copyWith({List<HallSeatingConfig>? halls, ClassLimit? classLimit, bool? mixGenders, Map<String, int>? subjects, List<int>? sessionSubjects}) =>
      SeatingConfig(
          halls: halls ?? this.halls,
          classLimit: classLimit ?? this.classLimit,
          mixGenders: mixGenders ?? this.mixGenders,
          subjects: subjects ?? this.subjects,
          sessionSubjects: sessionSubjects ?? this.sessionSubjects);

  Map<String, Object?> toJson() => {
        'halls': halls.map((h) => h.toJson()).toList(),
        if (classLimit != null) 'classLimit': classLimit!.toJson(),
        if (mixGenders) 'mixGenders': true,
        if (subjects != null && subjects!.isNotEmpty) 'subjects': subjects,
        if (sessionSubjects != null && sessionSubjects!.isNotEmpty) 'sessionSubjects': sessionSubjects,
      };

  /// Reads a saved configuration (also older ones, which saved a gender per hall).
  static SeatingConfig fromJson(Object? json) {
    if (json is! Map) return const SeatingConfig(halls: []);
    final halls = <HallSeatingConfig>[];
    for (final h in (json['halls'] is List ? json['halls'] as List : const [])) {
      if (h is! Map) continue;
      final id = h['hallId'] is num ? (h['hallId'] as num).toInt() : int.tryParse('${h['hallId']}');
      if (id == null) continue;
      halls.add(HallSeatingConfig(id, hallPattern(h)));
    }
    return SeatingConfig(
      halls: halls,
      classLimit: json['classLimit'] == null ? null : normalizeClassLimit(json['classLimit']),
      mixGenders: json['mixGenders'] == true,
      subjects: cleanSubjects(json['subjects']).isEmpty ? null : cleanSubjects(json['subjects']),
      sessionSubjects: cleanSubjectIds(json['sessionSubjects']).isEmpty ? null : cleanSubjectIds(json['sessionSubjects']),
    );
  }
}

class UnallocatedStudent {
  final int studentId;
  final String rollNo, gender, categoryKey, category, reason;
  final String? name;
  const UnallocatedStudent({required this.studentId, required this.rollNo, this.name, required this.gender, required this.categoryKey, required this.category, required this.reason});
  UnallocatedStudent withGender(String g) =>
      UnallocatedStudent(studentId: studentId, rollNo: rollNo, name: name, gender: g, categoryKey: categoryKey, category: category, reason: reason);
  Map<String, Object?> toJson() =>
      {'studentId': studentId, 'roll_no': rollNo, 'name': name, 'gender': gender, 'categoryKey': categoryKey, 'category': category, 'reason': reason};
  static UnallocatedStudent fromJson(Map j) => UnallocatedStudent(
      studentId: j['studentId'] is num ? (j['studentId'] as num).toInt() : 0,
      rollNo: '${j['roll_no'] ?? ''}',
      name: j['name']?.toString(),
      gender: '${j['gender'] ?? 'M'}',
      categoryKey: '${j['categoryKey'] ?? ''}',
      category: '${j['category'] ?? ''}',
      reason: '${j['reason'] ?? ''}');
}

class HallSummary {
  final int hallId, benches, capacity, occupied, empty;
  final String hallCode;
  final String? gender; // "M" | "F" | "mixed" | null
  final List<String> pattern;
  final Map<String, int> seatsFor;
  final List<({String key, String label, int count})> categories;
  const HallSummary({required this.hallId, required this.hallCode, required this.gender, required this.pattern, required this.benches, required this.capacity, required this.seatsFor, required this.occupied, required this.empty, required this.categories});
  HallSummary withGender(String? g) =>
      HallSummary(hallId: hallId, hallCode: hallCode, gender: g, pattern: pattern, benches: benches, capacity: capacity, seatsFor: seatsFor, occupied: occupied, empty: empty, categories: categories);
}

class GroupTotals {
  final int students, seated, unallocated, halls, seats;
  const GroupTotals(this.students, this.seated, this.unallocated, this.halls, this.seats);
}

class SeatingPlan {
  final List<Seat> seats;
  final Map<int, String?> hallGender;
  final List<HallSummary> halls;
  final List<UnallocatedStudent> unallocated;
  final List<String> warnings;
  final Map<String, GroupTotals> groups;
  const SeatingPlan({required this.seats, required this.hallGender, required this.halls, required this.unallocated, required this.warnings, required this.groups});
}

String _groupWordOf(String g) => g == 'M' ? 'boys' : 'girls';
int _seatsOf(SeatHall h) => seatCount(h.layout);
List<T> _stable<T>(Iterable<T> list, int Function(T, T) cmp) {
  final out = list.toList();
  mergeSort(out, compare: cmp);
  return out;
}

int _seatingOrder(SeatStudent a, SeatStudent b) {
  var c = textCompare(a.batch, b.batch);
  if (c != 0) return c;
  c = naturalCompare(a.deptCode ?? '', b.deptCode ?? '');
  if (c != 0) return c;
  c = naturalCompare(a.rollNo, b.rollNo);
  return c != 0 ? c : a.id - b.id;
}

({String key, String label}) studentCategory(SeatStudent s, Object? academicYear) {
  final y = yearOfStudy(s.batch, academicYear);
  return (key: categoryKey(s.departmentId, s.batch), label: categoryLabel(s.deptCode, y.ok ? y.label : s.batch));
}

// ── Bench patterns ──────────────────────────────────────────

String seatGender(List<String> pattern, int i, String side) => pattern[i % pattern.length][side == 'L' ? 0 : 1];

List<String> sidesOf(int seats) => seats == 2 ? const ['L', 'R'] : const ['L'];

Map<String, int> patternSeats(List<String> pattern, List<Bench> benches) {
  final out = {'M': 0, 'F': 0};
  if (pattern.isEmpty) return out;
  for (var i = 0; i < benches.length; i++) {
    for (final side in sidesOf(benches[i].seats)) {
      final g = seatGender(pattern, i, side);
      out[g] = out[g]! + 1;
    }
  }
  return out;
}

Map<String, int> patternSeatsForCount(List<String> pattern, int benches) =>
    patternSeats(pattern, List.generate(benches, (i) => Bench(row: 1, col: i + 1, benchNo: i + 1, kind: SeatKind.bench, seats: 2)));

String? patternGroup(List<String> pattern) {
  if (pattern.isEmpty) return null;
  final g = {for (final t in pattern) ...[t[0], t[1]]};
  return g.length > 1 ? 'mixed' : g.first;
}

List<String> hallPattern(Object? h) {
  if (h is Map) {
    final p = h['pattern'];
    if (p is List) return p.map((e) => '$e').where(benchTypes.contains).take(maxPatternLength).toList();
    return h['gender'] == 'M' ? ['MM'] : h['gender'] == 'F' ? ['FF'] : [];
  }
  if (h is HallSeatingConfig) return h.pattern;
  return [];
}

// ── Configuration ───────────────────────────────────────────

String _classOf(SeatStudent s) => s.paper ?? categoryKey(s.departmentId, s.batch);

Map<String, int> cleanSubjects(Object? subjects) {
  final out = <String, int>{};
  if (subjects is! Map) return out;
  subjects.forEach((key, value) {
    final id = value is num ? value.floor() : num.tryParse('$value')?.floor();
    if ('$key'.isNotEmpty && id != null && id > 0) out['$key'] = id;
  });
  return out;
}

List<int> cleanSubjectIds(Object? ids) {
  if (ids is! List) return [];
  final out = <int>[];
  for (final v in ids) {
    final n = v is num ? v.floor() : num.tryParse('$v')?.floor();
    if (n != null && n > 0 && !out.contains(n)) out.add(n);
  }
  return out;
}

class SessionSubject {
  final int id;
  final String from; // "student" | "class"
  final List<int> also;
  const SessionSubject(this.id, this.from, this.also);
}

/// The subject a student writes: their own mapping to one of the session's subjects (the first), else their class's.
SessionSubject? sessionSubjectOf(SeatStudent s, Object? subjects, Object? sessionSubjects) {
  final written = cleanSubjectIds(sessionSubjects);
  final mine = written.where((id) => s.subjectIds?.contains(id) ?? false).toList();
  if (mine.isNotEmpty) return SessionSubject(mine.first, 'student', mine.sublist(1));
  final id = cleanSubjects(subjects)[categoryKey(s.departmentId, s.batch)];
  return id != null ? SessionSubject(id, 'class', const []) : null;
}

List<SeatStudent> applySessionSubjects(List<SeatStudent> students, Object? subjects, [Object? sessionSubjects]) => students.map((s) {
      final sub = sessionSubjectOf(s, subjects, sessionSubjects);
      return sub != null ? s.copyWith(paper: 'sub:${sub.id}') : s.copyWith(clearPaper: true);
    }).toList();

bool _bySubject(List<SeatStudent> students) => students.any((s) => s.paper != null);

typedef _BenchAt = Bench? Function(int row, int col);

List<({int row, int col, String side})> _sideNeighbours(_BenchAt benchAt, int row, int col, String side) {
  final here = benchAt(row, col);
  final out = <({int row, int col, String side})>[];
  if (side == 'L') {
    final left = benchAt(row, col - 1);
    if (left != null) out.add((row: row, col: col - 1, side: left.seats == 2 ? 'R' : 'L'));
  }
  if ((side == 'R' || here?.seats == 1) && benchAt(row, col + 1) != null) out.add((row: row, col: col + 1, side: 'L'));
  return out;
}

_BenchAt _benchFinder(List<Bench> benches) {
  final m = {for (final b in benches) '${b.row}-${b.col}': b};
  return (row, col) => m['$row-$col'];
}

SeatingConfig normalizeConfig(SeatingConfig? config, List<SeatHall> halls) {
  final given = <int, List<String>>{};
  for (final h in config?.halls ?? const <HallSeatingConfig>[]) {
    given.putIfAbsent(h.hallId, () => hallPattern(h));
  }
  final mix = config?.mixGenders == true;
  final subjects = cleanSubjects(config?.subjects);
  final sessionSubjects = cleanSubjectIds(config?.sessionSubjects);
  return SeatingConfig(
    halls: halls.map((h) {
      final p = given[h.id] ?? const <String>[];
      return HallSeatingConfig(h.id, mix && p.isNotEmpty ? const ['MM'] : p);
    }).toList(),
    classLimit: normalizeClassLimit(config?.classLimit),
    mixGenders: mix,
    subjects: subjects.isEmpty ? null : subjects,
    sessionSubjects: sessionSubjects.isEmpty ? null : sessionSubjects,
  );
}

bool _lexLess(List<num> a, List<num> b) {
  for (var k = 0; k < a.length; k++) {
    if (a[k] != b[k]) return a[k] < b[k];
  }
  return false;
}

class _SubsetSums {
  final List<int> seats;
  late final int total;
  late final List<List<double>> fewest;
  _SubsetSums(this.seats) {
    total = seats.fold(0, (a, b) => a + b);
    fewest = [List<double>.filled(total + 1, double.infinity)];
    fewest[0][0] = 0;
    for (var i = 0; i < seats.length; i++) {
      final n = seats[i];
      final prev = fewest[i], next = [...prev];
      for (var s = n; s <= total; s++) {
        if (prev[s - n] + 1 < next[s]) next[s] = prev[s - n] + 1;
      }
      fewest.add(next);
    }
  }
  List<double> get _last => fewest[seats.length];
  bool reachable(int s) => s >= 0 && s <= total && _last[s] < double.infinity;
  double count(int s) => _last[s];
  List<int>? pick(int s) {
    if (!(_last[s] < double.infinity)) return null;
    final out = <int>[];
    for (var i = seats.length; i > 0 && s > 0; i--) {
      if (fewest[i - 1][s] == fewest[i][s]) continue;
      out.add(i - 1);
      s -= seats[i - 1];
    }
    return out.reversed.toList();
  }
}

/// Whole halls for boys and girls so the most are seated (every combination tried).
Map<int, String> _separateHalls(Map<String, int> need, List<SeatHall> usable) {
  final seats = usable.map(_seatsOf).toList();
  final all = _SubsetSums(seats);
  ({List<num> score, Map<int, String> genders})? best;
  for (final pair in const [['M', 'F'], ['F', 'M']]) {
    final first = pair[0], second = pair[1];
    ({int s, List<num> score})? choice;
    for (var s = 0; s <= all.total; s++) {
      if (!all.reachable(s)) continue;
      final seated = (s < need[first]! ? s : need[first]!) + ((all.total - s) < need[second]! ? all.total - s : need[second]!);
      final score = <num>[-seated, (s - need[first]!) > 0 ? s - need[first]! : 0, all.count(s)];
      if (choice == null || _lexLess(score, choice.score)) choice = (s: s, score: score);
    }
    final firstHalls = all.pick(choice!.s)!.toSet();
    final restIdx = [for (var i = 0; i < seats.length; i++) if (!firstHalls.contains(i)) i];
    final rest = _SubsetSums(restIdx.map((i) => seats[i]).toList());
    ({int s, List<num> score})? r;
    for (var s = 0; s <= rest.total; s++) {
      if (!rest.reachable(s)) continue;
      final score = <num>[-(s < need[second]! ? s : need[second]!), s, rest.count(s)];
      if (r == null || _lexLess(score, r.score)) r = (s: s, score: score);
    }
    final g = <int, String>{};
    for (final i in firstHalls) {
      g[usable[i].id] = first;
    }
    for (final j in rest.pick(r!.s)!) {
      g[usable[restIdx[j]].id] = second;
    }
    int seatsFor(String x) => usable.where((h) => g[h.id] == x).fold(0, (n, h) => n + _seatsOf(h));
    final seated = (seatsFor('M') < need['M']! ? seatsFor('M') : need['M']!) + (seatsFor('F') < need['F']! ? seatsFor('F') : need['F']!);
    final score = <num>[-seated, seatsFor('M') + seatsFor('F') - seated, g.length];
    if (best == null || _lexLess(score, best.score)) best = (score: score, genders: g);
  }
  return best!.genders;
}

List<SeatStudent> _asOneGroup(List<SeatStudent> students) => students.map((s) => s.copyWith(gender: 'M')).toList();

/// A starting configuration that seats as many students as the halls can hold.
SeatingConfig autoConfigure(List<SeatStudent> students, List<SeatHall> halls, {bool separateOnly = false, bool mixGenders = false, ClassLimit? classLimit}) {
  if (mixGenders) {
    final cfg = autoConfigure(_asOneGroup(students), halls, separateOnly: true, classLimit: classLimit);
    return cfg.copyWith(mixGenders: true);
  }
  var config = _hallSplit(students, halls, separateOnly);
  if (classLimit != null) config = config.copyWith(classLimit: normalizeClassLimit(classLimit));
  final limit = normalizeClassLimit(classLimit);
  for (;;) {
    final left = planSeating(students, halls, config.copyWith(classLimit: ClassLimit(limit.preferred, limit.preferred)), '').unallocated;
    final unused = halls.where((h) => _seatsOf(h) > 0 && config.halls.firstWhere((c) => c.hallId == h.id).pattern.isEmpty).firstOrNull;
    if (left.isEmpty || unused == null) return config;
    final boys = left.where((u) => u.gender == 'M').length;
    config = config.copyWith(
        halls: config.halls.map((c) => c.hallId == unused.id ? HallSeatingConfig(c.hallId, [boys * 2 >= left.length ? 'MM' : 'FF']) : c).toList());
  }
}

SeatingConfig _hallSplit(List<SeatStudent> students, List<SeatHall> halls, bool separateOnly) {
  final need = {'M': students.where((s) => s.gender == 'M').length, 'F': students.where((s) => s.gender == 'F').length};
  final usable = halls.where((h) => _seatsOf(h) > 0).toList();
  final total = usable.fold(0, (n, h) => n + _seatsOf(h));
  final separate = _separateHalls(need, usable);
  int seatsFor(String g) => usable.where((h) => separate[h.id] == g).fold(0, (n, h) => n + _seatsOf(h));
  final separateSeated = (seatsFor('M') < need['M']! ? seatsFor('M') : need['M']!) + (seatsFor('F') < need['F']! ? seatsFor('F') : need['F']!);
  final patterns = <int, List<String>>{};
  final everyone = need['M']! + need['F']!;
  if (separateOnly || separateSeated >= (total < everyone ? total : everyone)) {
    separate.forEach((id, g) => patterns[id] = [g == 'M' ? 'MM' : 'FF']);
  } else {
    var boys = need['M']!, girls = need['F']!;
    for (final h in usable) {
      final benches = enabledBenches(h.layout), seats = _seatsOf(h);
      if (boys >= seats) {
        patterns[h.id] = ['MM'];
        boys -= seats;
        continue;
      }
      if (boys > 0) {
        var boyBenches = 0;
        for (var have = 0; have < boys; boyBenches++) {
          have += benches[boyBenches].seats;
        }
        final p = [for (var i = 0; i < benches.length; i++) i < boyBenches ? 'MM' : 'FF'];
        boys = 0;
        girls -= benches.sublist(boyBenches).fold(0, (n, b) => n + b.seats);
        patterns[h.id] = p.every((t) => t == p.first) ? [p.first] : p;
        continue;
      }
      if (girls > 0) {
        patterns[h.id] = ['FF'];
        girls -= seats;
      }
    }
  }
  return SeatingConfig(halls: halls.map((h) => HallSeatingConfig(h.id, patterns[h.id] ?? const [])).toList());
}

/// One bench pattern for the whole session: halls take it in order until there are enough seats.
SeatingConfig configureWithPattern(Map<String, int> need, List<SeatHall> halls, List<String> pattern) {
  final have = {'M': 0, 'F': 0};
  final used = <int>{};
  for (final h in halls) {
    if (have['M']! >= need['M']! && have['F']! >= need['F']!) break;
    if (_seatsOf(h) == 0 || pattern.isEmpty) continue;
    final seats = patternSeats(pattern, enabledBenches(h.layout));
    used.add(h.id);
    have['M'] = have['M']! + seats['M']!;
    have['F'] = have['F']! + seats['F']!;
  }
  return SeatingConfig(halls: halls.map((h) => HallSeatingConfig(h.id, used.contains(h.id) ? pattern : const [])).toList());
}

/// Why the session's halls cannot seat every selected student; null when they can.
String? seatingShortfall(List<SeatStudent> students, List<SeatHall> halls, [ClassLimit? classLimit]) {
  final boys = students.where((s) => s.gender == 'M').length, girls = students.length - boys;
  final total = halls.fold(0, (n, h) => n + _seatsOf(h));
  if (students.length > total) {
    return '${students.length} students are selected ($boys boys, $girls girls), but this session\'s halls have only $total seats. Add halls with at least ${students.length - total} more seats to the invigilator allocation, or select fewer students.';
  }
  final left = planSeating(students, halls, autoConfigure(students, halls, classLimit: classLimit), '').unallocated.length;
  if (left == 0) return null;
  return 'There are $total seats for ${students.length} students, but two students of the same class never share a bench and each hall holds only a few different classes, so some seats stay empty: $left cannot be seated. Add halls or benches, allow more classes per hall, or select fewer students of the largest classes.';
}

/// Seats leftover students by direct placement or by swaps (changes [seats] and [pools] in place).
void _repairLeftovers(List<SeatStudent> students, SeatingConfig config, Map<int, SeatHall> hallOf, List<Seat> seats,
    Map<String, Map<String, List<SeatStudent>>> pools, int most) {
  final studentById = {for (final s in students) s.id: s};
  final inHall = <int, Map<String, int>>{};
  void count(int hallId, String cls, int by) {
    final m = inHall.putIfAbsent(hallId, () => <String, int>{});
    final n = (m[cls] ?? 0) + by;
    if (n > 0) {
      m[cls] = n;
    } else {
      m.remove(cls);
    }
  }

  for (final x in seats) {
    count(x.hallId, _classOf(studentById[x.studentId]!), 1);
  }
  bool fits(int hallId, String cls, [String? leaving]) {
    final m = inHall[hallId] ?? const <String, int>{};
    if (m.containsKey(cls) && !(cls == leaving && m[cls] == 1)) return true;
    final size = m.length - (leaving != null && m[leaving] == 1 && leaving != cls ? 1 : 0);
    return size < most;
  }

  String seatKey(int hallId, int benchNo, String side) => '$hallId/$benchNo/$side';
  final at = {for (final x in seats) seatKey(x.hallId, x.benchNo, x.seat): x};
  final sides = _bySubject(students);
  final finders = {for (final c in config.halls) c.hallId: _benchFinder(enabledBenches(hallOf[c.hallId]!.layout))};
  String? classAt(int hallId, int benchNo, String side) {
    final m = at[seatKey(hallId, benchNo, side)];
    return m == null ? null : _classOf(studentById[m.studentId]!);
  }

  List<String?> mateClass(int hallId, int row, int col, int benchNo, String seat) {
    final out = <String?>[classAt(hallId, benchNo, seat == 'L' ? 'R' : 'L')];
    if (sides) {
      final find = finders[hallId]!;
      for (final n in _sideNeighbours(find, row, col, seat)) {
        out.add(classAt(hallId, find(n.row, n.col)!.benchNo, n.side));
      }
    }
    return out;
  }

  final empty = <({int hallId, int row, int col, int benchNo, String seat, String gender})>[];
  for (final c in config.halls) {
    if (c.pattern.isEmpty) continue;
    final benches = enabledBenches(hallOf[c.hallId]!.layout);
    for (var i = 0; i < benches.length; i++) {
      final b = benches[i];
      for (final side in sidesOf(b.seats)) {
        if (!at.containsKey(seatKey(c.hallId, b.benchNo, side))) {
          empty.add((hallId: c.hallId, row: b.row, col: b.col, benchNo: b.benchNo, seat: side, gender: seatGender(c.pattern, i, side)));
        }
      }
    }
  }
  for (final g in genders) {
    for (final entry in pools[g]!.entries) {
      final cls = entry.key, left = entry.value;
      while (left.isNotEmpty) {
        final x = left.first;
        final direct = empty.indexWhere((e) => e.gender == g && !mateClass(e.hallId, e.row, e.col, e.benchNo, e.seat).contains(cls) && fits(e.hallId, cls));
        if (direct >= 0) {
          final e = empty.removeAt(direct);
          final seat = Seat(studentId: x.id, hallId: e.hallId, row: e.row, col: e.col, benchNo: e.benchNo, seat: e.seat);
          seats.add(seat);
          at[seatKey(e.hallId, e.benchNo, e.seat)] = seat;
          left.removeAt(0);
          count(e.hallId, cls, 1);
          continue;
        }
        var done = false;
        for (final y in List.of(seats)) {
          final ys = studentById[y.studentId]!, ycls = _classOf(ys);
          if (ys.gender != g || ycls == cls || mateClass(y.hallId, y.row, y.col, y.benchNo, y.seat).contains(cls)) continue;
          final ei = empty.indexWhere((e) =>
              e.gender == g &&
              !mateClass(e.hallId, e.row, e.col, e.benchNo, e.seat).contains(ycls) &&
              !(e.hallId == y.hallId && e.benchNo == y.benchNo) &&
              (e.hallId == y.hallId ? fits(y.hallId, cls) : fits(y.hallId, cls, ycls) && fits(e.hallId, ycls)));
          if (ei < 0) continue;
          final to = empty.removeAt(ei);
          final moved = Seat(studentId: y.studentId, hallId: to.hallId, row: to.row, col: to.col, benchNo: to.benchNo, seat: to.seat);
          seats.add(moved);
          at[seatKey(to.hallId, to.benchNo, to.seat)] = moved;
          count(y.hallId, ycls, -1);
          count(to.hallId, ycls, 1);
          count(y.hallId, cls, 1);
          y.studentId = x.id;
          left.removeAt(0);
          done = true;
          break;
        }
        if (!done) break;
      }
    }
  }
}

Map<int, Map<String, int>> _hallSeats(SeatingConfig config, Map<int, SeatHall> hallOf) =>
    {for (final c in config.halls) c.hallId: patternSeats(c.pattern, enabledBenches(hallOf[c.hallId]!.layout))};

/// Problems that stop a configuration from being used (errors) and shortfalls to know about (warnings).
({List<String> errors, List<String> warnings}) checkConfig(SeatingConfig? rawConfig, List<SeatHall> halls, List<SeatStudent> students) {
  final config = normalizeConfig(rawConfig, halls);
  final errors = <String>[], warnings = <String>[];
  final hallOf = {for (final h in halls) h.id: h};
  final seatsIn = _hallSeats(config, hallOf);
  for (final c in config.halls) {
    final hall = hallOf[c.hallId]!;
    if (c.pattern.isNotEmpty && _seatsOf(hall) == 0) {
      errors.add('Hall ${hall.hallCode} has no bench layout. Set its rows and columns in Master Data → Halls, or mark it Not used.');
    }
  }
  if (config.mixGenders) {
    final seats = seatsIn.values.fold(0, (sum, x) => sum + x['M']! + x['F']!);
    if (students.length > seats) warnings.add('${students.length} students are selected, but the halls used have only $seats seats: ${students.length - seats} will be unallocated.');
    return (errors: errors, warnings: warnings);
  }
  for (final g in genders) {
    final n = students.where((s) => s.gender == g).length;
    if (n == 0) continue;
    final seats = seatsIn.values.fold(0, (sum, x) => sum + x[g]!);
    if (seats == 0) {
      warnings.add('$n ${_groupWordOf(g)} are selected, but no hall has seats for ${_groupWordOf(g)}.');
    } else if (n > seats) {
      warnings.add('$n ${_groupWordOf(g)} are selected, but the halls have only $seats seats for ${_groupWordOf(g)}: ${n - seats} will be unallocated.');
    }
  }
  return (errors: errors, warnings: warnings);
}

class _State {
  final Map<String, Map<String, List<SeatStudent>>> pools;
  final Map<String, int> turn;
  _State(this.pools, this.turn);
  _State copy() => _State(
        {for (final g in pools.keys) g: {for (final e in pools[g]!.entries) e.key: [...e.value]}},
        {...turn},
      );
}

/// The seating plan for the students in the halls under the configuration.
SeatingPlan planSeating(List<SeatStudent> students, List<SeatHall> halls, SeatingConfig? rawConfig, Object? academicYear, [bool together = false]) {
  final config = normalizeConfig(rawConfig, halls);
  if (config.mixGenders) return _planTogether(students, halls, config, academicYear);
  String groupWord(String g) => together ? 'students' : _groupWordOf(g);
  final hallOf = {for (final h in halls) h.id: h};
  final seatsIn = _hallSeats(config, hallOf);
  final sides = _bySubject(students);
  var pools = <String, Map<String, List<SeatStudent>>>{'M': {}, 'F': {}};
  for (final s in _stable(students, _seatingOrder)) {
    pools[s.gender]!.putIfAbsent(_classOf(s), () => []).add(s);
  }
  List<String> bySize(String g) => _stable(pools[g]!.keys, (a, b) => pools[g]![b]!.length - pools[g]![a]!.length);
  final order = {'M': bySize('M'), 'F': bySize('F')};
  final limit = config.classLimit!;
  final warnings = <String>[];

  ({List<Seat> out, int wasted}) fillHall(HallSeatingConfig c, SeatHall hall, _State st, int most) {
    final benches = enabledBenches(hall.layout);
    final out = <Seat>[];
    final classes = <String>{};
    var empty = 0;
    String? nextClass(String g, List<String?> avoid) {
      final list = order[g]!;
      for (var k = 0; k < list.length; k++) {
        final i = (st.turn[g]! + k) % list.length, cls = list[i];
        if (st.pools[g]![cls]!.isNotEmpty && !avoid.contains(cls) && (classes.contains(cls) || classes.length < most)) {
          st.turn[g] = (i + 1) % list.length;
          classes.add(cls);
          return cls;
        }
      }
      return null;
    }

    final columns = <int, List<int>>{};
    for (var i = 0; i < benches.length; i++) {
      columns.putIfAbsent(benches[i].col, () => []).add(i);
    }
    final leftClass = <int, String>{};
    final find = _benchFinder(benches);
    final placed = <String, String>{};
    for (final column in columns.values) {
      for (final side in const ['L', 'R']) {
        final seatColumn = <String, String?>{'M': null, 'F': null};
        for (final i in column) {
          final b = benches[i];
          if (side == 'R' && b.seats == 1) continue;
          final g = seatGender(c.pattern, i, side);
          final mate = side == 'R' ? leftClass[i] : null;
          final avoid = <String?>[mate, if (sides) ..._sideNeighbours(find, b.row, b.col, side).map((n) => placed['${n.row}-${n.col}-${n.side}'])];
          var cls = seatColumn[g];
          if (cls == null || st.pools[g]![cls]!.isEmpty || avoid.contains(cls)) cls = seatColumn[g] = nextClass(g, avoid);
          if (cls == null) {
            empty++;
            continue;
          }
          final s = st.pools[g]![cls]!.removeAt(0);
          if (side == 'L') leftClass[i] = cls;
          if (sides) placed['${b.row}-${b.col}-$side'] = cls;
          out.add(Seat(studentId: s.id, hallId: hall.id, row: b.row, col: b.col, benchNo: b.benchNo, seat: side));
        }
      }
    }
    final waiting = genders.any((g) => st.pools[g]!.values.any((l) => l.isNotEmpty));
    return (out: out, wasted: waiting ? empty : 0);
  }

  ({List<Seat> out, Map<String, Map<String, List<SeatStudent>>> pools, int left}) attempt(bool relax) {
    var state = _State(pools, {'M': 0, 'F': 0}).copy();
    final out = <Seat>[];
    for (final c in config.halls) {
      if (c.pattern.isEmpty) continue;
      final hall = hallOf[c.hallId]!;
      ({_State st, List<Seat> out, int wasted})? best;
      for (var most = limit.preferred; most <= (relax ? limit.max : limit.preferred); most++) {
        final st = state.copy();
        final filled = fillHall(c, hall, st, most);
        if (best == null || filled.wasted < best.wasted) best = (st: st, out: filled.out, wasted: filled.wasted);
        if (filled.wasted == 0) break;
      }
      state = best!.st;
      out.addAll(best.out);
    }
    _repairLeftovers(students, config, hallOf, out, state.pools, relax ? limit.max : limit.preferred);
    final left = genders.fold(0, (n, g) => n + state.pools[g]!.values.fold(0, (m, l) => m + l.length));
    return (out: out, pools: state.pools, left: left);
  }

  var result = attempt(false);
  if (result.left > 0 && limit.max > limit.preferred) {
    final relaxed = attempt(true);
    if (relaxed.left < result.left) result = relaxed;
  }
  final seats = result.out;
  pools = result.pools;

  final studentById = {for (final s in students) s.id: s};
  final hallGender = <int, String?>{};
  final summaries = config.halls.map((c) {
    final hall = hallOf[c.hallId]!;
    final benches = enabledBenches(hall.layout);
    hallGender[hall.id] = patternGroup(c.pattern);
    final list = seats.where((x) => x.hallId == hall.id).map((x) => studentById[x.studentId]!).toList();
    final counts = <String, ({String key, String label, int count})>{};
    for (final s in list) {
      final cat = studentCategory(s, academicYear);
      final e = counts[cat.key];
      counts[cat.key] = (key: cat.key, label: cat.label, count: (e?.count ?? 0) + 1);
    }
    if (c.pattern.isNotEmpty && benches.isEmpty) {
      warnings.add('Hall ${hall.hallCode} has no bench layout, so no students were seated there. Set its rows and columns in Master Data → Halls.');
    } else if (c.pattern.isNotEmpty && list.isEmpty) {
      warnings.add('Hall ${hall.hallCode}: no students in this hall.');
    }
    return HallSummary(
        hallId: hall.id, hallCode: hall.hallCode, gender: hallGender[hall.id], pattern: c.pattern, benches: benches.length, capacity: _seatsOf(hall),
        seatsFor: seatsIn[hall.id]!, occupied: list.length, empty: _seatsOf(hall) - list.length, categories: counts.values.toList());
  }).toList();

  final unallocated = <UnallocatedStudent>[];
  final groups = <String, GroupTotals>{};
  for (final g in genders) {
    final capacity = summaries.fold(0, (n, h) => n + h.seatsFor[g]!);
    final total = students.where((s) => s.gender == g).length;
    final left = _stable(pools[g]!.values.expand((l) => l), _seatingOrder);
    final seated = total - left.length;
    final reason = capacity == 0
        ? 'No hall has seats for ${groupWord(g)}.'
        : seated < capacity
            ? 'No free seat beside a student of another class: two students of the same class never share a bench and each hall holds only a few different classes, so some ${groupWord(g)}\' seats had to stay empty. Add halls or benches for ${groupWord(g)}, or allow more classes per hall.'
            : 'Not enough seats: every seat for ${groupWord(g)} is taken.';
    for (final s in left) {
      final cat = studentCategory(s, academicYear);
      unallocated.add(UnallocatedStudent(studentId: s.id, rollNo: s.rollNo, name: s.name, gender: g, categoryKey: cat.key, category: cat.label, reason: reason));
    }
    groups[g] = GroupTotals(total, seated, left.length, summaries.where((h) => h.seatsFor[g]! > 0).length, capacity);
  }
  return SeatingPlan(seats: seats, hallGender: hallGender, halls: summaries, unallocated: unallocated, warnings: warnings, groups: groups);
}

/// Roll number order: seated as one group, then each keeps their own gender in the result.
SeatingPlan _planTogether(List<SeatStudent> students, List<SeatHall> halls, SeatingConfig config, Object? academicYear) {
  final plan = planSeating(_asOneGroup(students), halls, config.copyWith(mixGenders: false), academicYear, true);
  final genderOf = {for (final s in students) s.id: s.gender};
  final hallGender = <int, String?>{};
  for (final h in plan.halls) {
    final g = plan.seats.where((x) => x.hallId == h.hallId).map((x) => genderOf[x.studentId]!).toSet();
    hallGender[h.hallId] = h.pattern.isEmpty ? null : (g.length == 1 ? g.first : 'mixed');
  }
  final unallocated = plan.unallocated.map((u) => u.withGender(genderOf[u.studentId]!)).toList();
  final capacity = plan.halls.fold(0, (n, h) => n + (h.pattern.isNotEmpty ? h.capacity : 0));
  final groups = <String, GroupTotals>{};
  for (final g in genders) {
    final total = students.where((s) => s.gender == g).length, left = unallocated.where((u) => u.gender == g).length;
    groups[g] = GroupTotals(total, total - left, left, plan.halls.where((h) => h.pattern.isNotEmpty).length, capacity);
  }
  return SeatingPlan(
      seats: plan.seats,
      hallGender: hallGender,
      halls: plan.halls.map((h) => h.withGender(hallGender[h.hallId])).toList(),
      unallocated: unallocated,
      warnings: plan.warnings,
      groups: groups);
}

// ── Validation ──────────────────────────────────────────────

/// Checks a plan against the rules, independently of how it was made. Any error blocks saving.
List<String> validateSeatingPlan(List<Seat> planSeats, List<UnallocatedStudent> planUnallocated, List<SeatStudent> students, List<SeatHall> halls, SeatingConfig? rawConfig) {
  final config = normalizeConfig(rawConfig, halls);
  final errors = <String>[];
  final studentOf = {for (final s in students) s.id: s};
  final hallOf = {for (final h in halls) h.id: h};
  final patternOf = {for (final c in config.halls) c.hallId: c.pattern};

  final seen = <int, int>{};
  for (final id in [...planSeats.map((s) => s.studentId), ...planUnallocated.map((u) => u.studentId)]) {
    seen[id] = (seen[id] ?? 0) + 1;
  }
  seen.forEach((id, n) {
    final s = studentOf[id];
    if (s == null) {
      errors.add('Student #$id is in the plan but was not selected.');
    } else if (n > 1) {
      errors.add('Student ${s.rollNo} is allocated more than once.');
    }
  });
  for (final s in students) {
    if (!seen.containsKey(s.id)) errors.add('Student ${s.rollNo} is neither seated nor listed as unallocated.');
  }

  final byHall = <int, List<Seat>>{};
  for (final seat in planSeats) {
    final hall = hallOf[seat.hallId];
    if (hall == null) {
      errors.add('A student is seated in hall #${seat.hallId}, which is not one of this session\'s halls.');
      continue;
    }
    byHall.putIfAbsent(hall.id, () => []).add(seat);
  }

  byHall.forEach((hallId, list) {
    final hall = hallOf[hallId]!, code = hall.hallCode;
    final pattern = patternOf[hallId] ?? const <String>[];
    if (pattern.isEmpty) {
      errors.add('Hall $code is not used in this session but has students.');
      return;
    }
    final hallBenches = enabledBenches(hall.layout);
    final index = {for (var i = 0; i < hallBenches.length; i++) '${hallBenches[i].row}-${hallBenches[i].col}-${hallBenches[i].benchNo}': i};
    for (final x in list) {
      final i = index['${x.row}-${x.col}-${x.benchNo}'];
      if (i == null) {
        errors.add('Hall $code: bench ${x.benchNo} does not exist.');
        continue;
      }
      if (x.seat == 'R' && hallBenches[i].seats == 1) {
        errors.add('Hall $code, seat ${x.benchNo} is a single chair but has a student in a right seat.');
        continue;
      }
      if (config.mixGenders) continue;
      final s = studentOf[x.studentId], want = seatGender(pattern, i, x.seat);
      if (s != null && s.gender != want) {
        errors.add('Hall $code, bench ${x.benchNo}: ${s.rollNo} sits in the ${x.seat == 'L' ? 'left' : 'right'} seat, which the bench pattern gives to a ${want == 'M' ? 'boy' : 'girl'}.');
      }
    }
    final classes = list.map((x) => studentOf[x.studentId]).whereType<SeatStudent>().map(_classOf).toSet();
    if (classes.length > config.classLimit!.max) errors.add('Hall $code has ${classes.length} different classes, more than the limit of ${config.classLimit!.max}.');
    final benches = <int, List<Seat>>{};
    for (final x in list) {
      benches.putIfAbsent(x.benchNo, () => []).add(x);
    }
    final seatsAt = {for (final b in hallBenches) b.benchNo: b.seats};
    benches.forEach((no, b) {
      final most = seatsAt[no] ?? 2;
      if (b.length > most) errors.add('Hall $code, ${most == 1 ? 'chair' : 'bench'} $no has ${b.length} students (at most $most).');
      if (b.map((x) => x.seat).toSet().length != b.length) errors.add('Hall $code, bench $no: two students in the same seat.');
      final mates = b.map((x) => studentOf[x.studentId]).whereType<SeatStudent>().toList();
      if (mates.length == 2 && _classOf(mates[0]) == _classOf(mates[1])) {
        errors.add(mates[0].paper != null
            ? 'Hall $code, bench $no: ${mates[0].rollNo} and ${mates[1].rollNo} write the same subject.'
            : 'Hall $code, bench $no: ${mates[0].rollNo} and ${mates[1].rollNo} are from the same class.');
      }
    });
    if (_bySubject(students)) {
      final find = _benchFinder(hallBenches);
      final byPos = {for (final x in list) '${x.row}-${x.col}-${x.seat}': x};
      for (final x in list) {
        final s = studentOf[x.studentId];
        if (s?.paper == null) continue;
        for (final n in _sideNeighbours(find, x.row, x.col, x.seat)) {
          if (n.col < x.col) continue;
          final y = byPos['${n.row}-${n.col}-${n.side}'];
          final t = y == null ? null : studentOf[y.studentId];
          if (t != null && t.paper == s!.paper) errors.add('Hall $code, row ${x.row}: ${s.rollNo} and ${t.rollNo} sit side by side and write the same subject.');
        }
      }
    }
  });
  return errors;
}

/// "3 boys and 1 girl could not be seated: …", or null when everyone is seated.
String? unallocatedMessage(List<UnallocatedStudent> unallocated) {
  final parts = <String>[];
  for (final g in genders) {
    final n = unallocated.where((u) => u.gender == g).length;
    if (n > 0) parts.add('$n ${g == 'M' ? 'boy' : 'girl'}${n == 1 ? '' : 's'}');
  }
  return parts.isEmpty ? null : '${parts.join(' and ')} could not be seated: not enough seats for them in the halls.';
}
