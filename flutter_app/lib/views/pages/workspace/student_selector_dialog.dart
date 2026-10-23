import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/seating_controllers.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/entities.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';
import '../master/subjects_tab.dart';

/// "Select Students" for one session; pops with (studentIds, subjectIds ticked under By Subject).
/// Students are picked by subject (searchable), by class (searchable), or one by one.
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

    final tabs = Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: AppColors.gray100, borderRadius: BorderRadius.circular(10)),
      child: Row(children: [
        for (final t in const [(0, Icons.menu_book_outlined, 'By Subject'), (1, Icons.groups_outlined, 'By Class'), (2, Icons.person_search_outlined, 'Students')])
          Expanded(
            child: InkWell(
              onTap: () => c.setTab(t.$1),
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: c.tab == t.$1 ? Colors.white : null,
                  borderRadius: BorderRadius.circular(8),
                  boxShadow: c.tab == t.$1 ? const [BoxShadow(color: Color(0x14000000), blurRadius: 3, offset: Offset(0, 1))] : null,
                ),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Icon(t.$2, size: 18, color: c.tab == t.$1 ? AppColors.primary : AppColors.textSec),
                  const SizedBox(width: 8),
                  Text(t.$3, style: TextStyle(fontWeight: FontWeight.w700, color: c.tab == t.$1 ? AppColors.primary : AppColors.textSec)),
                ]),
              ),
            ),
          ),
      ]),
    );

    final body = switch (c.tab) {
      0 => _SubjectsTab(c: c),
      1 => _ClassesTab(c: c),
      _ => _StudentsTab(c: c),
    };

    return ModalShell(
      title: 'Select Students',
      subtitle: '${formatDateWithDay(c.session.examDate)} · ${c.session.sessionType} · ${c.seats} seats in this session\'s halls',
      maxWidth: 1180,
      fullHeight: true,
      footerLeading: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text.rich(TextSpan(children: [
          TextSpan(text: '${chosen.length}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          TextSpan(text: ' selected  ($boys boys · ${chosen.length - boys} girls)', style: const TextStyle(color: AppColors.textSec)),
        ])),
        if (over) Text('${chosen.length - c.seats} more than the ${c.seats} seats: deselect some, or add halls to the invigilator allocation.', style: const TextStyle(fontSize: 12.5, color: AppColors.red600)),
      ]),
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        ElevatedButton(onPressed: chosen.isEmpty || over ? null : () => Navigator.pop(context, (chosen.map((s) => s.id).toList(), List<int>.of(c.picked))), child: const Text('Next: Configure Halls')),
      ],
      child: LayoutBuilder(builder: (_, box) {
        final left = Padding(
          padding: const EdgeInsets.fromLTRB(22, 14, 22, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [tabs, const SizedBox(height: 12), Expanded(child: body)]),
        );
        if (box.maxWidth < 860) return left;
        return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: left),
          Container(width: 1, color: AppColors.border),
          SizedBox(width: 320, child: _SummaryPanel(c: c)),
        ]);
      }),
    );
  }
}

/// By Subject: search subjects by code or name; ticking one selects every student who studies it.
class _SubjectsTab extends StatelessWidget {
  const _SubjectsTab({required this.c});
  final StudentSelectorController c;

  @override
  Widget build(BuildContext context) {
    final list = c.shownSubjects;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SearchField(hint: 'Search subject name or code, e.g. "Compiler" or "CS34"', autofocus: true, onChanged: c.setSubjectQuery),
      const SizedBox(height: 6),
      const Text('Tick a subject to select every student who studies it. They are seated by that subject.', style: TextStyle(fontSize: 12.5, color: AppColors.textSec)),
      const SizedBox(height: 10),
      Expanded(
        child: c.subjects.isEmpty
            ? const Center(
                child: Text('No subjects have students mapped yet.\nMap them in Master Data → Subjects (the students button on each row), or use By Class.',
                    textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSec)))
            : list.isEmpty
                ? Center(child: Text('No subject matches "${c.subjectQuery}".', style: const TextStyle(color: AppColors.textSec)))
                : ListView.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final sb = list[i];
                      final ids = c.idsOfSubject(sb);
                      final n = ids.where(c.selected.contains).length;
                      final picked = c.isPicked(sb);
                      return _PickTile(
                        // Ticked only when this subject itself was clicked, never because its students are selected through another subject.
                        value: picked,
                        onTap: () => c.setSubject(sb, !picked),
                        title: sb.name,
                        badge: sb.code,
                        subtitle: '${sb.departmentCode ?? 'All departments'} · ${ids.length} students',
                        count: picked ? '${ids.length} selected' : (n > 0 ? '$n already selected' : ''),
                        accent: AppColors.violet600,
                      );
                    },
                  ),
      ),
    ]);
  }
}

