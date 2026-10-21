import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/seating_controllers.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/entities.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';
import '../master/subjects_tab.dart';

/// "Select Students" for one session; pops with (studentIds, subjectIds picked "By subject").
class StudentSelectorDialog extends StatelessWidget {
  const StudentSelectorDialog({super.key, required this.services, required this.session, required this.academicYear, required this.seats, required this.initialIds, this.initialSubjectIds = const []});
  final AppServices services;
  final ExamSession session;
  final String? academicYear;
  final int seats;
  final List<int> initialIds, initialSubjectIds;

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (_) => StudentSelectorController(services, session, academicYear: academicYear, seats: seats, initialIds: initialIds, initialSubjectIds: initialSubjectIds),
        child: const _SelectorView(),
      );
}

class _SelectorView extends StatelessWidget {
  const _SelectorView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<StudentSelectorController>();
    final chosen = c.chosen;
    final boys = chosen.where((s) => s.gender == 'M').length;
    final over = chosen.length > c.seats;
    return ModalShell(
      title: 'Select Students',
      subtitle: '${formatDateWithDay(c.session.examDate)} · ${c.session.sessionType}',
      maxWidth: 860,
      fullHeight: true,
      footerLeading: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text.rich(TextSpan(children: [
          TextSpan(text: '${chosen.length}', style: const TextStyle(fontWeight: FontWeight.bold)),
          TextSpan(text: ' selected ($boys boys · ${chosen.length - boys} girls) · ${c.seats} seats in this session\'s halls', style: const TextStyle(color: AppColors.textSec)),
        ])),
        if (over)
          const Text('More students than seats: deselect students or add halls to the invigilator allocation to continue.', style: TextStyle(fontSize: 12.5, color: AppColors.red600)),
      ]),
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        ElevatedButton(onPressed: chosen.isEmpty || over ? null : () => Navigator.pop(context, (chosen.map((s) => s.id).toList(), List<int>.of(c.picked))), child: const Text('Next: Configure Halls')),
      ],
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(22, 12, 22, 8),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Wrap(spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
              SizedBox(width: 320, child: SearchField(hint: 'Search roll no, register no or name', onChanged: c.setQuery)),
              SecondaryButton(label: 'Upload list', icon: Icons.upload, onPressed: () async => showOutcome(await c.uploadList())),
              if (c.sources.isNotEmpty)
                PopupMenuButton<int>(
                  onSelected: (id) => showOutcome(c.copyFrom(id)),
                  itemBuilder: (_) => [
                    for (final s in c.sources) PopupMenuItem(value: s.id, child: Text('${formatDateWithDay(s.examDate)} · ${s.sessionType} (${s.studentCount}) — ${s.cycleName}')),
                  ],
                  child: const IgnorePointer(child: SecondaryButton(label: 'Copy from session…', icon: Icons.copy, onPressed: _noop)),
                ),
            ]),
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
              const Text('Whole batch:', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
              for (final b in c.batches)
                ToggleChip(label: '$b · ${c.yearText(b)} (${c.idsOfBatch(b).length})', on: c.allOn(c.idsOfBatch(b)), onTap: () => c.setMany(c.idsOfBatch(b), !c.allOn(c.idsOfBatch(b)))),
              if (c.selected.isNotEmpty) TextButton(onPressed: c.clearAll, child: const Text('Clear selection', style: TextStyle(color: AppColors.red600))),
            ]),
            if (c.subjects.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                const Tooltip(message: 'Selects the students mapped to the subject (Master Data → Subjects) and seats them by it', child: Text('By subject:', style: TextStyle(fontSize: 13, color: AppColors.textSec))),
                for (final sb in c.subjects)
                  ToggleChip(
                    label: '${sb.code} (${sb.studentIds.where((id) => c.students.any((s) => s.id == id)).length})',
                    tooltip: sb.name,
                    on: c.picked.contains(sb.id),
                    onColor: AppColors.violet600,
                    onTap: () => c.toggleSubject(sb),
                  ),
              ]),
            ],
            if (c.uploadNote?.isNotEmpty ?? false) ...[
              const SizedBox(height: 8),
              MessageBanner(kind: BannerKind.warning, lines: [for (final n in c.uploadNote!.take(10)) '• $n', if (c.uploadNote!.length > 10) '… and ${c.uploadNote!.length - 10} more']),
            ],
          ]),
        ),
        const Divider(),
        Expanded(
          child: c.students.isEmpty
              ? const Center(child: Text('No active students. Add them in Master Data → Students.', style: TextStyle(color: AppColors.textSec)))
              : ListView(padding: const EdgeInsets.fromLTRB(22, 10, 22, 10), children: [
                  for (final g in c.groups)
                    ClassGroupTile(
                      title: '${g.dept}${g.section.isNotEmpty ? ' ${g.section}' : ''} – ${c.yearText(g.batch)}',
                      subtitle: '(${g.batch})',
                      extra: ' · ${g.list.where((s) => s.gender == 'M').length} boys · ${g.list.where((s) => s.gender == 'F').length} girls',
                      students: g.list,
                      selected: c.selected,
                      open: c.open.contains(g.key) || c.query.trim().isNotEmpty,
                      onToggleOpen: () => c.toggleOpen(g.key),
                      onSet: c.setMany,
                      showGender: true,
                    ),
                ]),
        ),
      ]),
    );
  }

  static void _noop() {}
}
