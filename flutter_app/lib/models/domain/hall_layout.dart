import 'dart:convert';

/// A hall's seating positions: a grid of rows (row 1 at the front) and columns (column 1 on the
/// left as seen from the front), some switched off. Each position is a bench (two students) or a
/// chair (one). Positions are numbered column by column, front to back. Pure logic.

const maxBenchRows = 30;
const maxBenchCols = 20;

enum SeatKind { bench, chair }

const seatKindLabel = {SeatKind.bench: 'Bench', SeatKind.chair: 'Chair'};
const seatsPer = {SeatKind.bench: 2, SeatKind.chair: 1};

class HallLayout {
  final int rows, cols;
  final List<String> disabled;
  final Map<String, SeatKind> kinds;
  const HallLayout({required this.rows, required this.cols, this.disabled = const [], this.kinds = const {}});

  HallLayout copyWith({int? rows, int? cols, List<String>? disabled, Map<String, SeatKind>? kinds}) =>
      HallLayout(rows: rows ?? this.rows, cols: cols ?? this.cols, disabled: disabled ?? this.disabled, kinds: kinds ?? this.kinds);
}

class Bench {
  final int row, col, benchNo;
  final SeatKind kind;
  final int seats; // 2: left and right seat; 1: only "L"
  const Bench({required this.row, required this.col, required this.benchNo, required this.kind, required this.seats});
}

String benchKey(int row, int col) => '$row-$col';

List<String> parseDisabledBenches(Object? text) {
  if (text is List) return text.map((e) => '$e').toList();
  try {
    final v = jsonDecode('${text ?? '[]'}');
    return v is List ? v.map((e) => '$e').toList() : [];
  } catch (_) {
    return [];
  }
}

/// The chairs as saved (JSON {"row-col": "chair"}); a "desk" reads as a chair.
Map<String, SeatKind> parseSeatKinds(Object? text) {
  Object? v = text;
  if (text is! Map) {
    try {
      v = jsonDecode('${text ?? '{}'}');
    } catch (_) {
      return {};
    }
  }
  final out = <String, SeatKind>{};
  if (v is Map) {
    v.forEach((k, kind) {
      if (kind == 'chair' || kind == 'desk' || kind == SeatKind.chair) out['$k'] = SeatKind.chair;
    });
  }
  return out;
}

int _num(Object? v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);

/// A hall row from the database (bench_rows, bench_cols, disabled_benches, seat_kinds) as a layout.
HallLayout hallLayoutOf(Map<String, Object?> h) => HallLayout(
      rows: _num(h['bench_rows']),
      cols: _num(h['bench_cols']),
      disabled: parseDisabledBenches(h['disabled_benches']),
      kinds: parseSeatKinds(h['seat_kinds']),
    );

SeatKind kindAt(HallLayout layout, int row, int col) => layout.kinds[benchKey(row, col)] ?? SeatKind.bench;

/// The positions that exist, in seating order (column by column, front to back), numbered from 1.
List<Bench> enabledBenches(HallLayout layout) {
  final off = layout.disabled.toSet();
  final out = <Bench>[];
  for (var col = 1; col <= layout.cols; col++) {
    for (var row = 1; row <= layout.rows; row++) {
      if (off.contains(benchKey(row, col))) continue;
      final kind = kindAt(layout, row, col);
      out.add(Bench(row: row, col: col, benchNo: out.length + 1, kind: kind, seats: seatsPer[kind]!));
    }
  }
  return out;
}

int benchCount(HallLayout layout) => enabledBenches(layout).length;
int seatCount(HallLayout layout) => enabledBenches(layout).fold(0, (n, b) => n + b.seats);

Map<SeatKind, int> kindCounts(HallLayout layout) {
  final out = {SeatKind.bench: 0, SeatKind.chair: 0};
  for (final b in enabledBenches(layout)) {
    out[b.kind] = out[b.kind]! + 1;
  }
  return out;
}

/// "30 benches, 10 chairs"
String kindSummary(HallLayout layout) {
  final c = kindCounts(layout);
  const word = {SeatKind.bench: ['bench', 'benches'], SeatKind.chair: ['chair', 'chairs']};
  final parts = [for (final k in SeatKind.values) if (c[k]! > 0) '${c[k]} ${word[k]![c[k] == 1 ? 0 : 1]}'];
  return parts.isEmpty ? '0 benches' : parts.join(', ');
}

/// Switched-off positions inside the grid, sorted column by column.
List<String> cleanDisabled(HallLayout layout) {
  final inside = <String>{};
  for (final k in layout.disabled) {
    final parts = k.split('-');
    if (parts.length != 2) continue;
    final r = int.tryParse(parts[0]), c = int.tryParse(parts[1]);
    if (r != null && c != null && r >= 1 && r <= layout.rows && c >= 1 && c <= layout.cols) inside.add(benchKey(r, c));
  }
  final list = inside.toList();
  list.sort((a, b) {
    final pa = a.split('-').map(int.parse).toList(), pb = b.split('-').map(int.parse).toList();
    return pa[1] != pb[1] ? pa[1] - pb[1] : pa[0] - pb[0];
  });
  return list;
}

/// Chairs inside the grid that are not switched off.
Map<String, SeatKind> cleanKinds(HallLayout layout) {
  final off = layout.disabled.toSet();
  final out = <String, SeatKind>{};
  layout.kinds.forEach((k, kind) {
    final parts = k.split('-');
    if (parts.length != 2) return;
    final r = int.tryParse(parts[0]) ?? 0, c = int.tryParse(parts[1]) ?? 0;
    if (r >= 1 && r <= layout.rows && c >= 1 && c <= layout.cols && !off.contains(benchKey(r, c)) && kind == SeatKind.chair) {
      out[benchKey(r, c)] = kind;
    }
  });
  return out;
}

String kindsToJson(Map<String, SeatKind> kinds) => jsonEncode(kinds.map((k, v) => MapEntry(k, v.name)));

String? validateHallLayout(Object? rows, Object? cols) {
  final r = rows is int ? rows : int.tryParse('${rows ?? 0}');
  final c = cols is int ? cols : int.tryParse('${cols ?? 0}');
  if (r == null || c == null || r < 0 || c < 0) return 'Bench rows and columns must be whole numbers.';
  if (r > maxBenchRows) return 'A hall can have at most $maxBenchRows bench rows.';
  if (c > maxBenchCols) return 'A hall can have at most $maxBenchCols bench columns.';
  if ((r == 0) != (c == 0)) return 'Enter both the number of bench rows and columns (or leave both 0).';
  return null;
}