/// By Class: search class names ("CSE A", "Final", "2023"); tick whole classes, or open one to pick students.
class _ClassesTab extends StatelessWidget {
  const _ClassesTab({required this.c});
  final StudentSelectorController c;

  @override
  Widget build(BuildContext context) {
    final groups = c.classGroups;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SearchField(hint: 'Search class, e.g. "CSE A", "Final Year" or "2023"', autofocus: true, onChanged: c.setClassQuery),
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        const Text('Whole batch:', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
        for (final b in c.batches)
          ToggleChip(label: '$b · ${c.yearText(b)} (${c.idsOfBatch(b).length})', on: c.allOn(c.idsOfBatch(b)), onTap: () => c.setMany(c.idsOfBatch(b), !c.allOn(c.idsOfBatch(b)))),
      ]),
      const SizedBox(height: 10),
      Expanded(
        child: groups.isEmpty
            ? Center(child: Text(c.students.isEmpty ? 'No active students. Add them in Master Data → Students.' : 'No class matches "${c.classQuery}".', style: const TextStyle(color: AppColors.textSec)))
            : ListView(children: [
                for (final g in groups)
                  ClassGroupTile(
                    title: '${g.dept}${g.section.isNotEmpty ? ' ${g.section}' : ''} – ${c.yearText(g.batch)}',
                    subtitle: '(${g.batch})',
                    extra: ' · ${g.list.where((s) => s.gender == 'M').length} boys · ${g.list.where((s) => s.gender == 'F').length} girls',
                    students: g.list,
                    selected: c.selected,
                    open: c.open.contains(g.key),
                    onToggleOpen: () => c.toggleOpen(g.key),
                    onSet: c.setMany,
                    showGender: true,
                  ),
              ]),
      ),
    ]);
  }
}

/// Students: search by roll no, register no or name; also upload a list or copy another session.
class _StudentsTab extends StatelessWidget {
  const _StudentsTab({required this.c});
  final StudentSelectorController c;

  @override
  Widget build(BuildContext context) {
    final q = c.query.trim();
    final matches = q.isEmpty ? <Student>[] : c.students.where((s) => matchesSearch(q, [s.rollNo, s.registerNo, s.name])).take(200).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: SearchField(hint: 'Search roll no, register no or name', autofocus: true, onChanged: c.setQuery)),
        const SizedBox(width: 8),
        SecondaryButton(label: 'Upload list', icon: Icons.upload, onPressed: () async => showOutcome(await c.uploadList())),
        if (c.sources.isNotEmpty) ...[
          const SizedBox(width: 8),
          PopupMenuButton<int>(
            onSelected: (id) => showOutcome(c.copyFrom(id)),
            itemBuilder: (_) => [for (final s in c.sources) PopupMenuItem(value: s.id, child: Text('${formatDateWithDay(s.examDate)} · ${s.sessionType} (${s.studentCount}) — ${s.cycleName}'))],
            child: const IgnorePointer(child: SecondaryButton(label: 'Copy session', icon: Icons.copy, onPressed: _noop)),
          ),
        ],
      ]),
      if (c.uploadNote?.isNotEmpty ?? false) ...[
        const SizedBox(height: 8),
        MessageBanner(kind: BannerKind.warning, lines: [for (final n in c.uploadNote!.take(8)) '• $n', if (c.uploadNote!.length > 8) '… and ${c.uploadNote!.length - 8} more']),
      ],
      const SizedBox(height: 10),
      Expanded(
        child: q.isEmpty
            ? const Center(child: Text('Type a roll number, register number or name to find a student.', style: TextStyle(color: AppColors.textSec)))
            : matches.isEmpty
                ? Center(child: Text('No student matches "$q".', style: const TextStyle(color: AppColors.textSec)))
                : ListView(children: [
                    for (final s in matches)
                      CheckboxListTile(
                        value: c.selected.contains(s.id),
                        onChanged: (v) => c.setMany([s.id], v ?? false),
                        controlAffinity: ListTileControlAffinity.leading,
                        dense: true,
                        title: Text.rich(TextSpan(children: [
                          TextSpan(text: '${s.rollNo}  ', style: monoSmall.copyWith(fontWeight: FontWeight.w700)),
                          TextSpan(text: s.name),
                        ])),
                        subtitle: Text('${s.departmentCode ?? '—'} ${s.section} · ${s.batch} · ${s.gender == 'F' ? 'Girl' : 'Boy'}'),
                      ),
                  ]),
      ),
    ]);
  }

  static void _noop() {}
}

