import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../controllers/app_controllers.dart';
import '../../core/theme.dart';
import '../pages/cycles_page.dart';
import '../pages/dashboard_page.dart';
import '../pages/history_page.dart';
import '../pages/master/master_page.dart';
import '../pages/reports_page.dart';
import '../pages/settings_page.dart';
import '../pages/workspace/workspace_page.dart';

/// The window: the sidebar on the left and the current page on the right (with a Back link).
class AdminShell extends StatelessWidget {
  const AdminShell({super.key});

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavigationController>();
    final version = context.watch<DataVersion>().version;
    final state = nav.current;
    final page = switch (state.page) {
      AppPage.dashboard => const DashboardPage(),
      AppPage.cycles => const CyclesPage(),
      AppPage.workspace => WorkspacePage(cycleId: state.cycleId!, sessionId: state.sessionId),
      AppPage.history => const HistoryPage(),
      AppPage.reports => const ReportsPage(),
      AppPage.master => MasterPage(tab: state.tab),
      AppPage.settings => const SettingsPage(),
    };
    return Scaffold(
      body: LayoutBuilder(builder: (context, c) {
        // Below 1024 px the sidebar is icon-only, unless expanded for now.
        final collapsed = c.maxWidth < 1024 ? !nav.sidebarCollapsed : nav.sidebarCollapsed;
        return Row(children: [
          _Sidebar(collapsed: collapsed),
          Expanded(
            child: Column(children: [
              if (state.page != AppPage.dashboard && nav.canGoBack)
                Container(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.fromLTRB(28, 14, 28, 0),
                  child: TextButton.icon(
                    onPressed: nav.back,
                    icon: const Icon(Icons.arrow_back, size: 18),
                    label: const Text('Back'),
                    style: TextButton.styleFrom(foregroundColor: AppColors.textSec),
                  ),
                ),
              Expanded(child: KeyedSubtree(key: ValueKey('${state.page}-${state.tab}-${state.cycleId}-$version'), child: page)),
            ]),
          ),
        ]);
      }),
    );
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.collapsed});
  final bool collapsed;

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavigationController>();
    final settings = context.watch<SettingsController>();
    final cur = nav.current;

    Widget item(IconData icon, String label, bool active, VoidCallback onTap) {
      final tile = InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          margin: const EdgeInsets.only(bottom: 4),
          padding: EdgeInsets.symmetric(horizontal: collapsed ? 0 : 12, vertical: 10),
          decoration: BoxDecoration(
            color: active ? AppColors.gold : null,
            borderRadius: BorderRadius.circular(8),
            border: active ? const Border(left: BorderSide(color: AppColors.goldDeep, width: 4)) : null,
          ),
          child: Row(mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
            Icon(icon, size: 20, color: active ? AppColors.sidebar : const Color(0xFFD1D5DB)),
            if (!collapsed) ...[
              const SizedBox(width: 12),
              Expanded(child: Text(label, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, color: active ? AppColors.sidebar : const Color(0xFFD1D5DB), fontWeight: active ? FontWeight.w700 : FontWeight.w500))),
            ],
          ]),
        ),
      );
      return collapsed ? Tooltip(message: label, child: tile) : tile;
    }

    Widget section(String title) => collapsed
        ? Container(margin: const EdgeInsets.fromLTRB(8, 8, 8, 12), height: 1, color: Colors.white12)
        : Padding(padding: const EdgeInsets.fromLTRB(8, 8, 8, 10), child: Text(title, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.gray400, letterSpacing: 1)));

    bool isMaster(MasterTab t) => cur.page == AppPage.master && cur.tab == t;

    return Container(
      width: collapsed ? 64 : 256,
      color: AppColors.sidebar,
      child: Column(children: [
        Container(
          height: 80,
          padding: EdgeInsets.symmetric(horizontal: collapsed ? 0 : 20),
          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Colors.white12))),
          child: Row(mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.spaceBetween, children: [
            if (!collapsed)
              Expanded(
                child: Row(children: [
                  ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.asset('assets/logo.png', width: 40, height: 40)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text('HIAS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15, letterSpacing: 1)),
                      Text(settings.shortName.toUpperCase(), overflow: TextOverflow.ellipsis, style: const TextStyle(color: AppColors.gray400, fontSize: 12, letterSpacing: 1)),
                    ]),
                  ),
                ]),
              ),
            IconButton(
              onPressed: nav.toggleSidebar,
              tooltip: collapsed ? 'Expand sidebar' : 'Collapse sidebar',
              icon: Icon(collapsed ? Icons.keyboard_double_arrow_right : Icons.keyboard_double_arrow_left, color: AppColors.gray400),
            ),
          ]),
        ),
        Expanded(
          child: ListView(padding: EdgeInsets.symmetric(horizontal: collapsed ? 8 : 16, vertical: 20), children: [
            section('MAIN'),
            item(Icons.dashboard_outlined, 'Dashboard', cur.page == AppPage.dashboard, () => nav.go(AppPage.dashboard)),
            item(Icons.calendar_month_outlined, 'Allocation Batches', cur.page == AppPage.cycles || cur.page == AppPage.workspace, () => nav.go(AppPage.cycles)),
            item(Icons.history, 'Allocation History', cur.page == AppPage.history, () => nav.go(AppPage.history)),
            item(Icons.bar_chart, 'Reports', cur.page == AppPage.reports, () => nav.go(AppPage.reports)),
            const SizedBox(height: 16),
            section('MASTER DATA'),
            item(Icons.people_outline, 'Staff / Invigilators', isMaster(MasterTab.staff), () => nav.go(AppPage.master, tab: MasterTab.staff)),
            item(Icons.school_outlined, 'Students', isMaster(MasterTab.students), () => nav.go(AppPage.master, tab: MasterTab.students)),
            item(Icons.menu_book_outlined, 'Subjects', isMaster(MasterTab.subjects), () => nav.go(AppPage.master, tab: MasterTab.subjects)),
            item(Icons.apartment_outlined, 'Halls', isMaster(MasterTab.halls), () => nav.go(AppPage.master, tab: MasterTab.halls)),
            item(Icons.assignment_outlined, 'Departments', isMaster(MasterTab.departments), () => nav.go(AppPage.master, tab: MasterTab.departments)),
            const SizedBox(height: 16),
            section('SYSTEM'),
            item(Icons.settings_outlined, 'Settings', cur.page == AppPage.settings, () => nav.go(AppPage.settings)),
          ]),
        ),
        Container(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
          decoration: const BoxDecoration(border: Border(top: BorderSide(color: Colors.white12))),
          child: Tooltip(
            message: 'Offline mode: all data is stored in the local database on this computer',
            child: Row(mainAxisAlignment: collapsed ? MainAxisAlignment.center : MainAxisAlignment.start, children: [
              const Icon(Icons.storage, size: 16, color: AppColors.gold),
              if (!collapsed) const Padding(padding: EdgeInsets.only(left: 8), child: Text('Offline · Local database', style: TextStyle(color: AppColors.gray400, fontSize: 13))),
            ]),
          ),
        ),
      ]),
    );
  }
}
