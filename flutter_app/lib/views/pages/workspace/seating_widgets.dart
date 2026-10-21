import 'package:flutter/material.dart';

import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/domain/hall_layout.dart';
import '../../../models/domain/seating.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';

/// A colour picker for class keys, stable for the list given.
ClassColor Function(String) classColors(List<String> keys) {
  final order = keys.toSet().toList()..sort();
  return (k) => classColorList[(order.indexOf(k) < 0 ? 0 : order.indexOf(k)) % classColorList.length];
}

String groupLabel(String? g) => g == 'M' ? 'Boys' : g == 'F' ? 'Girls' : g == 'mixed' ? 'Boys & Girls' : '—';

(Color, Color) groupColors(String? g) => switch (g) {
      'M' => (AppColors.sky100, AppColors.sky700),
      'F' => (AppColors.pink100, AppColors.pink700),
      'mixed' => (AppColors.violet100, AppColors.violet700),
      _ => (AppColors.gray100, AppColors.gray700),
    };

/// One hall's benches as seen from the front, each with its left and right seat (a chair: one seat).
class HallBenchGrid extends StatelessWidget {
  const HallBenchGrid({super.key, required this.layout, required this.seats, required this.colorOf, this.highlight = const []});
  final HallLayout layout;
  final List<SeatRow> seats;
  final ClassColor Function(String) colorOf;
  final List<int> highlight;

  @override
  Widget build(BuildContext context) {
    final numbers = {for (final b in enabledBenches(layout)) benchKey(b.row, b.col): b};
    final at = <String, Map<String, SeatRow>>{};
    for (final s in seats) {
      at.putIfAbsent(benchKey(s.benchRow, s.benchCol), () => {})[s.seat] = s;
    }
    final mixed = seats.map((s) => s.gender).toSet().length > 1;
    Widget seatCell(SeatRow? s) {
      if (s == null) {
        return Container(
          padding: const EdgeInsets.symmetric(vertical: 3),
          alignment: Alignment.center,
          decoration: BoxDecoration(border: Border.all(color: AppColors.gray200), borderRadius: BorderRadius.circular(4)),
          child: const Text('empty', style: TextStyle(fontSize: 11.5, color: AppColors.gray300)),
        );
      }
      final cc = colorOf(s.colorKey);
      return Tooltip(
        message: '${s.rollNo} · ${s.studentName} · ${s.deptCode ?? ''} ${s.year ?? ''} · ${s.batch}',
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: cc.bg,
            borderRadius: BorderRadius.circular(4),
            border: Border(
              left: mixed ? BorderSide(color: s.gender == 'F' ? AppColors.pink600 : AppColors.sky600, width: 4) : BorderSide.none,
              top: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
              bottom: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
              right: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
            ),
          ),
          child: Text(s.rollNo, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: 'Consolas', fontSize: 11.5, fontWeight: FontWeight.w700, color: cc.fg)),
        ),
      );
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (mixed) const Padding(padding: EdgeInsets.only(bottom: 6), child: Text('Left edge: blue = boy, pink = girl.', style: TextStyle(fontSize: 12.5, color: AppColors.textSec))),
      Container(
        padding: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(color: AppColors.gray700, borderRadius: BorderRadius.circular(6)),
        child: const Text('FRONT · BOARD', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 2)),
      ),
      const SizedBox(height: 8),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const SizedBox(width: 30),
            for (var c = 1; c <= layout.cols; c++) SizedBox(width: 126, child: Text('Column $c', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSec))),
          ]),
          for (var r = 1; r <= layout.rows; r++)
            Row(children: [
              SizedBox(width: 30, child: Text('R$r', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSec))),
              for (var c = 1; c <= layout.cols; c++)
                Builder(builder: (_) {
                  final bench = numbers[benchKey(r, c)];
                  if (bench == null) return Container(width: 120, height: 52, margin: const EdgeInsets.all(3), decoration: BoxDecoration(color: AppColors.gray50, borderRadius: BorderRadius.circular(6)));
                  final b = at[benchKey(r, c)];
                  return Container(
                    width: 120,
                    margin: const EdgeInsets.all(3),
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(6), border: Border.all(color: bench.seats == 1 ? const Color(0xFFFCD34D) : AppColors.border)),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text('${seatKindLabel[bench.kind]} ${bench.benchNo}', style: const TextStyle(fontSize: 11, color: AppColors.textSec)),
                      const SizedBox(height: 2),
                      bench.seats == 2
                          ? Row(children: [Expanded(child: seatCell(b?['L'])), const SizedBox(width: 4), Expanded(child: seatCell(b?['R']))])
                          : Row(children: [const Spacer(), Expanded(flex: 2, child: seatCell(b?['L'])), const Spacer()]),
                    ]),
                  );
                }),
            ]),
        ]),
      ),
    ]);
  }
}

