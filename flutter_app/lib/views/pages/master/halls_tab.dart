import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/master_controllers.dart';
import '../../../core/theme.dart';
import '../../../models/domain/hall_layout.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';
import 'master_page.dart';

class HallsTab extends StatelessWidget {
  const HallsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<HallsController>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TabToolbar(text: '${c.halls.length} halls · Listed in the order they were added; the allocation does not depend on this order', actions: [
        PrimaryButton(label: 'Add Hall', icon: Icons.add, onPressed: () => _edit(context, c, null)),
      ]),
      DataTableCard(
        columns: const ['Order', 'Hall Code', 'Block', 'Floor', 'Seating', 'Capacity', 'Status', ''],
        flex: const [0.6, 1, 1.4, 0.8, 2.6, 0.8, 1, 1],
        minWidth: 900,
        empty: 'No halls added yet.',
        rows: [
          for (var i = 0; i < c.halls.length; i++)
            [
              Text('#${i + 1}', style: cellSec),
              Text(c.halls[i].hallCode, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary)),
              Text(c.halls[i].block?.isNotEmpty == true ? c.halls[i].block! : '—', style: cellSec),
              Text(c.halls[i].floor?.isNotEmpty == true ? c.halls[i].floor! : '—', style: const TextStyle(fontWeight: FontWeight.w600)),
              _benchSummary(c.halls[i].layout),
              Text('${c.halls[i].capacity}', style: cellSec),
              ActiveStatus(c.halls[i].isActive),
              RowActions(
                onEdit: () => _edit(context, c, c.halls[i]),
                onDelete: () async {
                  final h = c.halls[i];
                  if (!await confirmDialog(context, 'Delete hall ${h.hallCode}?', confirmLabel: 'Delete', danger: true)) return;
                  final e = c.delete(h.id);
                  toast(e ?? 'Deleted', error: e != null);
                },
              ),
            ]
        ],
      ),
    ]);
  }

  Widget _benchSummary(HallLayout l) {
    if (l.rows == 0) return const Text('Not set', style: TextStyle(color: AppColors.amber600, fontSize: 13));
    return Text('${kindSummary(l)} (${l.cols} col × ${l.rows} rows${l.disabled.isNotEmpty ? ', ${l.disabled.length} removed' : ''})', style: cellSec.copyWith(fontSize: 13));
  }

  void _edit(BuildContext context, HallsController c, Hall? h) => showDialog(context: context, builder: (_) => _HallForm(c: c, hall: h));
}

class _HallForm extends StatefulWidget {
  const _HallForm({required this.c, this.hall});
  final HallsController c;
  final Hall? hall;
  @override
  State<_HallForm> createState() => _HallFormState();
}

class _HallFormState extends State<_HallForm> {
  late final code = TextEditingController(text: widget.hall?.hallCode);
  late final block = TextEditingController(text: widget.hall?.block);
  late final floor = TextEditingController(text: widget.hall?.floor);
  late final capacity = TextEditingController(text: '${widget.hall?.capacity ?? 0}');
  late final rowsC = TextEditingController(text: '${widget.hall?.layout.rows ?? 0}');
  late final colsC = TextEditingController(text: '${widget.hall?.layout.cols ?? 0}');
  late bool active = widget.hall?.isActive ?? true;
  late HallLayout layout = widget.hall?.layout ?? const HallLayout(rows: 0, cols: 0);

  HallLayout get clean {
    final d = cleanDisabled(layout);
    return layout.copyWith(disabled: d, kinds: cleanKinds(layout.copyWith(disabled: d)));
  }

  void _setGrid(bool rows, String v) {
    final n = (int.tryParse(v) ?? 0).clamp(0, rows ? maxBenchRows : maxBenchCols);
    setState(() => layout = rows ? layout.copyWith(rows: n) : layout.copyWith(cols: n));
  }

