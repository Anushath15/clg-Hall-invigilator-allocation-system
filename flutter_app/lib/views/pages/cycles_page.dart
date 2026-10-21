import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/app_controllers.dart';
import '../../controllers/cycle_controllers.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../services/app_services.dart';
import '../widgets/calendar.dart';
import '../widgets/common.dart';

class CyclesPage extends StatelessWidget {
  const CyclesPage({super.key});
  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(create: (c) => CyclesController(c.read<AppServices>()), child: const _CyclesView());
}

class _CyclesView extends StatelessWidget {
  const _CyclesView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<CyclesController>();
    final nav = context.read<NavigationController>();
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        PageHeader(
          title: 'Allocation Batches',
          subtitle: 'Create and manage exam allocation batches',
          actions: [
            PrimaryButton(
              label: 'New Allocation Batch',
              icon: Icons.add,
              onPressed: () async {
                final cycle = await showDialog(context: context, barrierDismissible: false, builder: (_) => CycleWizardDialog(services: context.read<AppServices>()));
                if (cycle != null) {
                  c.load();
                  nav.go(AppPage.workspace, cycleId: cycle.id);
                }
              },
            ),
          ],
        ),
        if (c.cycles.isEmpty) const EmptyState(icon: Icons.calendar_month_outlined, title: 'No allocation batches created yet', subtitle: 'Click "New Allocation Batch" to begin.'),
        for (final cy in c.cycles)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: AppCard(
              onTap: () => nav.go(AppPage.workspace, cycleId: cy.id),
              child: Row(children: [
                Container(width: 40, height: 40, decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(12)), child: const Icon(Icons.calendar_month_outlined, color: AppColors.primary)),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(cy.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                    Text('${cy.academicYear} · Created ${formatDate(cy.createdAt)}', style: const TextStyle(color: AppColors.textSec, fontSize: 14)),
                  ]),
                ),
                StatusBadge(cy.status),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right, color: AppColors.gray300),
              ]),
            ),
          ),
      ]),
    );
  }
}

/// The "New Allocation Batch" wizard; pops with the created batch.
class CycleWizardDialog extends StatelessWidget {
  const CycleWizardDialog({super.key, required this.services});
  final AppServices services;
  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(create: (_) => CycleWizardController(services), child: const _WizardView());
}

class _WizardView extends StatefulWidget {
  const _WizardView();
  @override
  State<_WizardView> createState() => _WizardViewState();
}

class _WizardViewState extends State<_WizardView> {
  late final TextEditingController name, year, days;

  @override
  void initState() {
    super.initState();
    final w = context.read<CycleWizardController>();
    name = TextEditingController(text: w.name);
    year = TextEditingController(text: w.academicYear);
    days = TextEditingController(text: '${w.numDays}');
  }

