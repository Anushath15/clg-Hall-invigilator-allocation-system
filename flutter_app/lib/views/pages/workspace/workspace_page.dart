import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/workspace_controller.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/entities.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';
import 'matrix_view.dart';
import 'seating_panel.dart';
import 'session_dialogs.dart';
import 'staff_hall_selector.dart';

class WorkspacePage extends StatelessWidget {
  const WorkspacePage({super.key, required this.cycleId, this.sessionId});
  final int cycleId;
  final int? sessionId;
  @override
  Widget build(BuildContext context) =>
      ChangeNotifierProvider(create: (c) => WorkspaceController(c.read<AppServices>(), cycleId, sessionId: sessionId), child: const _WorkspaceView());
}

class _WorkspaceView extends StatelessWidget {
  const _WorkspaceView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<WorkspaceController>();
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(32, 16, 32, 32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(c.cycle?.name ?? 'Loading...', style: const TextStyle(fontSize: 25, fontWeight: FontWeight.bold)),
              Text('${c.cycle?.academicYear ?? ''} · Allocation Workspace', style: cellSec),
            ]),
          ),
          SegmentedButton<WorkspaceView>(
            segments: const [
              ButtonSegment(value: WorkspaceView.table, icon: Icon(Icons.list), tooltip: 'Sessions'),
              ButtonSegment(value: WorkspaceView.matrix, icon: Icon(Icons.grid_view), tooltip: 'Full allocation matrix'),
            ],
            selected: {c.view},
            onSelectionChanged: (s) => c.setView(s.first),
            showSelectedIcon: false,
          ),
        ]),
        const SizedBox(height: 20),
        if (c.view == WorkspaceView.matrix)
          AppCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Full Allocation Matrix — All Sessions', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 14),
            AllocationMatrix(data: c.timetable()),
          ]))
        else ...[
          _SessionTabs(c: c),
          if (c.active != null) ...[
            if (c.isDuplicate(c.active!)) _duplicateBanner(context, c),
            _SessionBar(c: c),
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Align(
                alignment: Alignment.centerLeft,
                child: SegmentedButton<WorkspacePanel>(
                  segments: const [
                    ButtonSegment(value: WorkspacePanel.invigilators, icon: Icon(Icons.how_to_reg_outlined), label: Text('Invigilators')),
                    ButtonSegment(value: WorkspacePanel.seating, icon: Icon(Icons.event_seat_outlined), label: Text('Student Seating')),
                  ],
                  selected: {c.panel},
                  onSelectionChanged: (s) => c.setPanel(s.first),
                  showSelectedIcon: false,
                ),
              ),
            ),
            if (c.panel == WorkspacePanel.seating)
              SeatingPanel(key: ValueKey('seat-${c.active!.id}-${c.allocation.length}-${c.allocation.map((a) => a.hallId).join(',')}'))
            else
              _InvigilatorPanel(c: c),
          ],
        ],
      ]),
    );
  }

  Widget _duplicateBanner(BuildContext context, WorkspaceController c) => MessageBanner(
        kind: BannerKind.error,
        title: 'Duplicate Session Error Detected',
        lines: [
          'Multiple sessions are scheduled for ${formatDate(c.active!.examDate)} (${c.active!.sessionType}) in this cycle. Each exam date can only have at most one Forenoon (FN) and one Afternoon (AN) session.'
        ],
        trailing: Wrap(spacing: 8, children: [
          SecondaryButton(label: 'Reschedule Date/Slot', icon: Icons.edit_outlined, onPressed: () => showSessionDialog(context, c, session: c.active)),
          if (c.active!.status == 'pending')
            PrimaryButton(
              label: 'Remove Duplicate',
              icon: Icons.delete_outline,
              color: AppColors.red600,
              onPressed: () async {
                if (await confirmDialog(context, 'Are you sure you want to remove this duplicate session?', danger: true, confirmLabel: 'Remove')) showOutcome(c.deleteSession(c.active!.id));
              },
            ),
        ]),
      );
}