  void _save() {
    if (code.text.trim().isEmpty) return toast('Hall Code is required.', error: true);
    final hasGrid = layout.rows > 0 && layout.cols > 0;
    final e = widget.c.save(
      id: widget.hall?.id,
      hallCode: code.text,
      block: block.text,
      floor: floor.text,
      capacity: int.tryParse(capacity.text) ?? 0,
      isActive: active,
      layout: hasGrid ? clean : HallLayout(rows: layout.rows, cols: layout.cols),
    );
    if (e != null) return toast(e, error: true);
    toast('Saved!');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final hasGrid = layout.rows > 0 && layout.cols > 0;
    final benches = hasGrid ? benchCount(clean) : 0, seats = hasGrid ? seatCount(clean) : 0;
    return ModalShell(
      title: widget.hall == null ? 'Add Hall' : 'Edit Hall',
      maxWidth: benches > 0 ? 820 : 480,
      actions: [OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), ElevatedButton(onPressed: _save, child: const Text('Save'))],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
          Field(label: 'Hall Code *', child: TextField(controller: code, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. H001'))),
          const SizedBox(height: 12),
          Field(label: 'Block / Building', child: TextField(controller: block, decoration: const InputDecoration(hintText: 'e.g. Main Block'))),
          const SizedBox(height: 12),
          Field(
            label: 'Floor',
            child: Autocomplete<String>(
              initialValue: TextEditingValue(text: floor.text),
              optionsBuilder: (v) => const ['Ground', '1st', '2nd', '3rd', '4th', '5th'].where((f) => f.toLowerCase().startsWith(v.text.toLowerCase())),
              onSelected: (v) => floor.text = v,
              fieldViewBuilder: (ctx, ctrl, focus, onSubmit) => TextField(controller: ctrl, focusNode: focus, onChanged: (v) => floor.text = v, decoration: const InputDecoration(hintText: 'e.g. Ground, 1st, 2nd')),
            ),
          ),
          const Divider(height: 28),
          const Text('Seating layout (student seating)', style: TextStyle(fontWeight: FontWeight.w700)),
          const Padding(
            padding: EdgeInsets.only(top: 2, bottom: 8),
            child: Text('Enter the number of columns, and as rows the most seats any column has. Then mark what stands at each place: a bench (two students), a chair (one student), or no seat.', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
          ),
          Row(children: [
            Expanded(child: Field(label: 'Columns (left to right)', child: TextField(controller: colsC, keyboardType: TextInputType.number, onChanged: (v) => _setGrid(false, v)))),
            const SizedBox(width: 12),
            Expanded(child: Field(label: 'Rows (front to back)', child: TextField(controller: rowsC, keyboardType: TextInputType.number, onChanged: (v) => _setGrid(true, v)))),
          ]),
          if (hasGrid) ...[
            const SizedBox(height: 12),
            BenchLayoutEditor(layout: layout, onChanged: (l) => setState(() => layout = l)),
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('${kindSummary(clean)} · $seats seats${layout.rows * layout.cols - benches > 0 ? ' · ${layout.rows * layout.cols - benches} removed' : ''}',
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
            ),
          ],
          const SizedBox(height: 12),
          benches > 0
              ? Field(label: 'Capacity', child: Text('$seats seats (two per bench, one per chair)', style: cellSec))
              : Field(label: 'Capacity', child: TextField(controller: capacity, keyboardType: TextInputType.number)),
          CheckboxListTile(value: active, onChanged: (v) => setState(() => active = v ?? true), title: const Text('Active'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading),
        ]),
      ),
    );
  }
}

enum _Tool { bench, chair, remove }

/// The hall's seating grid as seen from the front. Pick a tool and tap positions (or a row / column heading).
class BenchLayoutEditor extends StatefulWidget {
  const BenchLayoutEditor({super.key, required this.layout, required this.onChanged});
  final HallLayout layout;
  final ValueChanged<HallLayout> onChanged;
  @override
  State<BenchLayoutEditor> createState() => _BenchLayoutEditorState();
}

class _BenchLayoutEditorState extends State<BenchLayoutEditor> {
  _Tool tool = _Tool.remove;

  void _apply(List<String> keys) {
    final l = widget.layout;
    final off = {...l.disabled};
    final kinds = {...l.kinds};
    if (tool == _Tool.remove) {
      final anyOn = keys.any((k) => !off.contains(k));
      for (final k in keys) {
        anyOn ? off.add(k) : off.remove(k);
      }
    } else {
      for (final k in keys) {
        off.remove(k);
        if (tool == _Tool.bench) {
          kinds.remove(k);
        } else {
          kinds[k] = SeatKind.chair;
        }
      }
    }
    widget.onChanged(l.copyWith(disabled: off.toList(), kinds: kinds));
  }

