import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/master_controllers.dart';
import '../../../core/theme.dart';
import '../../../models/domain/validation.dart';
import '../../../models/entities.dart';
import '../../widgets/common.dart';
import 'master_page.dart';

class StaffTab extends StatelessWidget {
  const StaffTab({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<StaffController>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      TabToolbar(text: '${c.staff.length} staff members', actions: [
        SecondaryButton(
          label: 'Import Excel',
          icon: Icons.upload,
          onPressed: () async {
            final r = await c.importExcel();
            if (r == null || !context.mounted) return;
            showImportResult(context,
                success: r.success,
                error: r.error,
                inserted: r.inserted,
                issues: r.issues,
                what: '${r.inserted} staff member${r.inserted == 1 ? '' : 's'} imported successfully.',
                missingNote: r.missingColumns.isEmpty ? null : 'Your Excel file\'s first row needs a column for each of: Staff ID, Name, and Department. Missing here: ${r.missingColumns.join(', ')}.');
          },
        ),
        PrimaryButton(label: 'Add Staff', icon: Icons.add, onPressed: () => _edit(context, c, null)),
      ]),
      DataTableCard(
        columns: const ['Staff ID', 'Name', 'Department', 'Designation', 'Status', ''],
        flex: const [1, 2, 1.6, 1.6, 1, 1.4],
        empty: 'No staff members yet. Add or import from Excel.',
        rows: [
          for (final u in c.staff)
            [
              Text(u.staffId, style: monoSmall),
              Text(u.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(u.departmentName ?? '—', style: cellSec),
              Text(u.designation ?? '—', style: cellSec),
              ActiveStatus(u.isActive),
              RowActions(
                onEdit: () => _edit(context, c, u),
                onDelete: u.isActive
                    ? () async {
                        if (await confirmDialog(context, 'Deactivate this staff member?', confirmLabel: 'Deactivate')) {
                          c.deactivate(u.id);
                          toast('Deactivated');
                        }
                      }
                    : null,
                extra: [
                  if (!u.isActive)
                    TextButton.icon(
                      onPressed: () => _hardDelete(context, c, u),
                      icon: const Icon(Icons.delete_forever_outlined, size: 16, color: AppColors.red600),
                      label: const Text('Delete Permanently', style: TextStyle(color: AppColors.red600, fontSize: 13)),
                    ),
                ],
              ),
            ]
        ],
      ),
    ]);
  }

  Future<void> _hardDelete(BuildContext context, StaffController c, Staff u) async {
    final ok = await showDialog<bool>(context: context, builder: (_) => TypeToConfirmDialog(
      title: 'Delete Staff Member Permanently',
      message: 'Are you sure you want to permanently delete ${u.name} (${u.staffId})? This cannot be undone.',
      word: 'DELETE',
      confirmLabel: 'Delete Permanently',
    ));
    if (ok != true) return;
    final e = c.hardDelete(u.id);
    toast(e ?? 'Staff member deleted permanently', error: e != null);
  }

  void _edit(BuildContext context, StaffController c, Staff? u) => showDialog(context: context, builder: (_) => _StaffForm(c: c, staff: u));
}

class _StaffForm extends StatefulWidget {
  const _StaffForm({required this.c, this.staff});
  final StaffController c;
  final Staff? staff;
  @override
  State<_StaffForm> createState() => _StaffFormState();
}

class _StaffFormState extends State<_StaffForm> {
  late final id = TextEditingController(text: widget.staff?.staffId);
  late final name = TextEditingController(text: widget.staff?.name);
  late final desig = TextEditingController(text: widget.staff?.designation);
  late final email = TextEditingController(text: widget.staff?.email);
  late int? dept = widget.staff?.departmentId;
  late bool active = widget.staff?.isActive ?? true;

  void _save() {
    final problem = validateStaff(staffId: id.text, name: name.text, designation: desig.text, email: email.text);
    if (problem != null) return toast(problem, error: true);
    final e = widget.c.save(id: widget.staff?.id, staffId: id.text, name: name.text, designation: desig.text, email: email.text, departmentId: dept, isActive: active);
    if (e != null) return toast(e, error: true);
    toast('Saved!');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => ModalShell(
        title: widget.staff == null ? 'Add Staff' : 'Edit Staff',
        maxWidth: 460,
        actions: [OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')), ElevatedButton(onPressed: _save, child: const Text('Save'))],
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Field(label: 'Staff ID *', child: TextField(controller: id, autofocus: true, onSubmitted: (_) => _save())),
            const SizedBox(height: 12),
            Field(label: 'Full Name *', child: TextField(controller: name, onSubmitted: (_) => _save())),
            const SizedBox(height: 12),
            Field(label: 'Designation', child: TextField(controller: desig)),
            const SizedBox(height: 12),
            Field(label: 'Email', child: TextField(controller: email, keyboardType: TextInputType.emailAddress)),
            const SizedBox(height: 12),
            Field(label: 'Department', child: Select<int>(value: dept, items: [for (final d in widget.c.departments) (d.id, '${d.name} (${d.code})')], onChanged: (v) => setState(() => dept = v))),
            CheckboxListTile(value: active, onChanged: (v) => setState(() => active = v ?? true), title: const Text('Active'), contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading),
          ]),
        ),
      );
}

/// A destructive action confirmed by typing a word (the offline app has no passwords).
class TypeToConfirmDialog extends StatefulWidget {
  const TypeToConfirmDialog({super.key, required this.title, required this.message, required this.word, this.confirmLabel = 'Confirm'});
  final String title, message, word, confirmLabel;
  @override
  State<TypeToConfirmDialog> createState() => _TypeToConfirmDialogState();
}

class _TypeToConfirmDialogState extends State<TypeToConfirmDialog> {
  final text = TextEditingController();
  String? error;
  @override
  Widget build(BuildContext context) => ModalShell(
        title: widget.title,
        leadingIcon: Icons.lock_outline,
        iconColor: AppColors.amber600,
        maxWidth: 460,
        actions: [
          OutlinedButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.red600),
            onPressed: () {
              if (text.text.trim().toUpperCase() != widget.word) return setState(() => error = 'Please type ${widget.word} to confirm.');
              Navigator.pop(context, true);
            },
            child: Text(widget.confirmLabel),
          ),
        ],
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.message, style: cellSec),
            const SizedBox(height: 14),
            Field(label: 'Type ${widget.word} to confirm *', child: TextField(controller: text, autofocus: true, decoration: InputDecoration(hintText: widget.word))),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: MessageBanner(kind: BannerKind.error, lines: [error!])),
          ]),
        ),
      );
}
