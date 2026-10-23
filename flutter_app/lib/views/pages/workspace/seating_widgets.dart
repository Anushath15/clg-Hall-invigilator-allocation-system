import 'package:collection/collection.dart';
import 'package:flutter/material.dart';

import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../controllers/seating_controllers.dart';
import '../../../models/domain/hall_layout.dart';
import '../../../models/domain/seating.dart';
import '../../../models/domain/seating_report.dart';
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
  const HallBenchGrid({super.key, required this.layout, required this.seats, required this.colorOf, this.highlight = const [], this.onSeatTap, this.pickedId});
  final HallLayout layout;
  final List<SeatRow> seats;
  final ClassColor Function(String) colorOf;
  final List<int> highlight;
  /// When set, every seat can be clicked (to pick a student and to choose the seat to move to): bench row, bench column, "L" or "R", and who sits there.
  final void Function(int row, int col, String seat, SeatRow? student)? onSeatTap;
  /// The student picked to be moved, shown with a blue frame.
  final int? pickedId;

  @override
  Widget build(BuildContext context) {
    final numbers = {for (final b in enabledBenches(layout)) benchKey(b.row, b.col): b};
    final at = <String, Map<String, SeatRow>>{};
    for (final s in seats) {
      at.putIfAbsent(benchKey(s.benchRow, s.benchCol), () => {})[s.seat] = s;
    }
    final mixed = seats.map((s) => s.gender).toSet().length > 1;
    Widget seatCell(SeatRow? s, int row, int col, String side) {
      Widget tappable(Widget child) => onSeatTap == null
          ? child
          : MouseRegion(cursor: SystemMouseCursors.click, child: GestureDetector(behavior: HitTestBehavior.opaque, onTap: () => onSeatTap!(row, col, side, s), child: child));
      if (s == null) {
        return tappable(Container(
          padding: const EdgeInsets.symmetric(vertical: 3),
          alignment: Alignment.center,
          decoration: BoxDecoration(border: Border.all(color: AppColors.gray200), borderRadius: BorderRadius.circular(4)),
          child: const Text('empty', style: TextStyle(fontSize: 11.5, color: AppColors.gray300)),
        ));
      }
      final cc = colorOf(s.colorKey);
      final picked = pickedId == s.studentId;
      return tappable(Tooltip(
        message: '${s.rollNo} · ${s.studentName} · ${s.deptCode ?? ''} ${s.year ?? ''} · ${s.batch}',
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 4),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: cc.bg,
            borderRadius: BorderRadius.circular(4),
            border: picked ? Border.all(color: AppColors.primary, width: 3) : Border(
              left: mixed ? BorderSide(color: s.gender == 'F' ? AppColors.pink600 : AppColors.sky600, width: 4) : BorderSide.none,
              top: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
              bottom: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
              right: highlight.contains(s.studentId) ? const BorderSide(color: AppColors.error, width: 2) : BorderSide.none,
            ),
          ),
          child: Text(s.rollNo, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: 'Consolas', fontSize: 11.5, fontWeight: FontWeight.w700, color: cc.fg)),
        ),
      ));
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
                          ? Row(children: [Expanded(child: seatCell(b?['L'], r, c, 'L')), const SizedBox(width: 4), Expanded(child: seatCell(b?['R'], r, c, 'R'))])
                          : Row(children: [const Spacer(), Expanded(flex: 2, child: seatCell(b?['L'], r, c, 'L')), const Spacer()]),
                    ]),
                  );
                }),
            ]),
        ]),
      ),
    ]);
  }
}

/// A hall's seating in a popup: invigilators, student count, classes, and the bench grid. "Edit seats" lets the
/// administrator move a student by hand: click the student, then the seat to move to (a taken seat swaps the two).
/// Every rule is checked again before the move is saved; a move that breaks one is refused with its reasons.
class HallSeatingDialog extends StatefulWidget {
  const HallSeatingDialog({super.key, this.controller, required this.hall, required this.colorOf, this.highlight = const [], this.previewSeats, this.previewGender});
  /// The saved plan's controller: seats are read from it and can be edited. Null for a preview of an unsaved plan.
  final SeatingPanelController? controller;
  /// For a preview (no controller): the seats and the group of the hall.
  final List<SeatRow>? previewSeats;
  final String? previewGender;
  final SeatingHallInfo hall;
  final ClassColor Function(String) colorOf;
  final List<int> highlight;