class _SessionTabs extends StatelessWidget {
  const _SessionTabs({required this.c});
  final WorkspaceController c;
  @override
  Widget build(BuildContext context) {
    Color dot(String s) => switch (s) { 'draft' => const Color(0xFFFACC15), 'confirmed' => const Color(0xFF60A5FA), 'published' => const Color(0xFF4ADE80), _ => AppColors.gray300 };
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final s in c.sessions)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Builder(builder: (_) {
                final on = c.active?.id == s.id, dupe = c.isDuplicate(s);
                final color = dupe ? AppColors.red600 : AppColors.primary;
                return InkWell(
                  onTap: () => c.selectSession(s),
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      color: on ? color : (dupe ? AppColors.red50 : Colors.white),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: on ? color : (dupe ? const Color(0xFFFCA5A5) : AppColors.border)),
                    ),
                    child: Row(children: [
                      Text('${formatDate(s.examDate)} ${s.sessionType}', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: on ? Colors.white : (dupe ? AppColors.red700 : AppColors.textSec))),
                      if (dupe) ...[const SizedBox(width: 6), const Pill('DUPLICATE', bg: Color(0xFFFEE2E2), fg: AppColors.red700, bold: true)],
                      const SizedBox(width: 8),
                      Container(width: 8, height: 8, decoration: BoxDecoration(color: dot(s.status), shape: BoxShape.circle)),
                    ]),
                  ),
                );
              }),
            ),
          OutlinedButton.icon(
            onPressed: () => showSessionDialog(context, c),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Add Session'),
            style: OutlinedButton.styleFrom(foregroundColor: AppColors.primary, side: const BorderSide(color: AppColors.primary)),
          ),
        ]),
      ),
    );
  }
}

class _SessionBar extends StatelessWidget {
  const _SessionBar({required this.c});
  final WorkspaceController c;

  @override
  Widget build(BuildContext context) {
    final s = c.active!;
    final status = c.effectiveStatus;
    Widget info(String k, String v) => Text.rich(TextSpan(children: [TextSpan(text: '$k: ', style: const TextStyle(color: AppColors.textSec)), TextSpan(text: v, style: const TextStyle(fontWeight: FontWeight.w600))]));

    Future<void> openSelector() async {
      final r = await showDialog<(List<int>, List<int>)>(context: context, builder: (_) => StaffHallSelectorDialog(services: c.services, session: s));
      if (r != null) showOutcome(c.generate(r.$1, r.$2));
    }

    Future<void> deleteDraft() async {
      if (!await confirmDialog(context, 'Are you sure you want to delete this draft session? This will remove its draft allocations.', danger: true, confirmLabel: 'Delete')) return;
      showOutcome(c.deleteSession(s.id));
    }

    final actions = c.panel != WorkspacePanel.invigilators
        ? const SizedBox.shrink()
        : switch (status) {
            'pending' => PrimaryButton(label: 'Select Staff & Generate', icon: Icons.bolt, loading: c.loading, onPressed: openSelector),
            'draft' => Wrap(spacing: 8, runSpacing: 8, children: [
                SecondaryButton(label: 'Delete Draft', icon: Icons.delete_outline, danger: true, onPressed: c.loading ? null : deleteDraft),
                SecondaryButton(label: 'Regenerate', icon: Icons.refresh, onPressed: c.loading ? null : openSelector),
                PrimaryButton(label: 'Confirm Allocation', icon: Icons.check_circle_outline, loading: c.loading, onPressed: () => showOutcome(c.confirm())),
              ]),
            'confirmed' => PrimaryButton(label: 'Export PDF', icon: Icons.download, onPressed: () async => showOutcome(await c.exportPdf())),
            _ => const Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.check_circle_outline, color: AppColors.green600), SizedBox(width: 6), Text('Published', style: TextStyle(color: AppColors.green600, fontWeight: FontWeight.w600))]),
          };

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 10, spacing: 16, children: [
          Wrap(spacing: 22, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            info('Date', formatDateWithDay(s.examDate)),
            info('Session', '${formatSession(s.sessionType)} (${s.sessionType})'),
            info('Report', formatTime12h(s.reportingTime)),
            info('Exam', '${formatTime12h(s.examStart)} – ${formatTime12h(s.examEnd)}'),
            StatusBadge(status),
            OutlinedButton.icon(
              onPressed: () => showSessionDialog(context, c, session: s),
              icon: const Icon(Icons.edit_outlined, size: 16, color: AppColors.primary),
              label: const Text('Edit Schedule & Timings', style: TextStyle(fontSize: 13)),
              style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
            ),
          ]),
          actions,
        ]),
      ),
    );
  }
}