/// A hall's seating in a popup: invigilators, student count, classes, and the bench grid.
class HallSeatingDialog extends StatelessWidget {
  const HallSeatingDialog({super.key, required this.hall, required this.seats, required this.colorOf, this.gender, this.highlight = const []});
  final SeatingHallInfo hall;
  final List<SeatRow> seats;
  final ClassColor Function(String) colorOf;
  final String? gender;
  final List<int> highlight;

  @override
  Widget build(BuildContext context) {
    final boys = seats.where((s) => s.gender == 'M').length;
    final classes = <String, int>{};
    for (final s in seats) {
      classes[s.colorKey] = (classes[s.colorKey] ?? 0) + 1;
    }
    final depts = seats.map((s) => s.deptCode).whereType<String>().toSet();
    final (bg, fg) = groupColors(gender);
    Widget box(IconData icon, String label, Widget child) => Expanded(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 4),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(12)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [Icon(icon, size: 14, color: AppColors.textSec), const SizedBox(width: 6), Text(label, style: const TextStyle(fontSize: 12.5, color: AppColors.textSec))]),
              const SizedBox(height: 6),
              child,
            ]),
          ),
        );
    final keys = classes.keys.toList()..sort();
    return ModalShell(
      title: 'Hall ${hall.hallCode}',
      subtitle: hallLocation(hall.block, hall.floor).isEmpty ? null : hallLocation(hall.block, hall.floor),
      maxWidth: 1100,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Align(alignment: Alignment.centerLeft, child: Pill(groupLabel(gender), bg: bg, fg: fg)),
          const SizedBox(height: 12),
          IntrinsicHeight(
            child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              box(Icons.how_to_reg_outlined, hall.invigilators.length > 1 ? 'Invigilators' : 'Invigilator',
                  Text(hall.invigilators.isEmpty ? 'Not allocated' : hall.invigilators.join(', '), style: const TextStyle(fontWeight: FontWeight.w600))),
              box(Icons.people_outline, 'Students', Text.rich(TextSpan(children: [
                TextSpan(text: '${seats.length}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
                TextSpan(text: '  of ${hall.seats} seats · $boys boys · ${seats.length - boys} girls', style: cellSec),
              ]))),
              box(Icons.school_outlined, '${depts.length > 1 ? 'Departments' : 'Department'}${depts.isNotEmpty ? ' (${depts.length})' : ''}', Wrap(spacing: 6, runSpacing: 6, children: [
                for (final k in keys) Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: colorOf(k).bg, borderRadius: BorderRadius.circular(4)),
                  child: Text('$k · ${classes[k]}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: colorOf(k).fg)),
                ),
              ])),
            ]),
          ),
          const SizedBox(height: 16),
          HallBenchGrid(layout: hall.layout, seats: seats, colorOf: colorOf, highlight: highlight),
        ]),
      ),
    );
  }
}

/// Students left without a seat, by roll number, with the reason for each.
class UnallocatedTable extends StatelessWidget {
  const UnallocatedTable({super.key, required this.rows});
  final List<UnallocatedStudent> rows;
  @override
  Widget build(BuildContext context) {
    final sorted = [...rows]..sort((a, b) => naturalCompare(a.rollNo, b.rollNo));
    return DataTableCard(
      columns: const ['Roll No', 'Name', 'Category', 'Gender', 'Reason'],
      flex: const [1, 1.6, 1.6, 0.8, 4],
      minWidth: 700,
      rows: [
        for (final u in sorted)
          [
            Text(u.rollNo, style: monoSmall.copyWith(fontWeight: FontWeight.w600)),
            Text(u.name ?? '', style: const TextStyle(fontSize: 13)),
            Text(u.category, style: const TextStyle(fontSize: 13)),
            Text(u.gender == 'M' ? 'Male' : 'Female', style: const TextStyle(fontSize: 13)),
            Text(u.reason, style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
          ]
      ],
    );
  }
}