  @override
  State<HallSeatingDialog> createState() => _HallSeatingDialogState();
}

class _HallSeatingDialogState extends State<HallSeatingDialog> {
  late final ChangeNotifier _static = ChangeNotifier();
  late int hallId = widget.hall.id;
  bool editing = false;
  int? pickedId;
  List<String> reasons = const [];
  String? note;

  SeatingPanelController? get _c => widget.controller;
  bool get _canEdit => _c != null;

  void _tap(int row, int col, String seat, SeatRow? student) {
    if (!editing) return;
    if (pickedId == null) {
      if (student != null) {
        setState(() {
          pickedId = student.studentId;
          reasons = const [];
          note = null;
        });
      }
      return;
    }
    if (student?.studentId == pickedId) {
      setState(() {
        pickedId = null;
        reasons = const [];
      });
      return;
    }
    final r = _c!.moveStudent(pickedId!, hallId: hallId, row: row, col: col, seat: seat);
    setState(() {
      if (r.success) {
        pickedId = null;
        reasons = const [];
        note = r.swappedWith == null ? 'Student moved.' : 'The two students swapped seats (${r.swappedWith}).';
      } else {
        reasons = r.reasons.isNotEmpty ? r.reasons : [r.error ?? 'This move is not allowed.'];
        note = null;
      }
    });
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: _c ?? _static,
        builder: (context, _) {
          final c = _c;
          final hall = c?.sessionHalls.firstWhere((h) => h.id == hallId, orElse: () => widget.hall) ?? widget.hall;
          final seats = c?.seatsIn(hall.id) ?? widget.previewSeats ?? const <SeatRow>[];
          final gender = c == null ? widget.previewGender : c.genderOf(hall.id);
          final colorOf = widget.colorOf;
          final picked = pickedId == null || c == null ? null : c.seats.firstWhereOrNull((x) => x.studentId == pickedId);
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
                // A Wrap, so the buttons drop to a second line in a narrow window instead of overflowing.
                Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: 10, runSpacing: 8, children: [
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    Pill(groupLabel(gender), bg: bg, fg: fg),
                    if (c != null && c.lockedHalls.contains(hall.id)) ...[
                      const SizedBox(width: 8),
                      const Icon(Icons.lock, size: 16, color: AppColors.primary),
                      const SizedBox(width: 4),
                      const Text('Locked', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.primary)),
                    ],
                  ]),
                  if (editing && c != null) ...[
                    const Text('Hall shown: ', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
                    Select<int>(
                        value: hallId,
                        hint: 'Hall',
                        width: 140,
                        items: [for (final h in c.sessionHalls) (h.id, h.hallCode)],
                        onChanged: (v) => setState(() {
                              if (v != null) hallId = v;
                            })),
                  ],
                  if (_canEdit && seats.isNotEmpty) ...[
                    Builder(builder: (_) {
                      final isLocked = c!.lockedHalls.contains(hall.id);
                      return SecondaryButton(
                        label: isLocked ? 'Unlock hall' : 'Lock hall',
                        icon: isLocked ? Icons.lock_open_outlined : Icons.lock_outline,
                        onPressed: () {
                          final e = c.setLocked([hall.id], !isLocked);
                          setState(() => note = e == null ? (isLocked ? 'Hall unlocked.' : 'Hall locked: it keeps its students and seats when the rest is seated again.') : null);
                          if (e != null) setState(() => reasons = [e]);
                        },
                      );
                    }),
                  ],
                  if (_canEdit)
                    editing
                      ? PrimaryButton(
                          label: 'Done editing',
                          icon: Icons.check,
                          onPressed: () => setState(() {
                                editing = false;
                                pickedId = null;
                                reasons = const [];
                                note = null;
                              }))
                      : SecondaryButton(
                          label: 'Edit seats',
                          icon: Icons.drag_indicator,
                          onPressed: () => setState(() {
                                editing = true;
                                note = null;
                              })),
                ]),
                const SizedBox(height: 12),
                IntrinsicHeight(
                  child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    box(Icons.how_to_reg_outlined, hall.invigilators.length > 1 ? 'Invigilators' : 'Invigilator',
                        Text(hall.invigilators.isEmpty ? 'Not allocated' : hall.invigilators.join(', '), style: const TextStyle(fontWeight: FontWeight.w600))),
                    box(
                        Icons.people_outline,
                        'Students',
                        Text.rich(TextSpan(children: [
                          TextSpan(text: '${seats.length}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
                          TextSpan(text: '  of ${hall.seats} seats · $boys boys · ${seats.length - boys} girls', style: cellSec),
                        ]))),
                    box(
                        Icons.school_outlined,
                        '${depts.length > 1 ? 'Departments' : 'Department'}${depts.isNotEmpty ? ' (${depts.length})' : ''}',
                        Wrap(spacing: 6, runSpacing: 6, children: [
                          for (final k in keys)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(color: colorOf(k).bg, borderRadius: BorderRadius.circular(4)),
                              child: Text('$k · ${classes[k]}', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: colorOf(k).fg)),
                            ),
                        ])),
                  ]),
                ),
                if (editing) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    decoration: BoxDecoration(color: AppColors.gray50, border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(10)),
                    child: Text(
                      picked == null
                          ? 'Click the student to move. Then click the seat to move to: an empty seat, or a student to swap seats with. Pick another hall above to move across halls.'
                          : 'Moving ${picked.rollNo} · ${picked.studentName} (${picked.hallCode}, ${picked.seat == 'L' ? 'left' : 'right'} seat of bench ${picked.benchNo}). Click the new seat, or click the student again to cancel.',
                      style: const TextStyle(fontSize: 13.5),
                    ),
                  ),
                  if (reasons.isNotEmpty)
                    Container(
                      margin: const EdgeInsets.only(top: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(color: const Color(0xFFFEF2F2), border: Border.all(color: const Color(0xFFFCA5A5)), borderRadius: BorderRadius.circular(10)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Text('This move is not allowed, so nothing was changed:', style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.error)),
                        const SizedBox(height: 4),
                        for (final r in reasons.take(6)) Text('• $r', style: const TextStyle(fontSize: 13.5, color: AppColors.error)),
                        if (reasons.length > 6) Text('…and ${reasons.length - 6} more', style: const TextStyle(fontSize: 13, color: AppColors.error)),
                      ]),
                    ),
                  if (note != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(note!, style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.green600))),
                ],
                const SizedBox(height: 16),
                HallBenchGrid(layout: hall.layout, seats: seats, colorOf: colorOf, highlight: widget.highlight, onSeatTap: editing ? _tap : null, pickedId: pickedId),
              ]),
            ),
          );
        },
      );
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

