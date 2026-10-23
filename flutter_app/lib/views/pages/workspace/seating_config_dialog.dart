import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/seating_controllers.dart';
import '../../../core/format.dart';
import '../../../core/theme.dart';
import '../../../models/domain/hall_layout.dart';
import '../../../models/domain/seating.dart';
import '../../../models/entities.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';
import 'seating_widgets.dart';

/// Seating configuration of a session. Pops with the saved ConfirmResult, 'back' to change the
/// students, or null when cancelled.
class SeatingConfigDialog extends StatelessWidget {
  const SeatingConfigDialog({super.key, required this.services, required this.session, required this.halls, required this.studentIds, this.sessionSubjectIds});
  final AppServices services;
  final ExamSession session;
  final List<SeatingHallInfo> halls;
  final List<int> studentIds;
  final List<int>? sessionSubjectIds;

  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(
        create: (_) => SeatingConfigController(services, session, halls, studentIds, sessionSubjectIds: sessionSubjectIds),
        child: const _ConfigView(),
      );
}

String _groupName(String? g) => g == 'M' ? 'Boys' : g == 'F' ? 'Girls' : g == 'mixed' ? 'Boys & Girls' : 'Not used';

class _ConfigView extends StatelessWidget {
  const _ConfigView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<SeatingConfigController>();
    if (c.fatal != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        toast(c.fatal!, error: true, seconds: 7);
        if (context.mounted) Navigator.pop(context);
      });
      return const SizedBox.shrink();
    }
    final settings = _settings(context, c);
    final preview = _preview(context, c);
    return ModalShell(
      title: 'Seating Configuration',
      subtitle: '${formatDateWithDay(c.session.examDate)} · ${c.session.sessionType}',
      maxWidth: 1400,
      fullHeight: true,
      footerLeading: Align(alignment: Alignment.centerLeft, child: SecondaryButton(label: 'Change students', icon: Icons.arrow_back, onPressed: () => Navigator.pop(context, 'back'))),
      actions: [
        OutlinedButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        PrimaryButton(
          label: 'Confirm & Save',
          loading: c.saving,
          onPressed: !c.canSave ? null : () => _save(context, c, false),
        ),
      ],
      child: c.config == null
          ? const Center(child: CircularProgressIndicator())
          : LayoutBuilder(builder: (_, box) {
              if (box.maxWidth < 900) {
                return ListView(children: [settings, const Divider(), preview]);
              }
              return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                SizedBox(width: 400, child: SingleChildScrollView(child: settings)),
                Container(width: 1, color: AppColors.border),
                Expanded(child: Container(color: AppColors.gray50, child: SingleChildScrollView(child: preview))),
              ]);
            }),
    );
  }

  Future<void> _save(BuildContext context, SeatingConfigController c, bool accept) async {
    final r = c.save(acceptUnallocated: accept);
    if (r == null && c.confirmList != null) {
      final ok = await showDialog<bool>(context: context, builder: (_) => _UnallocatedConfirm(list: c.confirmList!));
      if (ok == true && context.mounted) return _save(context, c, true);
      c.cancelConfirm();
      return;
    }
    if (r == null) return;
    if (!r.success) return toast(r.error ?? 'The seating plan could not be saved.', error: true, seconds: 8);
    if (context.mounted) Navigator.pop(context, r);
  }

  Widget _settings(BuildContext context, SeatingConfigController c) {
    if (c.config == null) return const SizedBox.shrink();
    final cfg = c.config!;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (c.lockedHallCodes.isNotEmpty) ...[
          MessageBanner(
            kind: BannerKind.info,
            title: 'Locked: ${c.lockedHallCodes.join(', ')}',
            lines: const ['These halls keep their students and seats. Only the other students are configured here, for the other halls.'],
          ),
          const SizedBox(height: 10),
        ],
        const Text('Allocation method', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        for (final m in SeatingMethod.values)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: InkWell(
              onTap: () => c.chooseMethod(m),
              borderRadius: BorderRadius.circular(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: c.method == m ? AppColors.primary.withValues(alpha: 0.05) : null,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: c.method == m ? AppColors.primary : AppColors.border),
                ),
                child: Row(children: [
                  Radio<SeatingMethod>(value: m, groupValue: c.method, onChanged: (_) => c.chooseMethod(m)),
                  Text(seatingMethodLabel[m]!, style: const TextStyle(fontWeight: FontWeight.w500)),
                ]),
              ),
            ),
          ),
        if (c.method == SeatingMethod.pattern)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppColors.violet50, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.violet200)),
            child: PatternEditor(pattern: c.sharedPattern, onChanged: c.changeSharedPattern),
          ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.border)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Classes per hall', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Row(children: [
              const Text('Target ', style: TextStyle(fontSize: 13)),
              DropdownButton<int>(
                value: c.classLimit.preferred,
                items: [for (var n = minClassesPerHall; n <= maxClassesPerHall; n++) DropdownMenuItem(value: n, child: Text('$n'))],
                onChanged: (v) => c.setClassLimit(ClassLimit(v!, c.classLimit.max)),
              ),
              const SizedBox(width: 12),
              const Text('up to ', style: TextStyle(fontSize: 13)),
              DropdownButton<int>(
                value: c.classLimit.max,
                items: [for (var n = c.classLimit.preferred; n <= maxClassesPerHall; n++) DropdownMenuItem(value: n, child: Text('$n'))],
                onChanged: (v) => c.setClassLimit(ClassLimit(c.classLimit.preferred, v!)),
              ),
              const Text(' if needed', style: TextStyle(fontSize: 13)),
            ]),
          ]),
        ),
        _SubjectsEditor(c: c),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: SecondaryButton(label: 'Auto-assign halls', icon: Icons.auto_fix_high, onPressed: () {
            c.autoAssign();
            toast('Halls assigned automatically.');
          }),
        ),
        const SizedBox(height: 12),
        if (c.method == SeatingMethod.rollwise)
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppColors.violet50, borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.violet200)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text.rich(TextSpan(children: [const TextSpan(text: 'Students', style: TextStyle(fontWeight: FontWeight.bold)), TextSpan(text: ': ${c.boys + c.girls} selected (${c.boys} boys, ${c.girls} girls)')]), style: const TextStyle(fontSize: 13)),
              Text('${c.totalSeats} seats in the halls used', style: TextStyle(fontSize: 13, color: c.boys + c.girls > c.totalSeats ? AppColors.red600 : AppColors.textSec, fontWeight: c.boys + c.girls > c.totalSeats ? FontWeight.w600 : null)),
            ]),
          )
        else
          Row(children: [
            for (final g in const ['M', 'F']) ...[
              Expanded(
                child: Builder(builder: (_) {
                  final need = g == 'M' ? c.boys : c.girls, have = c.seatsFor(g);
                  return Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: g == 'M' ? AppColors.sky50 : AppColors.pink50,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: g == 'M' ? AppColors.sky200 : AppColors.pink200),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text.rich(TextSpan(children: [TextSpan(text: _groupName(g), style: const TextStyle(fontWeight: FontWeight.bold)), TextSpan(text: ': $need selected')]), style: const TextStyle(fontSize: 13)),
                      Text('$have seats assigned', style: TextStyle(fontSize: 13, color: need > have ? AppColors.red600 : AppColors.textSec, fontWeight: need > have ? FontWeight.w600 : null)),
                    ]),
                  );
                }),
              ),
              if (g == 'M') const SizedBox(width: 8),
            ]
          ]),
        const SizedBox(height: 12),
        for (final h in cfg.halls) _HallCard(c: c, hallId: h.hallId, pattern: h.pattern),
      ]),
    );
  }

  Widget _preview(BuildContext context, SeatingConfigController c) {
    final plan = c.plan;
    final colorOf = classColors(c.previewColorKeys);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Wrap(spacing: 22, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            const Text('Preview', style: TextStyle(fontWeight: FontWeight.w700)),
            if (c.previewing) const Padding(padding: EdgeInsets.only(left: 8), child: SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))),
          ]),
          if (plan != null) ...[
            Text.rich(TextSpan(children: [const TextSpan(text: 'Selected: ', style: TextStyle(color: AppColors.textSec)), TextSpan(text: '${c.studentIds.length}', style: const TextStyle(fontWeight: FontWeight.bold))])),
            Text.rich(TextSpan(children: [const TextSpan(text: 'Seated: ', style: TextStyle(color: AppColors.textSec)), TextSpan(text: '${plan.seats.length}', style: const TextStyle(fontWeight: FontWeight.bold))])),
            Text.rich(TextSpan(children: [
              const TextSpan(text: 'Unallocated: ', style: TextStyle(color: AppColors.textSec)),
              TextSpan(text: '${c.unallocated.length}', style: TextStyle(fontWeight: FontWeight.bold, color: c.unallocated.isNotEmpty ? AppColors.red600 : null)),
            ])),
          ],
        ]),
        const SizedBox(height: 12),
        if (c.shortfall != null)
          MessageBanner(kind: BannerKind.error, title: 'Not everyone can be seated', lines: [c.shortfall!, 'Every combination of halls was tried, including boys and girls sharing a hall bench by bench.']),
        if (c.shortfall == null && c.unallocated.isNotEmpty)
          MessageBanner(
            kind: BannerKind.info,
            lines: const ['These halls can seat everyone with different hall settings.'],
            trailing: PrimaryButton(label: 'Seat everyone', icon: Icons.auto_fix_high, onPressed: c.seatEveryone),
          ),
        if (c.errors.isNotEmpty) MessageBanner(kind: BannerKind.error, title: 'Fix these before saving', lines: [for (final e in c.errors) '• $e']),
        if (c.errors.isEmpty && plan != null)
          MessageBanner(kind: BannerKind.success, lines: [
            'Two students per bench, never two of the same class on a bench, at most ${c.classLimit.max} classes in a hall, ${c.config!.mixGenders ? 'seats in roll number order, boys and girls together.' : "every seat as its hall's bench pattern says."}',
            if (c.subjects.isNotEmpty || c.sessionSubjects.isNotEmpty) 'By subject: students writing the same subject never share a bench and never sit side by side across the aisle.',
          ]),
        if (c.warnings.isNotEmpty) MessageBanner(kind: BannerKind.warning, lines: [for (final w in c.warnings) '• $w']),
        if (plan != null && c.report != null) ...[RuleCheckCard(report: c.report!), const SizedBox(height: 12)],
        if (plan != null)
          DataTableCard(
            columns: const ['Hall', 'Group', 'Benches', 'Seats', 'Students', 'Empty'],
            minWidth: 520,
            onRowTap: (i) {
              final h = plan.halls[i];
              if (h.occupied == 0) return;
              showDialog(
                context: context,
                builder: (_) => HallSeatingDialog(hall: c.hallOf(h.hallId), previewSeats: c.previewSeats(h.hallId), colorOf: colorOf, previewGender: h.gender),
              );
            },
            rows: [
              for (final h in plan.halls)
                [
                  Text(h.hallCode, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary)),
                  Text(_groupName(h.gender), style: TextStyle(fontSize: 13, color: h.gender == null ? AppColors.textSec : null)),
                  Text('${h.benches}', style: const TextStyle(fontSize: 13)),
                  Text('${h.capacity}', style: const TextStyle(fontSize: 13)),
                  Text('${h.occupied}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  Text('${h.empty}', style: const TextStyle(fontSize: 13)),
                ]
            ],
          ),
        if (c.unallocated.isNotEmpty) ...[
          const SizedBox(height: 14),
          Text('Unallocated students (${c.unallocated.length})', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.red700)),
          const SizedBox(height: 8),
          UnallocatedTable(rows: c.unallocated),
        ],
      ]),
    );
  }
}