  void _fillAll(SeatKind kind) {
    final l = widget.layout;
    final all = <String, SeatKind>{};
    if (kind == SeatKind.chair) {
      for (var r = 1; r <= l.rows; r++) {
        for (var c = 1; c <= l.cols; c++) {
          all[benchKey(r, c)] = SeatKind.chair;
        }
      }
    }
    widget.onChanged(l.copyWith(kinds: all));
  }

  @override
  Widget build(BuildContext context) {
    final l = widget.layout;
    final off = l.disabled.toSet();
    final numbers = {for (final b in enabledBenches(l.copyWith(kinds: const {}))) benchKey(b.row, b.col): b.benchNo};
    Widget toolBtn(_Tool t, String label, Color border, Color bg, Color fg) => Padding(
          padding: const EdgeInsets.only(right: 6),
          child: InkWell(
            onTap: () => setState(() => tool = t),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6), border: Border.all(color: tool == t ? AppColors.primary : border, width: tool == t ? 2 : 1)),
              child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg)),
            ),
          ),
        );
    const cell = 46.0;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Wrap(crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 6, children: [
        const Text('Tap to place: ', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
        toolBtn(_Tool.bench, 'Bench (2 students)', AppColors.primary, AppColors.veryLight, AppColors.primary),
        toolBtn(_Tool.chair, 'Chair (1 student)', AppColors.warning, AppColors.amber50, AppColors.amber700),
        toolBtn(_Tool.remove, 'No seat ×', AppColors.gray400, Colors.white, AppColors.gray700),
      ]),
      const SizedBox(height: 6),
      Row(children: [
        const Text('Whole hall: ', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
        LinkButton('all benches', onPressed: () => _fillAll(SeatKind.bench)),
        const SizedBox(width: 10),
        LinkButton('all chairs', onPressed: () => _fillAll(SeatKind.chair)),
      ]),
      const SizedBox(height: 8),
      Container(
        padding: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(color: AppColors.gray700, borderRadius: BorderRadius.circular(6)),
        child: const Text('FRONT · BOARD', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 2)),
      ),
      const SizedBox(height: 8),
      ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.45),
        child: SingleChildScrollView(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Center(
              child: Column(children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  const SizedBox(width: 34),
                  for (var c = 1; c <= l.cols; c++)
                    SizedBox(
                      width: cell + 4,
                      child: TextButton(onPressed: () => _apply([for (var r = 1; r <= l.rows; r++) benchKey(r, c)]), child: Text('C$c', style: const TextStyle(fontSize: 12))),
                    ),
                ]),
                for (var r = 1; r <= l.rows; r++)
                  Row(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                      width: 34,
                      child: TextButton(
                          style: TextButton.styleFrom(padding: EdgeInsets.zero), onPressed: () => _apply([for (var c = 1; c <= l.cols; c++) benchKey(r, c)]), child: Text('R$r', style: const TextStyle(fontSize: 12))),
                    ),
                    for (var c = 1; c <= l.cols; c++)
                      Builder(builder: (_) {
                        final k = benchKey(r, c);
                        final isOff = off.contains(k);
                        final chair = l.kinds[k] == SeatKind.chair;
                        return Padding(
                          padding: const EdgeInsets.all(2),
                          child: Tooltip(
                            message: isOff ? 'No seat at row $r, column $c' : '${chair ? 'Chair' : 'Bench'} ${numbers[k]} (row $r, column $c)',
                            child: InkWell(
                              onTap: () => _apply([k]),
                              child: Container(
                                width: cell,
                                height: 32,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: isOff ? Colors.white : (chair ? AppColors.amber50 : AppColors.veryLight),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: isOff ? AppColors.gray300 : (chair ? AppColors.warning : AppColors.primary)),
                                ),
                                child: Text(isOff ? '×' : '${numbers[k]}${chair ? 'C' : ''}',
                                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: isOff ? AppColors.gray300 : (chair ? AppColors.amber700 : AppColors.primary))),
                              ),
                            ),
                          ),
                        );
                      }),
                  ]),
              ]),
            ),
          ),
        ),
      ),
    ]);
  }
}