  @override
  Widget build(BuildContext context) {
    final w = context.watch<CycleWizardController>();
    final settings = context.read<SettingsController>();
    const steps = [(WizardStep.info, '1. Batch Info'), (WizardStep.dates, '2. Select Dates'), (WizardStep.sessions, '3. Configure Sessions & Timings')];
    return ModalShell(
      title: 'New Allocation Batch',
      subtitle: '${settings.collegeName} — Allocation Batch Setup',
      leadingIcon: Icons.calendar_month_outlined,
      maxWidth: 820,
      footerLeading: Align(
        alignment: Alignment.centerLeft,
        child: SecondaryButton(label: w.step == WizardStep.info ? 'Cancel' : 'Back', icon: w.step == WizardStep.info ? null : Icons.chevron_left, onPressed: () => w.step == WizardStep.info ? Navigator.pop(context) : w.back()),
      ),
      actions: [
        if (w.step != WizardStep.sessions)
          PrimaryButton(label: 'Continue', icon: Icons.chevron_right, onPressed: () {
            final e = w.next();
            if (e != null) toast(e, error: true);
          })
        else
          PrimaryButton(
            label: w.loading ? 'Creating Batch...' : 'Create Batch (${w.totalSessions} Sessions)',
            loading: w.loading,
            onPressed: w.totalSessions == 0
                ? null
                : () {
                    try {
                      final cycle = w.create();
                      toast('Allocation batch created with ${w.totalSessions} sessions!');
                      Navigator.pop(context, cycle);
                    } catch (e) {
                      toast(e is ArgumentError ? '${e.message}' : '$e', error: true);
                    }
                  },
          ),
      ],
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          color: AppColors.veryLight,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
          child: Wrap(spacing: 8, crossAxisAlignment: WrapCrossAlignment.center, children: [
            for (var i = 0; i < steps.length; i++) ...[
              Text(steps[i].$2, style: TextStyle(fontWeight: w.step == steps[i].$1 ? FontWeight.bold : FontWeight.w500, color: w.step == steps[i].$1 ? AppColors.primary : AppColors.textSec)),
              if (i < 2) const Icon(Icons.chevron_right, size: 16, color: AppColors.gray300),
            ]
          ]),
        ),
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(22),
            child: switch (w.step) {
              WizardStep.info => _info(w),
              WizardStep.dates => ExamCalendar(
                  selected: w.dates,
                  maxDates: w.numDays,
                  onToggle: (d) {
                    final e = w.toggleDate(d);
                    if (e != null) toast(e, error: true);
                  },
                  onAutoSelect: () => toast('Selected ${w.autoSelect(w.numDays)} exam days (Sundays excluded).'),
                  onClear: w.clearDates,
                ),
              WizardStep.sessions => _sessions(w),
            },
          ),
        ),
      ]),
    );
  }

  Widget _info(CycleWizardController w) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Field(
          label: 'Batch Name *',
          child: TextField(controller: name, autofocus: true, onChanged: (v) => w.name = v, decoration: const InputDecoration(hintText: 'e.g. November 2026 End Semester Examinations')),
        ),
        const Padding(padding: EdgeInsets.only(top: 4, bottom: 16), child: Text('Provide a descriptive name for this examination series.', style: TextStyle(fontSize: 13, color: AppColors.textSec))),
        Field(label: 'Academic Year *', child: TextField(controller: year, onChanged: (v) => w.academicYear = v, decoration: const InputDecoration(hintText: 'e.g. 2026-27'))),
        const SizedBox(height: 16),
        Field(
          label: 'Number of Exam Days *',
          child: SizedBox(
            width: 140,
            child: TextField(
              controller: days,
              keyboardType: TextInputType.number,
              onChanged: (v) => w.update(() => w.numDays = (int.tryParse(v) ?? 1).clamp(1, 30)),
            ),
          ),
        ),
        const Padding(padding: EdgeInsets.only(top: 4), child: Text('Specify how many examination days will take place in this batch (1–30).', style: TextStyle(fontSize: 13, color: AppColors.textSec))),
      ]);

  Widget _sessions(CycleWizardController w) {
    Widget slot(String date, bool fn) {
      final c = w.config[date] ??= DateSessionConfig();
      final on = fn ? c.fn : c.an;
      final rep = fn ? (c.fnReport ?? w.fnReport) : (c.anReport ?? w.anReport);
      final st = fn ? (c.fnStart ?? w.fnStart) : (c.anStart ?? w.anStart);
      final en = fn ? (c.fnEnd ?? w.fnEnd) : (c.anEnd ?? w.anEnd);
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: on ? AppColors.veryLight : AppColors.gray50, borderRadius: BorderRadius.circular(12), border: Border.all(color: on ? AppColors.primary.withValues(alpha: 0.4) : AppColors.gray200)),
        child: Opacity(
          opacity: on ? 1 : 0.6,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Checkbox(value: on, onChanged: (_) => w.update(() => fn ? c.fn = !c.fn : c.an = !c.an)),
              Text(fn ? 'FN — Forenoon' : 'AN — Afternoon', style: const TextStyle(fontWeight: FontWeight.bold)),
            ]),
            Text('Reporting: ${formatTime12h(rep)}', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
            Text('Exam: ${formatTime12h(st)} – ${formatTime12h(en)}', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
            if (w.expanded.contains(date) && on) ...[
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: TimeField(label: 'Report', value: rep, onChanged: (v) => w.update(() => fn ? c.fnReport = v : c.anReport = v))),
                const SizedBox(width: 6),
                Expanded(child: TimeField(label: 'Start', value: st, onChanged: (v) => w.update(() => fn ? c.fnStart = v : c.anStart = v))),
                const SizedBox(width: 6),
                Expanded(child: TimeField(label: 'End', value: en, onChanged: (v) => w.update(() => fn ? c.fnEnd = v : c.anEnd = v))),
              ]),
            ],
          ]),
        ),
      );
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
        child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 8, children: [
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text('Schedule & Timings (${w.dates.length} Exam Days)', style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(width: 8),
              Pill('${w.totalSessions} Planned Sessions', bg: AppColors.light, fg: AppColors.dark),
            ]),
            const Text('Customize reporting and exam timings per session or use global presets.', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
          ]),
          Wrap(spacing: 8, children: [
            SecondaryButton(label: 'Reselect Dates', icon: Icons.calendar_today, onPressed: w.back),
            SecondaryButton(label: 'Global Timings', icon: Icons.tune, onPressed: () => w.update(() => w.showPresets = !w.showPresets)),
          ]),
        ]),
      ),
      if (w.showPresets) ...[
        const SizedBox(height: 12),
        AppCard(
          padding: const EdgeInsets.all(14),
          borderColor: AppColors.primary.withValues(alpha: 0.4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Wrap(spacing: 8, runSpacing: 8, children: [
              SecondaryButton(label: 'Apply 3-Hour Standard (10:00–13:00 / 14:00–17:00)', onPressed: () {
                w.applyPreset(false);
                toast('Applied standard 3-hour exam timings to all sessions.');
              }),
              SecondaryButton(label: 'Apply 2-Hour Exams (10:00–12:00 / 14:00–16:00)', onPressed: () {
                w.applyPreset(true);
                toast('Applied 2-hour exam timings to all sessions.');
              }),
            ]),
            const SizedBox(height: 12),
            const Text('Default FN (Forenoon)', style: TextStyle(fontWeight: FontWeight.bold)),
            Row(children: [
              Expanded(child: TimeField(label: 'Report', value: w.fnReport, onChanged: (v) => w.update(() => w.fnReport = v))),
              const SizedBox(width: 8),
              Expanded(child: TimeField(label: 'Start', value: w.fnStart, onChanged: (v) => w.update(() => w.fnStart = v))),
              const SizedBox(width: 8),
              Expanded(child: TimeField(label: 'End', value: w.fnEnd, onChanged: (v) => w.update(() => w.fnEnd = v))),
            ]),
            const SizedBox(height: 12),
            const Text('Default AN (Afternoon)', style: TextStyle(fontWeight: FontWeight.bold)),
            Row(children: [
              Expanded(child: TimeField(label: 'Report', value: w.anReport, onChanged: (v) => w.update(() => w.anReport = v))),
              const SizedBox(width: 8),
              Expanded(child: TimeField(label: 'Start', value: w.anStart, onChanged: (v) => w.update(() => w.anStart = v))),
              const SizedBox(width: 8),
              Expanded(child: TimeField(label: 'End', value: w.anEnd, onChanged: (v) => w.update(() => w.anEnd = v))),
            ]),
          ]),
        ),
      ],
      const SizedBox(height: 12),
      for (var i = 0; i < w.dates.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: AppCard(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                CircleAvatar(radius: 12, backgroundColor: AppColors.light, child: Text('${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.primary))),
                const SizedBox(width: 8),
                Expanded(child: Text(formatFullDate(w.dates[i]), style: const TextStyle(fontWeight: FontWeight.bold))),
                TextButton.icon(
                  onPressed: () => w.update(() => w.expanded.contains(w.dates[i]) ? w.expanded.remove(w.dates[i]) : w.expanded.add(w.dates[i])),
                  icon: const Icon(Icons.schedule, size: 16),
                  label: Text(w.expanded.contains(w.dates[i]) ? 'Hide Timings' : 'Manual Timings'),
                ),
                IconButton(onPressed: () => w.removeDate(w.dates[i]), icon: const Icon(Icons.delete_outline, size: 18), tooltip: 'Remove this date'),
              ]),
              const SizedBox(height: 8),
              LayoutBuilder(
                builder: (_, box) => box.maxWidth < 560
                    ? Column(children: [slot(w.dates[i], true), const SizedBox(height: 10), slot(w.dates[i], false)])
                    : Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: slot(w.dates[i], true)), const SizedBox(width: 10), Expanded(child: slot(w.dates[i], false))]),
              ),
            ]),
          ),
        ),
    ]);
  }
}