class _HallCard extends StatelessWidget {
  const _HallCard({required this.c, required this.hallId, required this.pattern});
  final SeatingConfigController c;
  final int hallId;
  final List<String> pattern;

  @override
  Widget build(BuildContext context) {
    final hall = c.hallOf(hallId);
    final group = patternGroup(pattern);
    final seats = patternSeats(pattern, hall.benchList);
    final shared = c.method == SeatingMethod.pattern || c.method == SeatingMethod.rollwise;
    final modes = switch (c.method) {
      SeatingMethod.separate => hallModes.where((m) => m.group != 'mixed').toList(),
      SeatingMethod.pattern => [HallMode('mixed', 'Use', c.sharedPattern), hallModes[3]],
      SeatingMethod.rollwise => const [HallMode('mixed', 'Use', ['MM']), HallMode(null, 'Not used', [])],
      SeatingMethod.custom => hallModes,
    };
    bool active(HallMode m) => shared ? (m.group == null) == pattern.isEmpty : group == m.group;
    Color modeColor(String? g) => switch (g) { 'M' => AppColors.sky600, 'F' => AppColors.pink600, 'mixed' => AppColors.violet600, _ => AppColors.gray500 };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: group == null ? AppColors.gray50 : Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: group == null ? AppColors.gray300 : AppColors.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text(hall.hallCode, style: monoSmall.copyWith(fontWeight: FontWeight.bold, color: AppColors.primary)),
          const SizedBox(width: 8),
          Expanded(child: Text('${kindSummary(hall.layout)} · ${hall.seats} seats', style: const TextStyle(fontSize: 12.5, color: AppColors.textSec))),
          if (group != null && c.method != SeatingMethod.rollwise)
            Text.rich(TextSpan(children: [
              TextSpan(text: '${seats['M']}', style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.sky700)),
              const TextSpan(text: ' B · '),
              TextSpan(text: '${seats['F']}', style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.pink700)),
              const TextSpan(text: ' G'),
            ]), style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
        ]),
        const SizedBox(height: 8),
        Wrap(children: [
          for (final m in modes)
            InkWell(
              onTap: active(m) ? null : () => c.setPattern(hallId, m.pattern),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(color: active(m) ? modeColor(shared && m.group != null ? 'mixed' : m.group) : Colors.white, border: Border.all(color: AppColors.border)),
                child: Text(m.label, style: TextStyle(fontSize: 12.5, color: active(m) ? Colors.white : AppColors.textMain)),
              ),
            ),
        ]),
        if (c.method == SeatingMethod.custom && (group == 'mixed' || pattern.length > 1)) ...[
          const SizedBox(height: 8),
          PatternEditor(pattern: pattern, onChanged: (p) => c.setPattern(hallId, p)),
          if (pattern.length > hall.benches && hall.benches > 0)
            Text('Only the first ${hall.benches} benches of the pattern are used.', style: const TextStyle(fontSize: 12, color: AppColors.textSec)),
        ],
        if (group != null && hall.benches == 0) const Padding(padding: EdgeInsets.only(top: 6), child: Text('No bench layout: set it in Master Data → Halls.', style: TextStyle(fontSize: 12.5, color: AppColors.red600))),
      ]),
    );
  }
}