/// The rules in priority order, each met, relaxed, or the one that stopped students: so a rule is never given up silently.
class RuleCheckCard extends StatelessWidget {
  const RuleCheckCard({super.key, required this.report});
  final PlanReport report;

  @override
  Widget build(BuildContext context) {
    (IconData, Color) look(RuleStatus st) => switch (st) {
          RuleStatus.met => (Icons.check_circle, AppColors.green600),
          RuleStatus.relaxed => (Icons.error_outline, AppColors.amber800),
          RuleStatus.blocking => (Icons.cancel, AppColors.error),
          RuleStatus.notApplicable => (Icons.remove_circle_outline, AppColors.gray400),
        };
    final blocked = report.blocking.fold(0, (n, f) => n + f.students);
    return AppCard(
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text('Rule check', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(width: 8),
          const Flexible(child: Text('in priority order: a rule is given up only after the ones above it', overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: AppColors.textSec))),
        ]),
        const SizedBox(height: 8),
        for (final f in report.findings)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(look(f.status).$1, size: 18, color: look(f.status).$2),
              const SizedBox(width: 8),
              Expanded(
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: '${f.priority}. ${f.rule}: ', style: const TextStyle(fontWeight: FontWeight.w700)),
                  TextSpan(text: f.detail, style: TextStyle(color: f.status == RuleStatus.blocking ? AppColors.error : null)),
                  if (f.suggestion != null) TextSpan(text: '  ${f.suggestion}', style: const TextStyle(color: AppColors.textSec, fontStyle: FontStyle.italic)),
                ]), style: const TextStyle(fontSize: 13.5)),
              ),
            ]),
          ),
        if (blocked > 0)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('No rule was broken: $blocked student${blocked == 1 ? ' has' : 's have'} no seat that keeps them all, and each is listed as unallocated with the rule that stopped them.',
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ),
      ]),
    );
  }
}