class _InvigilatorPanel extends StatelessWidget {
  const _InvigilatorPanel({required this.c});
  final WorkspaceController c;

  @override
  Widget build(BuildContext context) {
    final v = c.validation;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (v != null && !v.isValid)
        Container(
          margin: const EdgeInsets.only(bottom: 14),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: AppColors.red50, border: Border.all(color: AppColors.red200), borderRadius: BorderRadius.circular(12)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.red700), const SizedBox(width: 8), Text('${v.blockingErrors.length} Validation Error(s)', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.red700))]),
            const SizedBox(height: 6),
            for (final e in v.blockingErrors)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 8, children: [
                  Text.rich(TextSpan(children: [
                    const TextSpan(text: '• '),
                    TextSpan(text: '[${e.rule}] ', style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.red600)),
                    TextSpan(text: e.message),
                  ]), style: const TextStyle(color: AppColors.red600, fontSize: 14)),
                  if (e.rule == 'R4' && c.firstUnconfirmedEarlier != null)
                    TextButton(onPressed: () => c.selectSession(c.firstUnconfirmedEarlier!), child: const Text('→ Go to unconfirmed session', style: TextStyle(color: AppColors.red700, fontWeight: FontWeight.bold))),
                ]),
              ),
          ]),
        ),
      if (v != null && v.isValid && v.warnings.isEmpty) const MessageBanner(kind: BannerKind.success, lines: ['All 7 validation rules passed successfully.']),
      if (v != null && v.warnings.isNotEmpty) MessageBanner(kind: BannerKind.warning, title: '${v.warnings.length} Unavoidable Repeat(s): allowed, but please review', lines: [for (final w in v.warnings) '• $w']),
      if (c.allocation.isEmpty)
        const EmptyState(icon: Icons.bolt, title: 'No allocation for this session yet', subtitle: 'Click "Select Staff & Generate" to begin.')
      else
        DataTableCard(
          columns: const ['#', 'Staff ID', 'Name', 'Department', 'Assigned Hall', 'Type', ''],
          flex: const [0.4, 1, 2, 1, 1.6, 1.2, 0.5],
          rowColor: (i) => c.allocation[i].isManuallyEdited ? AppColors.amber50 : null,
          footer: Text('${c.allocation.length} invigilators · ${c.allocation.where((a) => a.isManuallyEdited).length} admin-edited', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
          rows: [
            for (var i = 0; i < c.allocation.length; i++)
              [
                Text('${i + 1}', style: cellSec),
                Text(c.allocation[i].staffId, style: monoSmall),
                Text(c.allocation[i].userName, style: const TextStyle(fontWeight: FontWeight.w600)),
                Text(c.allocation[i].deptCode ?? '—', style: cellSec),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: c.allocation[i].isManuallyEdited ? AppColors.amber100 : AppColors.veryLight, borderRadius: BorderRadius.circular(8)),
                    child: Text('${c.allocation[i].hallCode}${c.allocation[i].isManuallyEdited ? ' (edited)' : ''}',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: c.allocation[i].isManuallyEdited ? AppColors.amber700 : AppColors.primary)),
                  ),
                ),
                Text(c.allocation[i].isManuallyEdited ? 'Admin Edited' : 'Auto-generated',
                    style: TextStyle(fontSize: 13, color: c.allocation[i].isManuallyEdited ? AppColors.amber600 : AppColors.green600, fontWeight: FontWeight.w500)),
                c.active!.status == 'published'
                    ? const SizedBox.shrink()
                    : Align(
                        alignment: Alignment.centerRight,
                        child: IconButton(
                          onPressed: () => showDialog(context: context, builder: (_) => _EditHallDialog(c: c, entry: c.allocation[i])),
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          tooltip: 'Edit hall assignment',
                        ),
                      ),
              ]
          ],
        ),
    ]);
  }
}