/// A bench pattern: its benches in order, each changeable or removable, and more added.
class PatternEditor extends StatelessWidget {
  const PatternEditor({super.key, required this.pattern, required this.onChanged});
  final List<String> pattern;
  final ValueChanged<List<String>> onChanged;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 4, runSpacing: 4, children: [
        for (var i = 0; i < pattern.length; i++)
          Container(
            padding: const EdgeInsets.only(left: 6),
            decoration: BoxDecoration(
              color: pattern[i] == 'MM' ? AppColors.sky50 : AppColors.pink50,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: pattern[i] == 'MM' ? const Color(0xFF7DD3FC) : const Color(0xFFF9A8D4)),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text('${i + 1}. ', style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
              DropdownButton<String>(
                value: pattern[i],
                isDense: true,
                underline: const SizedBox.shrink(),
                items: [for (final t in benchTypes) DropdownMenuItem(value: t, child: Text(benchTypeLabel[t]!, style: const TextStyle(fontSize: 12.5)))],
                onChanged: (v) => onChanged([for (var j = 0; j < pattern.length; j++) j == i ? v! : pattern[j]]),
              ),
              IconButton(
                onPressed: pattern.length == 1 ? null : () => onChanged([for (var j = 0; j < pattern.length; j++) if (j != i) pattern[j]]),
                icon: const Icon(Icons.close, size: 14),
                visualDensity: VisualDensity.compact,
                tooltip: 'Remove this bench from the pattern',
              ),
            ]),
          ),
        OutlinedButton.icon(
          onPressed: () => onChanged([...pattern, pattern.last == 'MM' ? 'FF' : 'MM']),
          icon: const Icon(Icons.add, size: 14),
          label: const Text('Bench', style: TextStyle(fontSize: 12.5)),
          style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6)),
        ),
      ]);
}

