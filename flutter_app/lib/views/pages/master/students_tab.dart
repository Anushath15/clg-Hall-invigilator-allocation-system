import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/master_controllers.dart';
import '../../../core/theme.dart';
import '../../../models/domain/validation.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';
import 'master_page.dart';

/// Master Data → Students: roll number, register number, name, gender, department, section and
/// batch; department + section + batch is one class.
class StudentsTab extends StatelessWidget {
  const StudentsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<StudentsController>();
    final shown = c.shown;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TabToolbar(text: '${c.students.length} students${shown.length != c.students.length ? ' · ${shown.length} shown' : ''}', actions: [
        SecondaryButton(label: 'Template', icon: Icons.download, onPressed: () async {
          final p = await c.downloadTemplate();
          if (p != null) toast('Template saved to $p');
        }),
        SecondaryButton(
          label: 'Import Excel',
          icon: Icons.upload,
          onPressed: () async {
            final r = await c.importExcel();
            if (r == null || !context.mounted) return;
            showImportResult(context, success: r.success, error: r.error, inserted: r.inserted, issues: r.issues, what: '${r.inserted} student${r.inserted == 1 ? '' : 's'} imported successfully.');
          },
        ),
        PrimaryButton(label: 'Add Student', icon: Icons.add, onPressed: () => _edit(context, c, null)),
      ]),
      if (c.summary.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            for (final b in c.summary)
              ToggleChip(label: '${b.batch} · ${b.boys} boys · ${b.girls} girls', on: c.batch == b.batch, onTap: () => c.setFilter(batch: c.batch == b.batch ? '' : b.batch)),
          ]),
        ),
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          SizedBox(width: 320, child: SearchField(hint: 'Search roll no, register no or name', onChanged: (v) => c.setFilter(query: v))),
          Select<String>(value: c.batch.isEmpty ? null : c.batch, hint: 'All batches', width: 170, items: [for (final b in c.batches) (b, b)], onChanged: (v) => c.setFilter(batch: v ?? '')),
          Select<int>(value: c.departmentId, hint: 'All departments', width: 180, items: [for (final d in c.departments) (d.id, d.code)], onChanged: (v) => c.setFilter(departmentId: v, clearDepartment: v == null)),
          Select<String>(value: c.section.isEmpty ? null : c.section, hint: 'All sections', width: 150, items: [for (final s in c.sections) (s, 'Section $s')], onChanged: (v) => c.setFilter(section: v ?? '')),
          Select<String>(value: c.gender.isEmpty ? null : c.gender, hint: 'Boys and girls', width: 160, items: const [('M', 'Boys'), ('F', 'Girls')], onChanged: (v) => c.setFilter(gender: v ?? '')),
        ]),
      ),
      DataTableCard(
        columns: const ['Roll No', 'Register No', 'Name', 'Gender', 'Department', 'Section', 'Batch', 'Status', ''],
        flex: const [1, 1.3, 2, 0.9, 1, 0.8, 1.1, 1, 1],
        minWidth: 1000,
        empty: c.students.isNotEmpty ? 'No students match these filters.' : 'No students yet. Add them one by one or import an Excel sheet (download the template first).',
        rows: [
          for (final s in shown)
            [
              Text(s.rollNo, style: monoSmall.copyWith(fontWeight: FontWeight.w600)),
              Text(s.registerNo, style: monoSmall),
              Text(s.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              Align(alignment: Alignment.centerLeft, child: s.gender == 'F' ? const Pill('Female', bg: AppColors.pink50, fg: AppColors.pink700) : const Pill('Male', bg: AppColors.sky50, fg: AppColors.sky700)),
              Text(s.departmentCode ?? '—', style: cellSec),
              Text(s.section.isEmpty ? '—' : s.section, style: cellSec),
              Text(s.batch, style: cellSec),
              ActiveStatus(s.isActive),
              RowActions(
                onEdit: () => _edit(context, c, s),
                onDelete: () async {
                  if (!await confirmDialog(context, 'Delete student ${s.rollNo} – ${s.name}?', confirmLabel: 'Delete', danger: true)) return;
                  final e = c.delete(s.id);
                  toast(e ?? 'Deleted', error: e != null);
                },
              ),
            ]
        ],
      ),
    ]);
  }

  void _edit(BuildContext context, StudentsController c, Student? s) => showDialog(context: context, builder: (_) => _StudentForm(c: c, student: s));
}

