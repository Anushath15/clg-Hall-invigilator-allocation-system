import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/app_controllers.dart';
import '../../controllers/report_controllers.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/domain/validation.dart';
import '../../models/entities.dart';
import '../../services/app_services.dart';
import '../widgets/common.dart';

const _sections = ['College Profile', 'Session Timings', 'Backup & Restore', 'Restart Rotation', 'Delete Batch'];
const _danger = ['Restart Rotation', 'Delete Batch'];

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  String active = _sections.first;

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (c) => SettingsPageController(c.read<AppServices>()),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const PageHeader(title: 'Settings', subtitle: 'Configure college profile, session defaults, and system options'),
            LayoutBuilder(builder: (_, box) {
              final menu = Wrap(direction: box.maxWidth >= 1000 ? Axis.vertical : Axis.horizontal, spacing: 4, runSpacing: 4, children: [
                for (final s in _sections)
                  SizedBox(
                    width: box.maxWidth >= 1000 ? 200 : null,
                    child: TextButton(
                      onPressed: () => setState(() => active = s),
                      style: TextButton.styleFrom(
                        alignment: Alignment.centerLeft,
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                        backgroundColor: active == s ? (_danger.contains(s) ? AppColors.red600 : AppColors.primary) : null,
                        foregroundColor: active == s ? Colors.white : (_danger.contains(s) ? AppColors.red600 : AppColors.textSec),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: Text(s, style: const TextStyle(fontWeight: FontWeight.w600)),
                    ),
                  ),
              ]);
              final content = ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: switch (active) {
                  'College Profile' => const _ProfileSection(),
                  'Session Timings' => const _TimingsSection(),
                  'Backup & Restore' => const _BackupSection(),
                  'Restart Rotation' => const _RestartSection(),
                  _ => const _DeleteBatchSection(),
                },
              );
              return box.maxWidth >= 1000
                  ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: [menu, const SizedBox(width: 24), Expanded(child: Align(alignment: Alignment.topLeft, child: content))])
                  : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [menu, const SizedBox(height: 16), content]);
            }),
          ]),
        ),
      );
}

class _ProfileSection extends StatefulWidget {
  const _ProfileSection();
  @override
  State<_ProfileSection> createState() => _ProfileSectionState();
}

class _ProfileSectionState extends State<_ProfileSection> {
  late final s = context.read<SettingsController>();
  late final name = TextEditingController(text: s.collegeName);
  late final short = TextEditingController(text: s.shortName);

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('College Profile', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(height: 18),
          Field(label: 'College Full Name', child: TextField(controller: name)),
          const Padding(padding: EdgeInsets.only(top: 4), child: Text('Appears on all report letterheads and print headers', style: TextStyle(fontSize: 13, color: AppColors.textSec))),
          const SizedBox(height: 14),
          SizedBox(width: 200, child: Field(label: 'Short Name / Abbreviation', child: TextField(controller: short))),
          const SizedBox(height: 14),
          SizedBox(width: 200, child: Field(label: 'App Version', child: TextField(enabled: false, controller: TextEditingController(text: s.get('app.version'))))),
          const SizedBox(height: 18),
          PrimaryButton(label: 'Save Profile', icon: Icons.save_outlined, onPressed: () {
            final p = validateCollegeName(name.text) ?? validateCollegeShortName(short.text);
            if (p != null) return toast(p, error: true);
            final e = s.saveAll({'college.name': name.text, 'college.short_name': short.text});
            toast(e ?? 'Settings saved!', error: e != null);
          }),
        ]),
      );
}

class _TimingsSection extends StatefulWidget {
  const _TimingsSection();
  @override
  State<_TimingsSection> createState() => _TimingsSectionState();
}

class _TimingsSectionState extends State<_TimingsSection> {
  late final s = context.read<SettingsController>();
  late final Map<String, String> v = {
    for (final p in ['fn', 'an'])
      for (final k in ['reporting', 'start', 'end']) 'session.${p}_${k}_time': s.get('session.${p}_${k}_time'),
  };

  @override
  Widget build(BuildContext context) => AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Session Timings', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          const Text('Default times used when creating exam sessions. Override per-session in the exam wizard.', style: TextStyle(color: AppColors.textSec)),
          for (final p in const [('fn', 'Forenoon (FN) Session'), ('an', 'Afternoon (AN) Session')]) ...[
            const SizedBox(height: 18),
            Text(p.$2, style: const TextStyle(fontWeight: FontWeight.w700)),
            const Divider(height: 16),
            Row(children: [
              for (final k in const [('reporting', 'Reporting Time'), ('start', 'Exam Start'), ('end', 'Exam End')]) ...[
                Expanded(child: TimeField(label: k.$2, value: v['session.${p.$1}_${k.$1}_time']!, onChanged: (x) => setState(() => v['session.${p.$1}_${k.$1}_time'] = x))),
                if (k.$1 != 'end') const SizedBox(width: 12),
              ]
            ]),
          ],
          const SizedBox(height: 18),
          PrimaryButton(label: 'Save Timings', icon: Icons.save_outlined, onPressed: () {
            for (final p in ['fn', 'an']) {
              final e = validateSessionTimes(v['session.${p}_reporting_time'], v['session.${p}_start_time'], v['session.${p}_end_time']);
              if (e != null) return toast(e, error: true);
            }
            final e = s.saveAll(v);
            toast(e ?? 'Settings saved!', error: e != null);
          }),
        ]),
      );
}