/// A tickable row for a subject: tri-state box, name, code badge, and how many are selected.
class _PickTile extends StatelessWidget {
  const _PickTile({required this.value, required this.onTap, required this.title, required this.badge, required this.subtitle, required this.count, required this.accent});
  final bool? value;
  final VoidCallback onTap;
  final String title, badge, subtitle, count;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final on = value != false;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        decoration: BoxDecoration(
          color: on ? accent.withValues(alpha: 0.06) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: on ? accent : AppColors.border, width: on ? 1.5 : 1),
        ),
        child: Row(children: [
          Checkbox(tristate: true, value: value, onChanged: (_) => onTap(), activeColor: accent),
          const SizedBox(width: 4),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(title, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                const SizedBox(width: 8),
                Pill(badge, bg: accent.withValues(alpha: 0.12), fg: accent, bold: true),
              ]),
              const SizedBox(height: 2),
              Text(subtitle, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
            ]),
          ),
          Text(count, style: TextStyle(fontWeight: FontWeight.w700, color: on ? accent : AppColors.textSec)),
        ]),
      ),
    );
  }
}

/// The right-hand summary: subjects picked, how many students per class, and Clear.
class _SummaryPanel extends StatelessWidget {
  const _SummaryPanel({required this.c});
  final StudentSelectorController c;

  @override
  Widget build(BuildContext context) {
    final chosen = c.chosen;
    final perClass = <String, int>{};
    for (final s in chosen) {
      final k = '${s.departmentCode ?? '—'} ${s.section} – ${c.yearText(s.batch)}';
      perClass[k] = (perClass[k] ?? 0) + 1;
    }
    final keys = perClass.keys.toList()..sort();
    final pickedSubjects = c.subjects.where((s) => c.picked.contains(s.id)).toList();
    final fill = c.seats == 0 ? 0.0 : (chosen.length / c.seats).clamp(0.0, 1.0);
    return Container(
      color: AppColors.gray50,
      child: ListView(padding: const EdgeInsets.all(18), children: [
        const Text('SELECTED', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.textSec, letterSpacing: 1)),
        const SizedBox(height: 8),
        Text.rich(TextSpan(children: [
          TextSpan(text: '${chosen.length}', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
          TextSpan(text: ' / ${c.seats} seats', style: const TextStyle(color: AppColors.textSec)),
        ])),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(value: fill, minHeight: 8, backgroundColor: AppColors.gray200, color: chosen.length > c.seats ? AppColors.red600 : AppColors.primary),
        ),
        const SizedBox(height: 18),
        if (pickedSubjects.isNotEmpty) ...[
          const Text('Subjects', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final sb in pickedSubjects)
              InputChip(
                label: Text('${sb.code} · ${sb.name}', style: const TextStyle(fontSize: 12)),
                onDeleted: () => c.setSubject(sb, false),
                backgroundColor: AppColors.violet50,
                side: const BorderSide(color: AppColors.violet200),
              ),
          ]),
          const SizedBox(height: 16),
        ],
        const Text('By class', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        if (keys.isEmpty)
          const Text('Nothing selected yet. Pick a subject or a class on the left.', style: TextStyle(fontSize: 13, color: AppColors.textSec))
        else
          for (final k in keys)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Expanded(child: Text(k, style: const TextStyle(fontSize: 13))),
                Text('${perClass[k]}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
              ]),
            ),
        if (chosen.isNotEmpty) ...[
          const SizedBox(height: 18),
          SecondaryButton(label: 'Clear selection', icon: Icons.clear, danger: true, onPressed: c.clearAll),
        ],
      ]),
    );
  }
}
