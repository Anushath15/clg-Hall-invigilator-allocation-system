import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/master_controllers.dart';
import '../../../core/theme.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';
import 'master_page.dart';

class DepartmentsTab extends StatelessWidget {
  const DepartmentsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<DepartmentsController>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TabToolbar(text: '${c.departments.length} departments', actions: [
        PrimaryButton(label: 'Add Department', icon: Icons.add, onPressed: () => _edit(context, c, null)),
      ]),
      DataTableCard(
        columns: const ['Code', 'Department Name', ''],
        flex: const [1, 4, 1],
        minWidth: 500,
        empty: 'No departments yet.',
        rows: [
          for (final d in c.departments)
            [
              Text(d.code, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary)),
              Text(d.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              RowActions(
                onEdit: () => _edit(context, c, d),
                onDelete: () async {
                  if (!await confirmDialog(context, 'Delete department ${d.code}?', confirmLabel: 'Delete', danger: true)) return;
                  final e = c.delete(d.id);
                  toast(e ?? 'Deleted', error: e != null);
                },
              ),
            ]
        ],
      ),
    ]);
  }

  void _edit(BuildContext context, DepartmentsController c, Department? d) => showDialog(context: context, builder: (_) => _DeptForm(c: c, dept: d));
}

class _DeptForm extends StatefulWidget {
  const _DeptForm({required this.c, this.dept});
  final DepartmentsController c;
  final Department? dept;
  @override
  State<_DeptForm> createState() => _DeptFormState();
}

class _DeptFormState extends State<_DeptForm> {
  late final code = TextEditingController(text: widget.dept?.code);
  late final name = TextEditingController(text: widget.dept?.name);

  void _save() {
    final e = widget.c.save(id: widget.dept?.id, code: code.text, name: name.text);
    if (e != null) return toast(e, error: true);
    toast('Saved!');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => ModalShell(
        title: widget.dept == null ? 'Add Department' : 'Edit Department',
        maxWidth: 420,
        actions: [OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), ElevatedButton(onPressed: _save, child: const Text('Save'))],
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Field(label: 'Code *', child: TextField(controller: code, autofocus: true, decoration: const InputDecoration(hintText: 'e.g. CSE'), onSubmitted: (_) => _save())),
            const SizedBox(height: 12),
            Field(label: 'Name *', child: TextField(controller: name, decoration: const InputDecoration(hintText: 'e.g. Computer Science & Engineering'), onSubmitted: (_) => _save())),
          ]),
        ),
      );
}