class _BackupSection extends StatelessWidget {
  const _BackupSection();
  @override
  Widget build(BuildContext context) {
    final c = context.watch<SettingsPageController>();
    Widget block(IconData icon, Color bg, Color fg, String title, String text, Widget button, {Widget? note}) => Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: AppCard(
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Container(width: 40, height: 40, decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: fg)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(text, style: cellSec),
                  if (note != null) Padding(padding: const EdgeInsets.only(top: 8), child: note),
                  const SizedBox(height: 12),
                  button,
                ]),
              ),
            ]),
          ),
        );
    return Column(children: [
      block(Icons.download, AppColors.blue50, AppColors.blue600, 'Backup Database',
          'Save a copy of the entire HIAS database (all staff, halls, cycles, allocations, history) to a file. Store it safely on an external drive or network location.',
          PrimaryButton(label: 'Create Backup', icon: Icons.download, onPressed: () async => showOutcome(await c.backup()))),
      block(Icons.upload, AppColors.amber50, AppColors.amber600, 'Restore Database',
          'Replace the current database with a previously backed-up copy. A safety copy of the current database is saved before restoring.',
          PrimaryButton(
            label: 'Restore from Backup',
            icon: Icons.upload,
            color: AppColors.warning,
            onPressed: () async {
              if (!await confirmDialog(context, 'Restore will replace all current data with the backup. A safety copy will be saved. Continue?', confirmLabel: 'Continue')) return;
              final o = await c.restore();
              showOutcome(o);
              if (o != null && !o.error && context.mounted) {
                context.read<SettingsController>().reload();
                context.read<DataVersion>().bump();
              }
            },
          ),
          note: const MessageBanner(kind: BannerKind.warning, lines: ['This will overwrite all current data. The restored data is loaded at once.'])),
      AppCard(color: AppColors.gray50, child: Row(children: [
        const Icon(Icons.info_outline, size: 18, color: AppColors.blue600),
        const SizedBox(width: 10),
        Expanded(child: SelectableText('The database file is stored at ${c.dbPath} on this machine. Back up regularly before major allocation batches.', style: cellSec)),
      ])),
    ]);
  }
}

class _RestartSection extends StatelessWidget {
  const _RestartSection();
  @override
  Widget build(BuildContext context) {
    final c = context.read<SettingsPageController>();
    return AppCard(
      color: const Color(0xFFFEF7F7),
      borderColor: AppColors.red200,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('Restart Rotation', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Color(0xFF7F1D1D))),
        const SizedBox(height: 6),
        const Text('Permanently clear the entire rotation history across all sessions. Every staff member starts a fresh rotation cycle with all halls open to them again.', style: TextStyle(color: AppColors.red700)),
        const SizedBox(height: 10),
        const MessageBanner(kind: BannerKind.error, lines: ['Warning: This action cannot be reversed. You will be prompted to type RESTART before rotation history is cleared.']),
        PrimaryButton(
          label: 'Restart Rotation',
          icon: Icons.restart_alt,
          color: AppColors.red600,
          onPressed: () async {
            final ok = await showDialog<bool>(context: context, builder: (_) => const _TypeWord(word: 'RESTART', title: 'Restart Rotation',
                message: 'This will wipe the entire rotation history for all staff members. Every staff member starts a fresh rotation cycle with all halls open to them again.'));
            if (ok == true) showOutcome(c.restartRotation());
          },
        ),
      ]),
    );
  }
}

class _TypeWord extends StatefulWidget {
  const _TypeWord({required this.word, required this.title, required this.message});
  final String word, title, message;
  @override
  State<_TypeWord> createState() => _TypeWordState();
}

class _TypeWordState extends State<_TypeWord> {
  String text = '';
  @override
  Widget build(BuildContext context) => ModalShell(
        title: widget.title,
        leadingIcon: Icons.warning_amber_rounded,
        iconColor: AppColors.red600,
        maxWidth: 460,
        actions: [
          OutlinedButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          PrimaryButton(label: 'Confirm', color: AppColors.red600, onPressed: text == widget.word ? () => Navigator.pop(context, true) : null),
        ],
        child: Padding(
          padding: const EdgeInsets.all(22),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.message, style: cellSec),
            const SizedBox(height: 12),
            Field(label: 'Type ${widget.word} to confirm', child: TextField(autofocus: true, onChanged: (v) => setState(() => text = v), decoration: InputDecoration(hintText: widget.word))),
          ]),
        ),
      );
}

