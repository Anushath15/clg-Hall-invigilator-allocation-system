import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/master_controllers.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/domain/validation.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';
import 'master_page.dart';

/// Master Data → Subjects: code, name, department, the staff who handle it and the students who study it.
class SubjectsTab extends StatelessWidget {
  const SubjectsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<SubjectsController>();
    Future<void> import({required bool mapping}) async {
      final r = await c.importSubjects(studentMapping: mapping);
      if (r == null || !context.mounted) return;
      showImportResult(context,
          success: r.success,
          error: r.error,
          inserted: r.inserted,
          issues: r.issues,
          what: mapping ? '${r.inserted} student–subject link(s) added.' : '${r.inserted} subject${r.inserted == 1 ? '' : 's'} saved.');
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TabToolbar(text: '${c.subjects.length} subjects · enter the subject each class writes in the seating configuration of every exam session', actions: [
        SecondaryButton(label: 'Template', icon: Icons.download, onPressed: () async {
          final p = await c.downloadTemplate();
          if (p != null) toast('Template saved to $p');
        }),
        SecondaryButton(label: 'Import Excel', icon: Icons.upload, onPressed: () => import(mapping: false)),
        PrimaryButton(label: 'Add Subject', icon: Icons.add, onPressed: () => _edit(context, c, null)),
      ]),
      Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Text('Students studying each subject: use the students button on a row, or import a sheet (${SubjectsController.mappingColumns.join(', ')}).', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
          SecondaryButton(label: 'Mapping template', icon: Icons.download, onPressed: () async {
            final p = await c.downloadMappingTemplate();
            if (p != null) toast('Template saved to $p');
          }),
          SecondaryButton(label: 'Import student mapping', icon: Icons.upload, onPressed: c.subjects.isEmpty ? null : () => import(mapping: true)),
        ]),
      ),
      Padding(padding: const EdgeInsets.only(bottom: 14), child: SizedBox(width: 380, child: SearchField(hint: 'Search code, name or staff', onChanged: c.setQuery))),
      DataTableCard(
        columns: const ['Code', 'Subject Name', 'Department', 'Handled by', 'Students', ''],
        flex: const [1, 2.2, 1, 2.4, 0.9, 1],
        empty: c.subjects.isNotEmpty ? 'No subjects match.' : 'No subjects yet. Add them one by one or import an Excel sheet with the columns ${SubjectsController.importColumns.join(', ')}.',
        rows: [
          for (final s in c.shown)
            [
              Text(s.code, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: s.isActive ? AppColors.primary : AppColors.gray400)),
              Text.rich(TextSpan(children: [
                TextSpan(text: s.name, style: TextStyle(fontWeight: FontWeight.w600, color: s.isActive ? null : AppColors.gray400)),
                if (!s.isActive) const TextSpan(text: '  Inactive', style: TextStyle(color: AppColors.error, fontSize: 12)),
              ])),
              Text(s.departmentCode ?? 'All', style: cellSec),
              Text(s.staff.isEmpty ? '—' : s.staff.map((u) => u.name).join(', '), style: const TextStyle(fontSize: 13)),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: () => showDialog(context: context, builder: (_) => SubjectStudentsDialog(c: c, subject: s)),
                  icon: const Icon(Icons.people_outline, size: 16),
                  label: Text('${s.studentIds.length}'),
                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8)),
                ),
              ),
              RowActions(
                onEdit: () => _edit(context, c, s),
                onDelete: () async {
                  if (!await confirmDialog(context, 'Delete subject ${s.code} – ${s.name}?', confirmLabel: 'Delete', danger: true)) return;
                  c.delete(s.id);
                  toast('Deleted');
                },
              ),
            ]
        ],
      ),
    ]);
  }

  void _edit(BuildContext context, SubjectsController c, Subject? s) => showDialog(context: context, builder: (_) => _SubjectForm(c: c, subject: s));
}

class _SubjectForm extends StatefulWidget {
  const _SubjectForm({required this.c, this.subject});
  final SubjectsController c;
  final Subject? subject;
  @override
  State<_SubjectForm> createState() => _SubjectFormState();
}

class _SubjectFormState extends State<_SubjectForm> {
  late final code = TextEditingController(text: widget.subject?.code);
  late final name = TextEditingController(text: widget.subject?.name);
  late int? dept = widget.subject?.departmentId;
  late bool active = widget.subject?.isActive ?? true;
  late final List<int> staffIds = [...?widget.subject?.staff.map((u) => u.id)];
  String staffQuery = '';

