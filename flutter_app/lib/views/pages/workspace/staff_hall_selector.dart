import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/workspace_controller.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/domain/session_rules.dart';
import '../../../models/entities.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';

/// "Select Invigilators & Halls": pops with (userIds, hallIds) to generate the allocation.
class StaffHallSelectorDialog extends StatelessWidget {
  const StaffHallSelectorDialog({super.key, required this.services, required this.session});
  final AppServices services;
  final ExamSession session;
  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(create: (_) => StaffHallSelectorController(services, session), child: const _SelectorView());
}

class _SelectorView extends StatelessWidget {
  const _SelectorView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<StaffHallSelectorController>();
    final groups = c.groups;
    final hasSources = groups.draft != null || groups.batches.isNotEmpty;
    final copied = c.copied;
    final skipped = copied == null ? 0 : copied.inactiveStaff + copied.inactiveHalls;
    final skippedParts = copied == null
        ? <String>[]
        : [if (copied.inactiveStaff > 0) '${copied.inactiveStaff} staff', if (copied.inactiveHalls > 0) '${copied.inactiveHalls} hall${copied.inactiveHalls == 1 ? '' : 's'}'];

    final staffList = ListView(padding: const EdgeInsets.all(16), children: [
      Row(children: [
        Expanded(
          child: Text.rich(TextSpan(children: [
            const TextSpan(text: 'Invigilators ', style: TextStyle(fontWeight: FontWeight.w700)),
            TextSpan(text: '(${c.selUsers.length} selected)', style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
            if (c.query.trim().isNotEmpty) TextSpan(text: ' · showing ${c.visibleUsers.length} of ${c.users.length}', style: const TextStyle(color: AppColors.textSec)),
          ])),
        ),
        if (c.query.trim().isNotEmpty && c.visibleUsers.isNotEmpty) LinkButton(c.visibleUsers.every((u) => c.selUsers.contains(u.id)) ? 'Deselect shown' : 'Select shown', onPressed: () => c.toggleAll(c.visibleUsers)),
        if (c.selUsers.isNotEmpty) ...[const SizedBox(width: 12), LinkButton('Clear', onPressed: c.clearUsers, color: AppColors.error)],
      ]),
      const SizedBox(height: 8),
      if (c.visibleUsers.isEmpty) Padding(padding: const EdgeInsets.all(30), child: Center(child: Text('No staff match "${c.query}".', style: cellSec))),
      for (final e in c.byDept.entries) ...[
        Padding(
          padding: const EdgeInsets.only(top: 10, bottom: 2),
          child: Row(children: [
            Expanded(child: Text(e.key.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSec, letterSpacing: 0.5))),
            LinkButton(e.value.every((u) => c.selUsers.contains(u.id)) ? 'Deselect all' : 'Select all', onPressed: () => c.toggleAll(e.value)),
          ]),
        ),
        for (final u in e.value)
          CheckboxListTile(
            dense: true,
            value: c.selUsers.contains(u.id),
            onChanged: (_) => c.toggleUser(u.id),
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(u.name, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('${u.staffId} · ${u.designation ?? '—'}'),
          ),
      ],
    ]);

    final hallList = ListView(padding: const EdgeInsets.all(16), children: [
      SearchField(hint: 'Search halls by code or block', onChanged: c.setHallQuery),
      const SizedBox(height: 10),
      Text.rich(TextSpan(children: [
        const TextSpan(text: 'Halls ', style: TextStyle(fontWeight: FontWeight.w700)),
        TextSpan(text: '(${c.selHalls.length} selected)', style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w700)),
        if (c.hallQuery.trim().isNotEmpty) TextSpan(text: ' · showing ${c.visibleHalls.length} of ${c.halls.length}', style: const TextStyle(color: AppColors.textSec)),
      ])),
      const SizedBox(height: 6),
      Wrap(spacing: 12, children: [
        LinkButton('Select all halls', onPressed: c.selectAllHalls),
        if (c.hallQuery.trim().isNotEmpty && c.visibleHalls.isNotEmpty) LinkButton(c.visibleHalls.every((h) => c.selHalls.contains(h.id)) ? 'Deselect shown' : 'Select shown', onPressed: c.toggleShownHalls),
        if (c.selHalls.isNotEmpty) LinkButton('Clear', onPressed: c.clearHalls, color: AppColors.error),
      ]),
      const SizedBox(height: 6),
      if (c.visibleHalls.isEmpty) Padding(padding: const EdgeInsets.all(30), child: Center(child: Text('No halls match "${c.hallQuery}".', style: cellSec))),
      for (final h in c.visibleHalls)
        CheckboxListTile(
          dense: true,
          value: c.selHalls.contains(h.id),
          onChanged: (_) => c.toggleHall(h.id),
          controlAffinity: ListTileControlAffinity.leading,
          title: Text(h.hallCode, style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
          subtitle: hallLocation(h.block, h.floor).isEmpty ? null : Text(hallLocation(h.block, h.floor), overflow: TextOverflow.ellipsis),
        ),
    ]);

    return ModalShell(
      title: 'Select Invigilators & Halls',
      maxWidth: 1000,
      fullHeight: true,
      footerLeading: c.selUsers.isNotEmpty && c.selUsers.length != c.selHalls.length
          ? Text('⚠ Select ${c.selUsers.length} halls to match ${c.selUsers.length} staff (now ${c.selHalls.length})', style: const TextStyle(color: AppColors.amber600))
          : null,
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        ElevatedButton(onPressed: c.canSubmit ? () => Navigator.pop(context, (List<int>.of(c.selUsers), List<int>.of(c.selHalls))) : null, child: const Text('Generate Allocation')),
      ],
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 12, 22, 8),
          child: Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            SizedBox(width: 300, child: SearchField(hint: 'Search staff by name or Staff ID', autofocus: true, onChanged: c.setQuery)),
            PrimaryButton(label: 'Upload Excel', icon: Icons.upload, onPressed: () async => showOutcome(await c.uploadDutyList())),
            Tooltip(
              message: 'An Excel sheet of all active staff: delete the rows not on duty (optionally fill in Hall), save, then upload it',
              child: SecondaryButton(label: 'Download template', icon: Icons.table_view, onPressed: () async {
                final p = await c.downloadTemplate();
                if (p != null) toast('Template saved to $p');
              }),
            ),
            Tooltip(
              message: c.previous != null ? 'Tick the same staff and halls as ${c.sourceLabel(c.previous!)}' : 'No earlier session has a selection to copy',
              child: SecondaryButton(label: 'Copy previous session', icon: Icons.copy, onPressed: c.previous == null ? null : () => showOutcome(c.copyFrom(c.previous!))),
            ),
            if (hasSources)
              PopupMenuButton<SelectionSource>(
                tooltip: 'Tick the same staff and halls as a particular session',
                onSelected: (s) => showOutcome(c.copyFrom(s)),
                itemBuilder: (_) => [
                  if (groups.draft != null) ...[
                    const PopupMenuItem(enabled: false, child: Text('This session', style: TextStyle(fontWeight: FontWeight.bold))),
                    PopupMenuItem(value: groups.draft!, child: const Text('This session (current draft)')),
                  ],
                  for (final b in groups.batches) ...[
                    PopupMenuItem(enabled: false, child: Text(b.cycleId == c.session.cycleId ? '${b.cycleName} (this batch)' : b.cycleName, style: const TextStyle(fontWeight: FontWeight.bold))),
                    for (final s in b.sessions) PopupMenuItem(value: s, child: Text('${formatDateWithDay(s.examDate)} · ${s.sessionType} (${s.staffCount} staff, ${s.staffCount} halls)')),
                  ],
                ],
                child: const IgnorePointer(child: SecondaryButton(label: 'Copy from a session…', icon: Icons.arrow_drop_down, onPressed: null)),
              ),
          ]),
        ),
        if (copied != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22),
            child: MessageBanner(
              kind: skipped > 0 ? BannerKind.warning : BannerKind.success,
              lines: [
                'Copied from ${copied.label}: ${copied.staff} staff and ${copied.halls} halls ticked. Generate Allocation draws their halls afresh.',
                if (skipped > 0) '${skippedParts.join(' and ')} from that session ${skipped == 1 ? 'is' : 'are'} no longer active and ${skipped == 1 ? 'was' : 'were'} not copied.',
              ],
              trailing: IconButton(onPressed: c.dismissCopied, icon: const Icon(Icons.close, size: 16)),
            ),
          ),
        if (c.upload != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 22),
            child: MessageBanner(
              kind: c.uploadIssues.isNotEmpty ? BannerKind.warning : BannerKind.success,
              title: '${c.upload!.file}: ${c.upload!.result.userIds.length} invigilator(s) selected by ${c.upload!.result.matchedBy}'
                  '${c.upload!.result.hasHallColumn ? ', ${c.upload!.result.hallIds.length} hall(s)' : ''}'
                  '${c.uploadIssues.isNotEmpty ? '; ${c.uploadIssues.length} row(s) need attention' : ''}',
              lines: [for (final m in c.uploadIssues.take(12)) '• $m', if (c.uploadIssues.length > 12) '… and ${c.uploadIssues.length - 12} more'],
              trailing: IconButton(onPressed: c.dismissUpload, icon: const Icon(Icons.close, size: 16)),
            ),
          ),
        const Divider(),
        Expanded(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Expanded(child: staffList),
            Container(width: 1, color: AppColors.border),
            SizedBox(width: 320, child: hallList),
          ]),
        ),
      ]),
    );
  }
}
