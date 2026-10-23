import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../controllers/app_controllers.dart';
import '../../../controllers/master_controllers.dart';
import '../../../services/app_services.dart';
import '../../widgets/common.dart';
import 'departments_tab.dart';
import 'halls_tab.dart';
import 'staff_tab.dart';
import 'students_tab.dart';
import 'subjects_tab.dart';

class MasterPage extends StatelessWidget {
  const MasterPage({super.key, required this.tab});
  final MasterTab tab;

  @override
  Widget build(BuildContext context) {
    final s = context.read<AppServices>();
    final body = switch (tab) {
      MasterTab.staff => ChangeNotifierProvider(create: (_) => StaffController(s), child: const StaffTab()),
      MasterTab.students => ChangeNotifierProvider(create: (_) => StudentsController(s), child: const StudentsTab()),
      MasterTab.subjects => ChangeNotifierProvider(create: (_) => SubjectsController(s), child: const SubjectsTab()),
      MasterTab.halls => ChangeNotifierProvider(create: (_) => HallsController(s), child: const HallsTab()),
      MasterTab.departments => ChangeNotifierProvider(create: (_) => DepartmentsController(s), child: const DepartmentsTab()),
    };
    return SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const PageHeader(title: 'Master Data', subtitle: 'Manage staff, students, halls, and departments'),
        body,
      ]),
    );
  }
}

/// The row of count text and buttons above each master list.
class TabToolbar extends StatelessWidget {
  const TabToolbar({super.key, required this.text, required this.actions});
  final String text;
  final List<Widget> actions;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, runSpacing: 10, spacing: 12, children: [
          Text(text, style: cellSec),
          Wrap(spacing: 8, runSpacing: 8, children: actions),
        ]),
      );
}

/// Edit / delete icon buttons at the end of a row.
class RowActions extends StatelessWidget {
  const RowActions({super.key, this.onEdit, this.onDelete, this.extra = const []});
  final VoidCallback? onEdit, onDelete;
  final List<Widget> extra;
  @override
  Widget build(BuildContext context) => FittedBox(
        // Never wider than its table cell: the buttons shrink a little in a narrow column instead of overflowing.
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerRight,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          ...extra,
          if (onEdit != null) IconButton(onPressed: onEdit, icon: const Icon(Icons.edit_outlined, size: 18), tooltip: 'Edit', visualDensity: VisualDensity.compact),
          if (onDelete != null) IconButton(onPressed: onDelete, icon: const Icon(Icons.delete_outline, size: 18, color: Color(0xFFF87171)), tooltip: 'Delete', visualDensity: VisualDensity.compact),
        ]),
      );
}