  void _save() {
    final problem = validateSubject(code: code.text, name: name.text);
    if (problem != null) return toast(problem, error: true);
    final e = widget.c.save(id: widget.subject?.id, code: code.text, name: name.text, departmentId: dept, isActive: active, staffIds: staffIds);
    if (e != null) return toast(e, error: true);
    toast('Saved!');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final staff = widget.c.staff;
    final shown = staff.where((u) => matchesSearch(staffQuery, [u.name, u.staffId])).toList();
    return ModalShell(
      title: widget.subject == null ? 'Add Subject' : 'Edit Subject',
      maxWidth: 560,
      actions: [OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), ElevatedButton(onPressed: _save, child: const Text('Save'))],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Field(
                label: 'Code *',
                child: TextField(
                  controller: code,
                  autofocus: true,
                  decoration: const InputDecoration(hintText: 'e.g. CS3401'),
                  onChanged: (v) {
                    final up = v.toUpperCase();
                    if (up != v) code.value = code.value.copyWith(text: up);
                  },
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(flex: 2, child: Field(label: 'Name *', child: TextField(controller: name, decoration: const InputDecoration(hintText: 'e.g. Compiler Design')))),
          ]),
          const SizedBox(height: 12),
          Field(label: 'Department', child: Select<int>(value: dept, hint: '— Common to all —', items: [for (final d in widget.c.departments) (d.id, d.code)], onChanged: (v) => setState(() => dept = v))),
          const SizedBox(height: 12),
          Text('Staff who handle this subject (${staffIds.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
          const Text('They are not given invigilation in a hall writing this subject, unless the rotation leaves no other choice.', style: TextStyle(fontSize: 12, color: AppColors.textSec)),
          const SizedBox(height: 6),
          if (staffIds.isNotEmpty)
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final id in staffIds)
                InputChip(
                  label: Text(staff.where((x) => x.id == id).map((u) => '${u.name} (${u.staffId})').firstOrNull ?? '#$id', style: const TextStyle(fontSize: 12)),
                  onDeleted: () => setState(() => staffIds.remove(id)),
                ),
            ]),
          const SizedBox(height: 6),
          SearchField(hint: 'Search staff by name or Staff ID', onChanged: (v) => setState(() => staffQuery = v)),
          const SizedBox(height: 6),
          Container(
            height: 200,
            decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(8)),
            child: shown.isEmpty
                ? const Center(child: Text('No staff match.', style: TextStyle(fontSize: 13, color: AppColors.textSec)))
                : ListView(children: [
                    for (final u in shown)
                      CheckboxListTile(
                        dense: true,
                        value: staffIds.contains(u.id),
                        onChanged: (_) => setState(() => staffIds.contains(u.id) ? staffIds.remove(u.id) : staffIds.add(u.id)),
                        controlAffinity: ListTileControlAffinity.leading,
                        title: Text(u.name, overflow: TextOverflow.ellipsis),
                        subtitle: Text('${u.staffId}${u.departmentCode != null ? ' · ${u.departmentCode}' : ''}'),
                      ),
                  ]),
          ),
          if (widget.subject != null)
            CheckboxListTile(value: active, onChanged: (v) => setState(() => active = v ?? true), title: const Text('Active'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading),
        ]),
      ),
    );
  }
}

/// The students who study one subject: tick whole classes (department + section + batch) or single students.
class SubjectStudentsDialog extends StatefulWidget {
  const SubjectStudentsDialog({super.key, required this.c, required this.subject});
  final SubjectsController c;
  final Subject subject;
  @override
  State<SubjectStudentsDialog> createState() => _SubjectStudentsDialogState();
}

class _SubjectStudentsDialogState extends State<SubjectStudentsDialog> {
  late final List<Student> students = widget.c.activeStudents();
  late final Set<int> selected = {...widget.subject.studentIds};
  final Set<String> open = {};
  String query = '';
  late bool onlyDept = widget.subject.departmentId != null;