class _DeleteBatchSection extends StatelessWidget {
  const _DeleteBatchSection();
  @override
  Widget build(BuildContext context) {
    final c = context.watch<SettingsPageController>();
    return AppCard(
      color: const Color(0xFFFEF7F7),
      borderColor: AppColors.red200,
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Delete Batch', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: Color(0xFF7F1D1D))),
        const SizedBox(height: 6),
        const Text('Permanently delete an allocation batch with all its sessions and allocations, including confirmed ones. The rotation history stays, so later allocations still count the duties already done.',
            style: TextStyle(color: AppColors.red700)),
        const SizedBox(height: 10),
        const MessageBanner(kind: BannerKind.error, lines: [
          'Warning: This cannot be undone. You will be asked to type the batch name and enter your name and Staff ID. Only an active person in the Staff list can delete a batch; the name and Staff ID are kept in the record of deleted batches. Back up first if you may need the data again.'
        ]),
        if (c.cycles.isEmpty) const Text('There are no allocation batches.', style: TextStyle(color: AppColors.red700)),
        for (final cy in c.cycles)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFFEE2E2))),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(cy.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text('${cy.academicYear} · Created ${formatDate(cy.createdAt)}', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
                ]),
              ),
              StatusBadge(cy.status),
              const SizedBox(width: 10),
              PrimaryButton(label: 'Delete', icon: Icons.delete_outline, color: AppColors.red600, onPressed: () => showDialog(context: context, builder: (_) => _DeleteBatchDialog(c: c, cycle: cy))),
            ]),
          ),
        const SizedBox(height: 16),
        const Text('Deleted batches', style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF7F1D1D))),
        const SizedBox(height: 6),
        if (c.deleted.isEmpty)
          const Text('No batch has been deleted yet.', style: TextStyle(fontSize: 13, color: AppColors.red700))
        else
          DataTableCard(
            columns: const ['Batch', 'Year', 'Sessions', 'Deleted on', 'Deleted by'],
            minWidth: 640,
            rows: [
              for (final d in c.deleted)
                [
                  Text(d.batchName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                  Text(d.academicYear ?? '', style: const TextStyle(fontSize: 13)),
                  Text('${d.sessionCount} (${d.confirmedSessionCount} confirmed)', style: const TextStyle(fontSize: 13)),
                  Text(DateTime.tryParse(d.deletedAt) == null ? d.deletedAt : formatDateTime(DateTime.parse(d.deletedAt).toLocal()), style: const TextStyle(fontSize: 13)),
                  Text('${d.deletedByName} · ${d.deletedByStaffId}', style: const TextStyle(fontSize: 13)),
                ]
            ],
          ),
      ]),
    );
  }
}

class _DeleteBatchDialog extends StatefulWidget {
  const _DeleteBatchDialog({required this.c, required this.cycle});
  final SettingsPageController c;
  final ExamCycle cycle;
  @override
  State<_DeleteBatchDialog> createState() => _DeleteBatchDialogState();
}

class _DeleteBatchDialogState extends State<_DeleteBatchDialog> {
  final typed = TextEditingController(), person = TextEditingController(), staffId = TextEditingController();
  String? error;

  @override
  Widget build(BuildContext context) {
    final b = widget.cycle;
    return ModalShell(
      title: 'Delete Allocation Batch',
      leadingIcon: Icons.delete_outline,
      iconColor: AppColors.red600,
      maxWidth: 480,
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        PrimaryButton(
          label: 'Delete Batch',
          color: AppColors.red600,
          onPressed: () {
            final e = widget.c.deleteBatch(b, typedBatchName: typed.text, personName: person.text, staffId: staffId.text);
            if (e != null) return setState(() => error = e);
            toast('"${b.name}" deleted');
            Navigator.pop(context);
          },
        ),
      ],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(22),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('You are about to permanently delete "${b.name}" (${b.academicYear}). This removes every session and allocation of this batch, including published ones, and cannot be undone. The rotation history is kept, so later allocations still count the duties already done. A record of the deletion (batch, time and who deleted it) is also kept.',
              style: cellSec),
          const SizedBox(height: 8),
          const Text('Only an active person in the Staff list can delete a batch: the Staff ID and name must match the Staff list exactly.', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
          const SizedBox(height: 14),
          Field(label: 'Type the batch name to confirm *', child: TextField(controller: typed, autofocus: true, decoration: InputDecoration(hintText: b.name))),
          const SizedBox(height: 12),
          Field(label: 'Your name *', child: TextField(controller: person, decoration: const InputDecoration(hintText: 'Name of the person deleting'))),
          const SizedBox(height: 12),
          Field(label: 'Your Staff ID *', child: TextField(controller: staffId, decoration: const InputDecoration(hintText: 'e.g. STF001'))),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: MessageBanner(kind: BannerKind.error, lines: [error!])),
        ]),
      ),
    );
  }
}