/// The subject each class writes, and the subjects of this exam that mapped students write.
class _SubjectsEditor extends StatelessWidget {
  const _SubjectsEditor({required this.c});
  final SeatingConfigController c;
  @override
  Widget build(BuildContext context) {
    if (c.classes.isEmpty) return const SizedBox.shrink();
    final list = c.subjectList;
    Subject? subjectOf(int id) => list.where((s) => s.id == id).firstOrNull;
    final entered = c.classes.where((k) => c.subjects.containsKey(k.key) || k.mapped == k.count).length;
    return Container(
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: AppColors.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text.rich(TextSpan(children: [
          const TextSpan(text: 'Subjects written ', style: TextStyle(fontWeight: FontWeight.w700)),
          TextSpan(text: '($entered/${c.classes.length} classes)', style: const TextStyle(fontSize: 12.5, color: AppColors.textSec)),
        ])),
        const Text('The subject each class writes in this exam. Students of the same subject never share a bench or sit side by side, and staff handling a subject are kept out of its halls.',
            style: TextStyle(fontSize: 11.5, color: AppColors.textSec)),
        if (list.isEmpty)
          const Padding(padding: EdgeInsets.only(top: 6), child: Text('No subjects yet: add them in Master Data → Subjects.', style: TextStyle(fontSize: 12, color: AppColors.amber700)))
        else ...[
          if (c.mappedSubjects.isNotEmpty) ...[
            const SizedBox(height: 6),
            const Text('Subjects in this exam (students mapped to a ticked subject write it)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Wrap(spacing: 4, runSpacing: 4, children: [
              for (final m in c.mappedSubjects.where((m) => subjectOf(m.id) != null))
                ToggleChip(label: '${subjectOf(m.id)!.code} (${m.count})', tooltip: subjectOf(m.id)!.name, on: c.sessionSubjects.contains(m.id), onColor: AppColors.violet600, onTap: () => c.toggleSessionSubject(m.id)),
            ]),
          ],
          const SizedBox(height: 8),
          const Text('By class (for students not mapped to a ticked subject)', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          for (final k in c.classes)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(children: [
                SizedBox(
                  width: 140,
                  child: Text.rich(TextSpan(children: [
                    TextSpan(text: k.label, style: const TextStyle(fontWeight: FontWeight.bold)),
                    TextSpan(text: ' (${k.mapped > 0 ? '${k.count - k.mapped} not mapped' : k.count})', style: const TextStyle(color: AppColors.textSec)),
                  ]), style: const TextStyle(fontSize: 12), overflow: TextOverflow.ellipsis),
                ),
                Expanded(
                  child: DropdownButton<int?>(
                    isExpanded: true,
                    isDense: true,
                    value: k.mapped == k.count ? null : c.subjects[k.key],
                    hint: Text(k.mapped == k.count ? '— All mapped —' : '— Not entered —', style: const TextStyle(fontSize: 12.5)),
                    items: k.mapped == k.count
                        ? null
                        : [
                            DropdownMenuItem<int?>(value: null, child: Text(k.mapped == k.count ? '— All mapped —' : '— Not entered —', style: const TextStyle(fontSize: 12.5))),
                            for (final s in [...list.where((s) => s.departmentId == k.departmentId), ...list.where((s) => s.departmentId != k.departmentId)])
                              DropdownMenuItem<int?>(value: s.id, child: Text('${s.code} – ${s.name}', overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5))),
                          ],
                    onChanged: (v) {
                      final next = {...c.subjects};
                      if (v == null) {
                        next.remove(k.key);
                      } else {
                        next[k.key] = v;
                      }
                      c.setSubjects(next);
                    },
                  ),
                ),
              ]),
            ),
        ],
      ]),
    );
  }
}

class _UnallocatedConfirm extends StatelessWidget {
  const _UnallocatedConfirm({required this.list});
  final List<UnallocatedStudent> list;
  @override
  Widget build(BuildContext context) => ModalShell(
        title: '${list.length} student${list.length == 1 ? '' : 's'} will not be seated',
        subtitle: "Their group's halls are full. Saving keeps this list with the plan, to view and print from the Student Seating tab. To seat them, go back and give their group more seats.",
        leadingIcon: Icons.warning_amber_rounded,
        iconColor: AppColors.red600,
        maxWidth: 900,
        actions: [
          OutlinedButton(onPressed: () => Navigator.pop(context, false), child: const Text('Go back')),
          PrimaryButton(label: 'Save with ${list.length} unallocated', color: AppColors.red600, onPressed: () => Navigator.pop(context, true)),
        ],
        child: SingleChildScrollView(padding: const EdgeInsets.all(20), child: UnallocatedTable(rows: list)),
      );
}
