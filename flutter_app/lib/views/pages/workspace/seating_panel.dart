import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/seating_controllers.dart';
import '../../../controllers/workspace_controller.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/entities.dart';
import '../../../services/student_service.dart';
import '../../widgets/common.dart';
import 'seating_config_dialog.dart';
import 'seating_widgets.dart';
import 'student_selector_dialog.dart';

/// Student seating for the active session: students sit in the halls of the invigilator allocation.
class SeatingPanel extends StatelessWidget {
  const SeatingPanel({super.key});
  @override
  Widget build(BuildContext context) {
    final w = context.read<WorkspaceController>();
    return ChangeNotifierProvider(
      create: (_) => SeatingPanelController(w.services, w.cycle, w.active!, w.allocation),
      child: const _SeatingView(),
    );
  }
}

class _SeatingView extends StatelessWidget {
  const _SeatingView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<SeatingPanelController>();
    final w = context.read<WorkspaceController>();
    if (c.allocation.isEmpty) {
      return const EmptyState(icon: Icons.grid_view, title: 'Generate the invigilator allocation first', subtitle: "Students are seated in the same halls as this session's invigilators.");
    }
    final halls = c.sessionHalls;
    final colorOf = classColors(c.colorKeys);
    final noLayout = halls.where((h) => h.benches == 0).toList();
    final found = c.found;

