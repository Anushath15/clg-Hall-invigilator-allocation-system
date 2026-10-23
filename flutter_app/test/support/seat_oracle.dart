import 'package:hias/models/domain/hall_layout.dart';
import 'package:hias/models/domain/seating.dart';

/// The four conditions every hall allocation must satisfy:
///   1. Hall capacity            every seat exists, is used once, and a hall never holds more than it has
///   2. Same subject adjacency   students writing the same subject never sit side by side (bench mate or across the aisle)
///   3. Gender / bench pattern   a seat is used only by the gender its bench pattern gives it
///   4. Same class on one bench  two students of one class never share a bench
///
/// The subject rule (2) applies only when the exam has MORE THAN ONE subject: with one subject (or none) there is nobody
/// to keep apart. The class (4) is always the real class, department + batch.
///
/// This checker is written from scratch and uses neither validateSeatingPlan nor the planner's helpers, so it checks the
/// validator as well as the plans.
class Sitter {
  final String gender, classKey;
  final String? paper;
  const Sitter(this.gender, this.classKey, this.paper);
}

typedef Placed = ({int studentId, int hallId, int row, int col, String seat});

List<String> violations(List<SeatHall> halls, Map<int, List<String>> patterns, Map<int, Sitter> who, List<Placed> seats) {
  final out = <String>[];
  final subjectRule = who.values.map((w) => w.paper).whereType<String>().toSet().length > 1;
  for (final hall in halls) {
    final lay = hall.layout;
    // The benches of the hall in seating order (column by column, front to back), straight from the layout.
    final benches = <({int row, int col, int seats, int index})>[];
    var index = 0;
    for (var c = 1; c <= lay.cols; c++) {
      for (var r = 1; r <= lay.rows; r++) {
        if (lay.disabled.contains('$r-$c')) continue;
        benches.add((row: r, col: c, seats: lay.kinds['$r-$c'] == SeatKind.chair ? 1 : 2, index: index++));
      }
    }
    final bench = {for (final b in benches) '${b.row}-${b.col}': b};
    final here = seats.where((x) => x.hallId == hall.id).toList();

    // 1. capacity: a real seat, used once, never more students than seats.
    final used = <String>{};
    final capacity = benches.fold(0, (n, b) => n + b.seats);
    if (here.length > capacity) out.add('${hall.hallCode}: ${here.length} students for $capacity seats');
    for (final x in here) {
      final b = bench['${x.row}-${x.col}'];
      if (b == null) {
        out.add('${hall.hallCode}: seat on a bench that does not exist (${x.row}-${x.col})');
        continue;
      }
      if (x.seat == 'R' && b.seats == 1) out.add('${hall.hallCode}: right seat of a chair');
      if (!used.add('${x.row}-${x.col}-${x.seat}')) out.add('${hall.hallCode}: seat ${x.row}-${x.col}-${x.seat} used twice');
    }
    // 3. gender / bench pattern: the seat's gender comes from the pattern of its bench.
    final pattern = patterns[hall.id] ?? const <String>[];
    for (final x in here) {
      final b = bench['${x.row}-${x.col}'];
      if (b == null) continue;
      if (pattern.isEmpty) {
        out.add('${hall.hallCode}: students in a hall that is not used');
        continue;
      }
      final want = pattern[b.index % pattern.length][x.seat == 'L' ? 0 : 1];
      if (who[x.studentId]!.gender != want) out.add('${hall.hallCode}: ${who[x.studentId]!.gender} in a seat for $want');
    }
    // 4. same class on one bench.
    final byBench = <String, List<Placed>>{};
    for (final x in here) {
      byBench.putIfAbsent('${x.row}-${x.col}', () => []).add(x);
    }
    byBench.forEach((k, list) {
      if (list.length == 2 && who[list[0].studentId]!.classKey == who[list[1].studentId]!.classKey) out.add('${hall.hallCode}: bench $k holds two of one class');
    });
    // 2. same subject adjacency: the left neighbour of a left seat is the right seat of the bench to its left (the only
    // seat of a chair); a chair's, or a right seat's, neighbour on the right is the left seat of the next bench.
    final at = {for (final x in here) '${x.row}-${x.col}-${x.seat}': x};
    for (final x in here) {
      final paper = who[x.studentId]!.paper;
      if (!subjectRule || paper == null) continue;
      final b = bench['${x.row}-${x.col}'];
      if (b == null) continue;
      final neighbours = <String>[];
      if (x.seat == 'L' && b.seats == 2) neighbours.add('${x.row}-${x.col}-R'); // bench mate
      if (x.seat == 'R' || b.seats == 1) {
        final next = bench['${x.row}-${x.col + 1}'];
        if (next != null) neighbours.add('${x.row}-${x.col + 1}-L');
      }
      for (final n in neighbours) {
        final y = at[n];
        if (y != null && who[y.studentId]!.paper == paper) out.add('${hall.hallCode}: ${x.row}-${x.col} and $n write the same subject side by side');
      }
    }
  }
  return out;
}

Placed placed(Seat s) => (studentId: s.studentId, hallId: s.hallId, row: s.row, col: s.col, seat: s.seat);
