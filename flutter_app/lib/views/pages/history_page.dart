import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/report_controllers.dart';
import '../../core/database.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../services/app_services.dart';
import '../widgets/common.dart';

class HistoryPage extends StatelessWidget {
  const HistoryPage({super.key});
  @override
  Widget build(BuildContext context) => ChangeNotifierProvider(create: (c) => HistoryController(c.read<AppServices>()), child: const _HistoryView());
}

class _HistoryView extends StatelessWidget {
  const _HistoryView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<HistoryController>();
    Widget filter(String label, Widget child) => SizedBox(width: 260, child: Field(label: label, child: child));
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader(title: 'Allocation History', subtitle: 'Browse all confirmed and published session allocations'),
        AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Filter Records', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            Wrap(spacing: 16, runSpacing: 14, children: [
              filter('By Allocation Batch', Select<int>(value: c.cycleId, hint: '— All Batches —', items: [for (final cy in c.cycles) (cy.id, cy.name)], onChanged: c.setCycle)),
              filter(
                'By Session',
                Select<int>(
                  value: c.sessionId,
                  hint: '— All Sessions —',
                  items: [for (final s in c.sessions) (s.id, '${formatDate(s.examDate)} ${s.sessionType}')],
                  onChanged: c.cycleId == null ? null : (v) => c.setFilter(session: v, clearSession: v == null),
                ),
              ),
              filter('By Staff Member', Select<int>(value: c.userId, hint: '— All Staff —', items: [for (final u in c.users) (u.id, '${u.name} (${u.staffId})')], onChanged: (v) => c.setFilter(user: v, clearUser: v == null))),
              filter(
                'By Hall',
                Select<int>(
                  value: c.hallId,
                  hint: '— All Halls —',
                  items: [for (final h in c.halls) (h.id, '${h.hallCode}${hallLocation(h.block, h.floor).isNotEmpty ? ' — ${hallLocation(h.block, h.floor)}' : ''}')],
                  onChanged: (v) => c.setFilter(hall: v, clearHall: v == null),
                ),
              ),
            ]),
            const SizedBox(height: 16),
            Row(children: [
              PrimaryButton(label: 'Search Records', onPressed: c.search),
              const SizedBox(width: 8),
              SecondaryButton(label: 'Clear Filters', onPressed: c.clear),
              const Spacer(),
              if (c.rows.isNotEmpty) SecondaryButton(label: 'Export PDF', icon: Icons.download, onPressed: () async => showOutcome(await c.exportPdf())),
            ]),
          ]),
        ),
        const SizedBox(height: 20),
        if (c.rows.isEmpty)
          EmptyState(
            icon: Icons.history,
            title: c.searched ? 'No records match these filters' : 'Set filters above and click Search Records',
            subtitle: 'Filter by batch, session, staff member, or hall',
          )
        else ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('${c.rows.length} records found · ${c.rows.where((r) => asBool(r['is_manually_edited'])).length} admin-edited', style: cellSec),
          ),
          DataTableCard(
            columns: const ['Staff ID', 'Name', 'Dept', 'Date', 'Session', 'Hall', 'Batch', 'Type'],
            flex: const [1, 1.8, 0.8, 1.2, 0.8, 0.9, 1.8, 1],
            rowColor: (i) => asBool(c.rows[i]['is_manually_edited']) ? AppColors.amber50 : null,
            rows: [
              for (final r in c.rows)
                [
                  Text(asStr(r['staff_id']), style: monoSmall),
                  Text(asStr(r['staffName']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(asStr(r['deptCode'] ?? '—'), style: cellSec),
                  Text(formatDate(asStr(r['exam_date']))),
                  Text(asStr(r['session_type']), style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(asStr(r['hall_code']), style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.primary)),
                  Text(asStr(r['cycleName']), overflow: TextOverflow.ellipsis, style: cellSec),
                  Text(asBool(r['is_manually_edited']) ? 'Admin Edited' : 'Auto',
                      style: TextStyle(fontSize: 13, color: asBool(r['is_manually_edited']) ? AppColors.amber600 : AppColors.green600, fontWeight: FontWeight.w500)),
                ]
            ],
          ),
        ],
      ]),
    );
  }
}