/// Edit = swap: pick another hall of the session; its invigilator moves to this person's hall.
class _EditHallDialog extends StatelessWidget {
  const _EditHallDialog({required this.c, required this.entry});
  final WorkspaceController c;
  final AllocationRow entry;

  @override
  Widget build(BuildContext context) {
    final valid = c.validHallsFor(entry);
    final history = c.dutyHistory(entry.userId);
    final picker = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text.rich(TextSpan(children: [TextSpan(text: entry.userName, style: const TextStyle(fontWeight: FontWeight.w600)), TextSpan(text: '  (${entry.staffId})', style: const TextStyle(color: AppColors.textSec))])),
          Text.rich(TextSpan(children: [const TextSpan(text: 'Current hall: ', style: TextStyle(color: AppColors.textSec)), TextSpan(text: entry.hallCode, style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary))])),
        ]),
      ),
      const SizedBox(height: 14),
      const Text('SWAP WITH:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSec, letterSpacing: 0.5)),
      Text('The invigilator of the hall you choose moves to ${entry.hallCode}. Both must be allowed their new hall (R1).', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
      const SizedBox(height: 10),
      Wrap(spacing: 8, runSpacing: 8, children: [
        for (final vh in valid)
          Builder(builder: (context) {
            final hall = c.hallsById[vh.hallId];
            final loc = hall == null ? '' : hallLocation(hall.block, hall.floor);
            final tile = InkWell(
              onTap: vh.isValid
                  ? () {
                      final o = c.applyEdit(entry, vh.hallId);
                      showOutcome(o);
                      if (!o.error) Navigator.pop(context);
                    }
                  : null,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                width: 112,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: vh.isValid ? Colors.white : AppColors.red50,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: vh.isValid ? AppColors.border : const Color(0xFFFEE2E2)),
                ),
                child: Column(children: [
                  Text(hall?.hallCode ?? 'H${vh.hallId}',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: vh.isValid ? AppColors.primary : const Color(0xFFFCA5A5), decoration: vh.isValid ? null : TextDecoration.lineThrough)),
                  if (loc.isNotEmpty) Text(loc, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: AppColors.textSec)),
                  if (vh.isValid && vh.swapWithUserId != null) Text('↔ ${c.staffName(vh.swapWithUserId) ?? ''}', overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: AppColors.textSec)),
                  if (!vh.isValid)
                    Text(
                        vh.reason == 'Current hall'
                            ? 'Current'
                            : (vh.reason?.startsWith('Swap blocked') ?? false)
                                ? 'Swap blocked'
                                : (vh.reason?.contains('cycle') ?? false)
                                    ? 'In cycle'
                                    : 'Occupied',
                        style: const TextStyle(fontSize: 11, color: Color(0xFFF87171))),
                ]),
              ),
            );
            return vh.isValid ? tile : Tooltip(message: vh.reason ?? '', child: tile);
          }),
      ]),
    ]);
    final timeline = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (history.isEmpty)
        const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Center(child: Text('No history yet', style: TextStyle(fontSize: 13, color: AppColors.textSec))))
      else ...[
        Text('${entry.userName.toUpperCase()} — LAST ${history.length} ASSIGNMENTS', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.textSec)),
        const SizedBox(height: 8),
        for (final h in history)
          Container(
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: AppColors.gray50, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              Expanded(child: Text('${formatDate(h.examDate)} ${h.sessionType}', style: const TextStyle(fontSize: 12.5, color: AppColors.textSec))),
              Pill(h.hallCode, bg: AppColors.veryLight, fg: AppColors.primary, bold: true),
            ]),
          ),
      ],
    ]);
    return ModalShell(
      title: 'Edit Hall Assignment',
      maxWidth: 760,
      child: LayoutBuilder(
        builder: (_, box) => box.maxWidth < 640
            ? SingleChildScrollView(padding: const EdgeInsets.all(20), child: Column(children: [picker, const Divider(height: 32), timeline]))
            : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: picker)),
                Container(width: 1, color: AppColors.border),
                SizedBox(width: 250, child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: timeline)),
              ]),
      ),
    );
  }
}