class _StudentForm extends StatefulWidget {
  const _StudentForm({required this.c, this.student});
  final StudentsController c;
  final Student? student;
  @override
  State<_StudentForm> createState() => _StudentFormState();
}

class _StudentFormState extends State<_StudentForm> {
  late final roll = TextEditingController(text: widget.student?.rollNo);
  late final reg = TextEditingController(text: widget.student?.registerNo);
  late final name = TextEditingController(text: widget.student?.name);
  late final section = TextEditingController(text: widget.student?.section ?? widget.c.section);
  late final batch = TextEditingController(text: widget.student?.batch ?? widget.c.batch);
  late String gender = widget.student?.gender ?? 'M';
  late int? dept = widget.student?.departmentId;
  late bool active = widget.student?.isActive ?? true;

  void _save() {
    final problem = validateStudent(rollNo: roll.text, registerNo: reg.text, name: name.text, gender: gender, section: section.text, batch: batch.text);
    if (problem != null) return toast(problem, error: true);
    if (dept == null) return toast('Department is required.', error: true);
    final e = widget.c.save(id: widget.student?.id, rollNo: roll.text, registerNo: reg.text, name: name.text, gender: gender, departmentId: dept, section: section.text, batch: batch.text, isActive: active);
    if (e != null) return toast(e, error: true);
    toast('Saved!');
    Navigator.pop(context);
  }

  Widget _suggest(TextEditingController ctrl, List<String> options, String hint, {bool upper = false}) => Autocomplete<String>(
        initialValue: TextEditingValue(text: ctrl.text),
        optionsBuilder: (v) => options.where((o) => o.toLowerCase().contains(v.text.toLowerCase())),
        onSelected: (v) => ctrl.text = v,
        fieldViewBuilder: (ctx, c, focus, _) => TextField(
          controller: c,
          focusNode: focus,
          decoration: InputDecoration(hintText: hint),
          onChanged: (v) => ctrl.text = upper ? v.toUpperCase() : v,
        ),
      );

  @override
  Widget build(BuildContext context) => ModalShell(
        title: widget.student == null ? 'Add Student' : 'Edit Student',
        maxWidth: 520,
        actions: [OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), ElevatedButton(onPressed: _save, child: const Text('Save'))],
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Field(label: 'Roll Number *', child: TextField(controller: roll, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. 23CS001')))),
              const SizedBox(width: 12),
              Expanded(child: Field(label: 'Register Number *', child: TextField(controller: reg, decoration: const InputDecoration(hintText: 'e.g. 961223104001')))),
            ]),
            const SizedBox(height: 12),
            Field(label: 'Name *', child: TextField(controller: name)),
            const SizedBox(height: 12),
            Field(
              label: 'Gender *',
              child: Row(children: [
                for (final g in const [('M', 'Male'), ('F', 'Female')]) ...[
                  Radio<String>(value: g.$1, groupValue: gender, onChanged: (v) => setState(() => gender = v!)),
                  Text(g.$2),
                  const SizedBox(width: 16),
                ]
              ]),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Field(label: 'Department *', child: Select<int>(value: dept, items: [for (final d in widget.c.departments) (d.id, d.code)], onChanged: (v) => setState(() => dept = v)))),
              const SizedBox(width: 12),
              Expanded(child: Field(label: 'Section *', child: _suggest(section, widget.c.sections, 'e.g. A', upper: true))),
              const SizedBox(width: 12),
              Expanded(child: Field(label: 'Batch *', child: _suggest(batch, widget.c.batches, 'e.g. 2023-2027'))),
            ]),
            if (widget.student != null)
              CheckboxListTile(value: active, onChanged: (v) => setState(() => active = v ?? true), title: const Text('Active'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading),
          ]),
        ),
      );
}