    Future<void> configure({required bool select}) async {
      var ids = c.selectedIds;
      List<int>? subjects;
      if (select) {
        final r = await showDialog<(List<int>, List<int>)>(
          context: context,
          builder: (_) => StudentSelectorDialog(
            services: c.services,
            session: c.session,
            academicYear: c.cycle?.academicYear,
            seats: c.totalSeats,
            initialIds: ids,
            initialSubjectIds: c.saved?.config.sessionSubjects ?? const [],
          ),
        );
        if (r == null) return;
        ids = r.$1;
        subjects = r.$2;
      }
      if (!context.mounted) return;
      while (true) {
        final result = await showDialog<Object?>(
          context: context,
          barrierDismissible: false,
          builder: (_) => SeatingConfigDialog(services: c.services, session: c.session, halls: halls, studentIds: ids, sessionSubjectIds: subjects),
        );
        if (result is ConfirmResult) {
          c.onSaved(result);
          toast('${result.seated} students seated${result.unallocated.isNotEmpty ? ', ${result.unallocated.length} unallocated' : ''}.');
          return;
        }
        // "Change students": back to the selector, then configure again.
        if (result == 'back' && context.mounted) {
          final r = await showDialog<(List<int>, List<int>)>(
            context: context,
            builder: (_) => StudentSelectorDialog(services: c.services, session: c.session, academicYear: c.cycle?.academicYear, seats: c.totalSeats, initialIds: ids, initialSubjectIds: subjects ?? const []),
          );
          if (r == null || !context.mounted) return;
          ids = r.$1;
          subjects = r.$2;
          continue;
        }
        return;
      }
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 10, spacing: 12, children: [
          Wrap(spacing: 20, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            if (c.seats.isNotEmpty) SizedBox(width: 380, child: SearchField(hint: "Find a student's seat (roll no, register no, name)", onChanged: c.setFind)),
            if (c.unallocated.isNotEmpty)
              TextButton.icon(
                onPressed: () => _showUnallocated(context, c),
                icon: const Icon(Icons.person_off_outlined, size: 18, color: AppColors.red600),
                label: Text('Unallocated: ${c.unallocated.length}', style: const TextStyle(color: AppColors.red600, fontWeight: FontWeight.w600)),
              ),
          ]),
          Wrap(spacing: 8, runSpacing: 8, children: [
            if (c.seats.isNotEmpty)
              SecondaryButton(label: 'Clear', icon: Icons.delete_outline, danger: true, onPressed: () async {
                if (!await confirmDialog(context, 'Remove the seating plan of this session?', danger: true, confirmLabel: 'Remove')) return;
                c.clear();
                toast('Seating removed.');
              }),
            if (c.anyEarlier)
              Tooltip(
                message: c.previous != null
                    ? 'Copy the seating of ${c.describe(c.previous!)}'
                    : 'Only an earlier exam with exactly the same halls can be copied, and none has them. Use the same halls in the invigilator allocation.',
                child: SecondaryButton(
                  label: 'Same as Previous Exam',
                  icon: Icons.copy,
                  onPressed: c.previous == null
                      ? null
                      : () async {
                          final p = c.previous!;
                          if (!await confirmDialog(context,
                              'Use the seating of the previous exam (${c.describe(p)}) for this exam? Every student keeps the same hall, bench and seat.${c.seats.isNotEmpty ? ' This replaces the current seating plan.' : ''}')) {
                            return;
                          }
                          showOutcome(c.copyPrevious());
                        },
                ),
              ),
            c.seats.isNotEmpty
                ? SecondaryButton(label: 'Reselect Students', icon: Icons.people_outline, onPressed: () => configure(select: true))
                : PrimaryButton(label: 'Select Students & Configure Seating', icon: Icons.people_outline, onPressed: () => configure(select: true)),
            if (c.seats.isNotEmpty) SecondaryButton(label: 'Edit Configuration', icon: Icons.tune, onPressed: () => configure(select: false)),
            if (c.seats.isNotEmpty)
              PopupMenuButton<String>(
                onSelected: (k) async => showOutcome(await c.export(k)),
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'plan', child: ListTile(leading: Icon(Icons.description_outlined), title: Text('Seating Plan'), subtitle: Text('One landscape page per hall, bench by bench'))),
                  PopupMenuItem(value: 'attendance', child: ListTile(leading: Icon(Icons.description_outlined), title: Text('Attendance Sheets'), subtitle: Text('One page per hall with a signature column'))),
                  PopupMenuItem(value: 'list', child: ListTile(leading: Icon(Icons.description_outlined), title: Text('Student List'), subtitle: Text('Every student with hall, bench and seat'))),
                ],
                child: const IgnorePointer(child: PrimaryButton(label: 'Export PDF', icon: Icons.download, onPressed: _noop)),
              ),
          ]),
        ]),
      ),
      if (found.isNotEmpty)
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Column(children: [
            for (final s in found)
              InkWell(
                onTap: () => _showHall(context, c, halls.firstWhere((h) => h.id == s.hallId), colorOf, highlight: found.map((f) => f.studentId).toList()),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Wrap(spacing: 12, children: [
                    Text(s.rollNo, style: monoSmall.copyWith(fontWeight: FontWeight.w700)),
                    Text(s.studentName),
                    Text('${s.category ?? s.batch} → Hall ${s.hallCode}, bench ${s.benchNo}, ${s.seat == 'L' ? 'left' : 'right'} seat', style: cellSec),
                  ]),
                ),
              ),
          ]),
        )
      else if (c.find.trim().isNotEmpty)
        const Padding(padding: EdgeInsets.all(8), child: Text('No seated student matches.', style: TextStyle(fontSize: 13, color: AppColors.textSec))),
      const SizedBox(height: 14),
      if (noLayout.isNotEmpty)
        MessageBanner(kind: BannerKind.warning, lines: ['No bench layout for ${noLayout.map((h) => h.hallCode).join(', ')}: no students can sit there. Set the rows and columns in Master Data → Halls.']),
      if (c.conflicts.isNotEmpty)
        MessageBanner(
          kind: BannerKind.warning,
          title: 'Invigilator handles a subject written in their hall',
          lines: [
            for (final x in c.conflicts) '• ${x.userName} (${x.staffId}) – Hall ${x.hallCode} writes ${x.subjectCode} ${x.subjectName}',
            c.confirmed ? 'This session is confirmed, so its allocation can no longer change.' : 'Reassigning keeps the rotation first: a clash stays only when the rotation leaves no other choice.',
          ],
          trailing: c.confirmed
              ? null
              : PrimaryButton(
                  label: 'Reassign invigilators by subject',
                  onPressed: () async {
                    if (!await confirmDialog(context,
                        'Make the invigilator allocation again with the same staff and halls, keeping staff out of halls writing a subject they handle? Manual changes to this session\'s allocation are replaced. The seating stays as it is.')) {
                      return;
                    }
                    showOutcome(w.reassignSameSelection());
                  },
                ),
        ),
      if (c.warnings.isNotEmpty) MessageBanner(kind: BannerKind.warning, lines: [for (final x in c.warnings) '• $x']),
      LayoutBuilder(builder: (_, box) {
        final cols = box.maxWidth >= 1200 ? 4 : box.maxWidth >= 900 ? 3 : box.maxWidth >= 600 ? 2 : 1;
        final cw = (box.maxWidth - 12 * (cols - 1)) / cols;
        return Wrap(spacing: 12, runSpacing: 12, children: [
          for (final h in halls)
            SizedBox(
              width: cw,
              child: Builder(builder: (_) {
                final g = c.genderOf(h.id), inHall = c.seatsIn(h.id);
                final (bg, fg) = groupColors(g);
                final classes = inHall.map((s) => s.category ?? s.batch).toSet().join(', ');
                return AppCard(
                  padding: const EdgeInsets.all(12),
                  onTap: inHall.isEmpty ? null : () => _showHall(context, c, h, colorOf),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Expanded(child: Text(h.hallCode, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary, fontSize: 15))),
                      Pill(h.benches == 0 ? 'No layout' : g != null ? groupLabel(g) : (c.seats.isNotEmpty ? 'Not used' : 'Empty'), bg: bg, fg: fg),
                    ]),
                    const SizedBox(height: 4),
                    Text('${hallLocation(h.block, h.floor).isEmpty ? '—' : hallLocation(h.block, h.floor)} · ${h.invigilators.join(', ')}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
                    const SizedBox(height: 8),
                    Row(children: [
                      Text.rich(TextSpan(children: [TextSpan(text: '${inHall.length}', style: const TextStyle(fontWeight: FontWeight.bold)), TextSpan(text: ' / ${h.seats} seats')]), style: const TextStyle(fontSize: 13)),
                      const SizedBox(width: 8),
                      if (inHall.isNotEmpty) Expanded(child: Text(classes, textAlign: TextAlign.right, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: AppColors.textSec))),
                    ]),
                  ]),
                );
              }),
            ),
        ]);
      }),
    ]);
  }

  static void _noop() {}

  void _showHall(BuildContext context, SeatingPanelController c, SeatingHallInfo hall, ClassColor Function(String) colorOf, {List<int> highlight = const []}) {
    showDialog(context: context, builder: (_) => HallSeatingDialog(controller: c, hall: hall, colorOf: colorOf, highlight: highlight));
  }

  void _showUnallocated(BuildContext context, SeatingPanelController c) => showDialog(
        context: context,
        builder: (ctx) => ModalShell(
          title: 'Unallocated Students (${c.unallocated.length})',
          subtitle: 'Selected for this session but left without a seat by the seating rules.',
          maxWidth: 900,
          actions: [PrimaryButton(label: 'Print / PDF', icon: Icons.description_outlined, onPressed: () async => showOutcome(await c.export('unallocated')))],
          child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: UnallocatedTable(rows: c.unallocated)),
        ),
      );
}
