import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../controllers/app_controllers.dart';
import '../../controllers/dashboard_controller.dart';
import '../../core/theme.dart';
import '../../services/app_services.dart';
import '../widgets/common.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (c) => DashboardController(c.read<AppServices>()),
      child: const _DashboardView(),
    );
  }
}

class _DashboardView extends StatelessWidget {
  const _DashboardView();

  @override
  Widget build(BuildContext context) {
    final c = context.watch<DashboardController>();
    final nav = context.read<NavigationController>();
    final settings = context.watch<SettingsController>();
    final s = c.stats;
    final today = DateFormat('EEEE, d MMMM yyyy').format(DateTime.now());

    Widget stat(IconData icon, String label, int value, Color bg, Color fg, {String? sub, VoidCallback? onTap}) => AppCard(
          onTap: onTap,
          child: Row(children: [
            Container(width: 48, height: 48, decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)), child: Icon(icon, color: fg)),
            const SizedBox(width: 16),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('$value', style: const TextStyle(fontSize: 25, fontWeight: FontWeight.bold)),
                Text(label, style: const TextStyle(color: AppColors.textSec, fontSize: 14)),
                if (sub != null) Text(sub, style: const TextStyle(color: AppColors.textSec, fontSize: 12.5)),
              ]),
            ),
          ]),
        );

    final cards = [
      stat(Icons.people_outline, 'Total Invigilators', s.totalStaff, AppColors.blue50, AppColors.blue600, onTap: () => nav.go(AppPage.master, tab: MasterTab.staff)),
      stat(Icons.school_outlined, 'Total Students', s.totalStudents, const Color(0xFFEEF2FF), const Color(0xFF4F46E5),
          sub: '${s.totalBoys} boys · ${s.totalStudents - s.totalBoys} girls', onTap: () => nav.go(AppPage.master, tab: MasterTab.students)),
      stat(Icons.apartment_outlined, 'Total Halls', s.totalHalls, AppColors.violet50, AppColors.violet600, onTap: () => nav.go(AppPage.master, tab: MasterTab.halls)),
      stat(Icons.calendar_month_outlined, 'Allocation Batches', s.totalCycles, AppColors.green50, AppColors.green600, onTap: () => nav.go(AppPage.cycles)),
      stat(Icons.schedule, 'Upcoming Sessions', s.upcomingSessions, AppColors.amber50, AppColors.amber600, sub: 'Not finished yet'),
      stat(Icons.check_circle_outline, 'Confirmed Sessions', s.confirmedSessions, const Color(0xFFF0FDFA), const Color(0xFF0D9488)),
      stat(Icons.error_outline, 'Pending Allocations', s.pendingAllocations, AppColors.red50, AppColors.error),
    ];

    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        PageHeader(
          title: 'Dashboard',
          subtitle: 'Welcome back, System Administrator · $today\n${settings.collegeName}',
          actions: [PrimaryButton(label: 'New Allocation Batch', icon: Icons.add, onPressed: () => nav.go(AppPage.cycles))],
        ),
        LayoutBuilder(builder: (context, box) {
          final cols = box.maxWidth >= 1000 ? 4 : 2;
          final w = (box.maxWidth - 20 * (cols - 1)) / cols;
          return Wrap(spacing: 20, runSpacing: 20, children: [for (final card in cards) SizedBox(width: w, child: card)]);
        }),
        const SizedBox(height: 32),
        LayoutBuilder(builder: (context, box) {
          final recent = AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Expanded(child: Text('Recent Allocation Batches', style: TextStyle(fontWeight: FontWeight.w700))),
                LinkButton('View all →', onPressed: () => nav.go(AppPage.cycles)),
              ]),
              const SizedBox(height: 12),
              if (c.cycles.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: Center(
                    child: Column(children: [
                      const Icon(Icons.calendar_month_outlined, size: 32, color: AppColors.gray300),
                      const SizedBox(height: 8),
                      const Text('No allocation batches yet', style: TextStyle(fontWeight: FontWeight.w600)),
                      const Text('Create your first allocation to begin.', style: TextStyle(fontSize: 13, color: AppColors.textSec)),
                      const SizedBox(height: 12),
                      PrimaryButton(label: '+ Create', onPressed: () => nav.go(AppPage.cycles)),
                    ]),
                  ),
                )
              else
                for (final cy in c.cycles.take(5))
                  InkWell(
                    onTap: () => nav.go(AppPage.workspace, cycleId: cy.id),
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
                      child: Row(children: [
                        Container(width: 34, height: 34, decoration: BoxDecoration(color: AppColors.veryLight, borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.calendar_today, size: 16, color: AppColors.primary)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(cy.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                            Text(cy.academicYear, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
                          ]),
                        ),
                        StatusBadge(cy.status),
                        const Icon(Icons.chevron_right, color: AppColors.gray300),
                      ]),
                    ),
                  ),
            ]),
          );
          final activity = AppCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [Icon(Icons.timeline, size: 18, color: AppColors.primary), SizedBox(width: 8), Text('Recent Activity', style: TextStyle(fontWeight: FontWeight.w700))]),
              const SizedBox(height: 12),
              if (c.activity.isEmpty)
                const Padding(padding: EdgeInsets.symmetric(vertical: 24), child: Center(child: Text('No activity yet', style: TextStyle(color: AppColors.textSec, fontSize: 13))))
              else
                for (final a in c.activity)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      CircleAvatar(
                        radius: 12,
                        backgroundColor: a.type == 'published' ? AppColors.green50 : a.type == 'confirmed' ? AppColors.blue50 : AppColors.amber50,
                        child: Text(a.type[0].toUpperCase(),
                            style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: a.type == 'published' ? AppColors.green600 : a.type == 'confirmed' ? AppColors.blue600 : AppColors.amber600)),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(a.label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          Text(a.sub, style: const TextStyle(fontSize: 13, color: AppColors.textSec)),
                        ]),
                      ),
                    ]),
                  ),
            ]),
          );
          if (box.maxWidth < 1000) return Column(children: [recent, const SizedBox(height: 20), activity]);
          return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(flex: 3, child: recent), const SizedBox(width: 24), Expanded(flex: 2, child: activity)]);
        }),
      ]),
    );
  }
}