  @override
  Widget build(BuildContext context) {
    final sub = widget.subject;
    final groups = <String, List<Student>>{};
    for (final s in students) {
      if (onlyDept && sub.departmentId != null && s.departmentId != sub.departmentId && !sub.studentIds.contains(s.id)) continue;
      if (!matchesSearch(query, [s.rollNo, s.registerNo, s.name])) continue;
      groups.putIfAbsent('${s.batch}|${s.departmentCode ?? '—'}|${s.section}', () => []).add(s);
    }
    final keys = groups.keys.toList()..sort(textCompare);
    return ModalShell(
      title: 'Students studying ${sub.code}',
      subtitle: '${sub.name} · tick whole classes or single students',
      maxWidth: 820,
      fullHeight: true,
      footerLeading: Text.rich(TextSpan(children: [TextSpan(text: '${selected.length}', style: const TextStyle(fontWeight: FontWeight.bold)), TextSpan(text: ' student(s) study ${sub.code}')])),
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        ElevatedButton(
          onPressed: () {
            final e = widget.c.setStudents(sub.id, selected.toList());
            if (e != null) return toast(e, error: true);
            toast('${selected.length} student(s) mapped to ${sub.code}.');
            Navigator.pop(context);
          },
          child: const Text('Save'),
        ),
      ],
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 12, 22, 12),
          child: Row(children: [
            Expanded(child: SearchField(hint: 'Search roll no, register no or name', onChanged: (v) => setState(() => query = v))),
            if (sub.departmentId != null)
              Row(mainAxisSize: MainAxisSize.min, children: [
                Checkbox(value: onlyDept, onChanged: (v) => setState(() => onlyDept = v ?? false)),
                const Text("Only this subject's department", style: TextStyle(fontSize: 13)),
              ]),
            if (selected.isNotEmpty) TextButton(onPressed: () => setState(selected.clear), child: const Text('Clear all', style: TextStyle(color: AppColors.red600))),
          ]),
        ),
        const Divider(),
        Expanded(
          child: students.isEmpty
              ? const Center(child: Text('No active students. Add them in Master Data → Students.', style: TextStyle(color: AppColors.textSec)))
              : ListView(padding: const EdgeInsets.fromLTRB(22, 10, 22, 10), children: [
                  for (final k in keys) _ClassGroup(
                    title: '${k.split('|')[1]}${k.split('|')[2].isNotEmpty ? ' ${k.split('|')[2]}' : ''}',
                    subtitle: '(${k.split('|')[0]})',
                    students: groups[k]!..sort((a, b) => naturalCompare(a.rollNo, b.rollNo)),
                    selected: selected,
                    open: open.contains(k) || query.trim().isNotEmpty,
                    countLabel: 'mapped',
                    onToggleOpen: () => setState(() => open.contains(k) ? open.remove(k) : open.add(k)),
                    onSet: (ids, on) => setState(() => on ? selected.addAll(ids) : selected.removeAll(ids)),
                  ),
                ]),
        ),
      ]),
    );
  }
}

/// One class (batch / department / section) with a tri-state tick and its students.
class _ClassGroup extends StatelessWidget {
  const _ClassGroup({required this.title, required this.subtitle, required this.students, required this.selected, required this.open, required this.onToggleOpen, required this.onSet, required this.countLabel});
  final String title, subtitle, countLabel;
  final List<Student> students;
  final Set<int> selected;
  final bool open;
  final VoidCallback onToggleOpen;
  final void Function(List<int> ids, bool on) onSet;
  @override
  Widget build(BuildContext context) => ClassGroupTile(
        title: title,
        subtitle: subtitle,
        extra: '',
        students: students,
        selected: selected,
        open: open,
        onToggleOpen: onToggleOpen,
        onSet: onSet,
        countLabel: countLabel,
      );
}

/// A collapsible class of students with a tri-state checkbox (used by the subject mapping and the student selector).
class ClassGroupTile extends StatelessWidget {
  const ClassGroupTile({super.key, required this.title, required this.subtitle, required this.extra, required this.students, required this.selected, required this.open, required this.onToggleOpen, required this.onSet, this.countLabel = 'selected', this.showGender = false});
  final String title, subtitle, extra, countLabel;
  final List<Student> students;
  final Set<int> selected;
  final bool open, showGender;
  final VoidCallback onToggleOpen;
  final void Function(List<int> ids, bool on) onSet;

  @override
  Widget build(BuildContext context) {
    final ids = students.map((s) => s.id).toList();
    final count = ids.where(selected.contains).length;
    final all = ids.isNotEmpty && count == ids.length;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(8)),
      child: Column(children: [
        InkWell(
          onTap: onToggleOpen,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            child: Row(children: [
              Icon(open ? Icons.expand_more : Icons.chevron_right, size: 20, color: AppColors.textSec),
              Checkbox(tristate: true, value: all ? true : (count > 0 ? null : false), onChanged: (_) => onSet(ids, !all)),
              Expanded(
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: title, style: const TextStyle(fontWeight: FontWeight.bold)),
                  TextSpan(text: ' $subtitle', style: const TextStyle(color: AppColors.textSec)),
                  TextSpan(text: '   $count/${ids.length} $countLabel$extra', style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
                ])),
              ),
            ]),
          ),
        ),
        if (open)
          Container(
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: AppColors.border))),
            padding: const EdgeInsets.all(8),
            child: LayoutBuilder(builder: (_, box) {
              final w = box.maxWidth >= 560 ? (box.maxWidth - 8) / 2 : box.maxWidth;
              return Wrap(spacing: 8, children: [
                for (final s in students)
                  SizedBox(
                    width: w,
                    child: InkWell(
                      onTap: () => onSet([s.id], !selected.contains(s.id)),
                      child: Row(children: [
                        Checkbox(value: selected.contains(s.id), onChanged: (v) => onSet([s.id], v ?? false), visualDensity: VisualDensity.compact),
                        Text(s.rollNo, style: monoSmall.copyWith(fontWeight: FontWeight.w600, fontSize: 12.5)),
                        const SizedBox(width: 8),
                        Expanded(child: Text(s.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13))),
                        if (showGender) s.gender == 'F' ? const Pill('F', bg: AppColors.pink50, fg: AppColors.pink700) : const Pill('M', bg: AppColors.sky50, fg: AppColors.sky700),
                      ]),
                    ),
                  ),
              ]);
            }),
          ),
      ]),
    );
  }
}
