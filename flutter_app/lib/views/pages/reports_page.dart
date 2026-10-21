import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/report_controllers.dart';
import '../../core/database.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../services/app_services.dart';
import '../../services/pdf_service.dart';
import '../widgets/common.dart';
import 'workspace/matrix_view.dart';

class ReportsPage extends StatelessWidget {
  const ReportsPage({super.key});
  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(create: (c) => ReportsController(c.read<AppServices>()), child: const _ReportsView());
}

const _reports = [
  ('staffwise', 'Staff-Wise Duty Report', Icons.people_outline, 'All sessions per staff member'),
  ('datewise', 'Date-Wise Allocation Sheet', Icons.calendar_today, 'Hall-by-hall seating for posting'),
  ('timetable', 'Complete Timetable Grid', Icons.grid_on, 'Full Staff × Session matrix'),
  ('audit', 'Rotation Audit Report', Icons.error_outline, 'Auto vs admin-edited assignments'),
];

class _ReportsView extends StatelessWidget {
  const _ReportsView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<ReportsController>();
    final rows = c.rows ?? const <DbRow>[];
    final (head, cells) = switch (c.active) {
      'staffwise' => (const ['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Hall', 'Report', 'Exam', 'Batch'], PdfService.staffWiseCells),
      'datewise' => (const ['Hall', 'Location', 'Cap', 'Staff ID', 'Name', 'Dept', 'Designation', 'Report', 'Exam'], PdfService.dateWiseCells),
      _ => (const ['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Assigned Hall', 'Generated Hall', 'Edited', 'Reason'], PdfService.auditCells),
    };
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader(title: 'Reports', subtitle: 'Generate and export allocation reports with your college letterhead'),
        LayoutBuilder(builder: (_, box) {
          final cols = box.maxWidth >= 1000 ? 4 : 2;
          final w = (box.maxWidth - 12 * (cols - 1)) / cols;
          return Wrap(spacing: 12, runSpacing: 12, children: [
            for (final r in _reports)
              SizedBox(
                width: w,
                child: AppCard(
                  selected: c.active == r.$1,
                  padding: const EdgeInsets.all(16),
                  onTap: () => c.setActive(r.$1),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Icon(r.$3, color: c.active == r.$1 ? AppColors.primary : AppColors.textSec),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(r.$2, style: TextStyle(fontWeight: FontWeight.w600, color: c.active == r.$1 ? AppColors.primary : AppColors.textMain)),
                        Text(r.$4, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
                      ]),
                    ),
                  ]),
                ),
              ),
          ]);
        }),
        const SizedBox(height: 20),
        AppCard(
          child: Wrap(spacing: 16, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.end, children: [
            if (c.active != 'staffwise')
              SizedBox(width: 260, child: Field(label: 'Allocation Batch *', child: Select<int>(value: c.cycleId, hint: '— Select Batch —', items: [for (final cy in c.cycles) (cy.id, cy.name)], onChanged: c.setCycle))),
            if (c.active == 'datewise')
              SizedBox(
                width: 240,
                child: Field(
                  label: 'Session *',
                  child: Select<int>(value: c.sessionId, hint: '— Select Session —', items: [for (final s in c.sessions) (s.id, '${formatDate(s.examDate)} ${s.sessionType}')], onChanged: c.setSession),
                ),
              ),
            if (c.active == 'staffwise')
              SizedBox(
                width: 280,
                child: Field(label: 'Staff Member (optional)', child: Select<int>(value: c.userId, hint: '— All Staff —', items: [for (final u in c.users) (u.id, '${u.name} (${u.staffId})')], onChanged: c.setUser)),
              ),
            Wrap(spacing: 8, children: [
              PrimaryButton(label: 'Generate', icon: Icons.bar_chart, onPressed: () {
                final e = c.generate();
                if (e != null) toast(e, error: true);
              }),
              if (c.hasData && (c.active != 'timetable' || (c.timetable?.sessions.isNotEmpty ?? false)))
                SecondaryButton(label: 'Export PDF', icon: Icons.download, onPressed: () async => showOutcome(await c.exportPdf())),
            ]),
          ]),
        ),
        const SizedBox(height: 16),
        if (c.active == 'timetable' && c.timetable != null)
          AppCard(
            padding: EdgeInsets.zero,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                decoration: const BoxDecoration(color: AppColors.sidebar, borderRadius: BorderRadius.vertical(top: Radius.circular(12))),
                child: Text('Complete Timetable Matrix — ${c.cycles.where((x) => x.id == c.cycleId).firstOrNull?.name ?? ''}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
              ),
              Padding(padding: const EdgeInsets.all(12), child: AllocationMatrix(data: c.timetable!, dark: false)),
            ]),
          ),
        if (c.active != 'timetable' && rows.isNotEmpty)
          DataTableCard(
            columns: head,
            minWidth: 1000,
            rowColor: (i) => asBool(rows[i]['is_manually_edited']) ? AppColors.amber50 : null,
            footer: Text('${rows.length} records', style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
            rows: [for (final r in rows) [for (final v in cells(r)) Text(v, style: const TextStyle(fontSize: 13))]],
          ),
        if (c.active != 'timetable' && c.rows != null && rows.isEmpty) const EmptyState(icon: Icons.description_outlined, title: 'No records for these filters.'),
        if (!c.hasData) const EmptyState(icon: Icons.description_outlined, title: 'Select a report type and filters, then click Generate.'),
      ]),
    );
  }
}
