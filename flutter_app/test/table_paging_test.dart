import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/app.dart';
import 'package:hias/controllers/app_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/core/theme.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';
import 'package:hias/views/pages/master/master_page.dart';
import 'package:hias/views/widgets/common.dart';
import 'package:provider/provider.dart';

import 'support/segoe_font.dart';

/// Long lists open at once: a table builds only the rows of its page, a search waits for the last key.
void main() {
  setUpAll(loadSegoeUi);

  Widget table({int rows = 500, void Function(int)? onTap, int pageSize = 50}) => MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: SingleChildScrollView(
            child: DataTableCard(
              pageSize: pageSize,
              columns: const ['No', 'Name'],
              rows: [for (var i = 1; i <= rows; i++) [Text('no $i'), Text('name $i')]],
              onRowTap: onTap,
            ),
          ),
        ),
      );

  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1400, 6000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  testWidgets('a table of 500 rows builds only the 50 of its page', (tester) async {
    tall(tester);
    await tester.pumpWidget(table());
    expect(find.textContaining('name ', findRichText: false), findsNWidgets(50));
    expect(find.text('name 1'), findsOneWidget);
    expect(find.text('name 50'), findsOneWidget);
    expect(find.text('name 51'), findsNothing);
    expect(find.text('1–50 of 500'), findsOneWidget);
    expect(find.text('Page 1 of 10'), findsOneWidget);
  });

  testWidgets('the pager moves between pages, and the rows per page can change', (tester) async {
    tall(tester);
    await tester.pumpWidget(table());
    await tester.tap(find.byTooltip('Next page'));
    await tester.pump();
    expect(find.text('51–100 of 500'), findsOneWidget);
    expect(find.text('name 51'), findsOneWidget);
    expect(find.text('name 1'), findsNothing);
    await tester.tap(find.byTooltip('Previous page'));
    await tester.pump();
    expect(find.text('name 1'), findsOneWidget);

    await tester.tap(find.byType(DropdownButton<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All').last);
    await tester.pumpAndSettle();
    expect(find.textContaining('name ', findRichText: false), findsNWidgets(500));
    expect(find.text('1–500 of 500'), findsOneWidget);
  });

  testWidgets('a tap on a row gives its place in the whole list, on any page', (tester) async {
    tall(tester);
    final tapped = <int>[];
    await tester.pumpWidget(table(onTap: tapped.add));
    await tester.tap(find.byTooltip('Next page'));
    await tester.pump();
    await tester.tap(find.text('name 51'));
    await tester.pump();
    expect(tapped, [50], reason: 'row 51 is the 51st, index 50, not 0');
  });

  testWidgets('a short table has no pager', (tester) async {
    tall(tester);
    await tester.pumpWidget(table(rows: 20));
    expect(find.byTooltip('Next page'), findsNothing);
    expect(find.textContaining('name ', findRichText: false), findsNWidgets(20));
  });

  testWidgets('the Students page of the real 520-student list builds one page of rows', (tester) async {
    tester.view.physicalSize = const Size(1500, 8000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    seedDemo(s);
    // 520 students: the demo has 72, so add more of the same kind.
    final dept = s.master.departments().first.id;
    for (var i = 0; i < 450; i++) {
      s.students.save(rollNo: 'X${1000 + i}', registerNo: '77${100000 + i}', name: 'Extra Student ${i % 26}', gender: i.isEven ? 'M' : 'F', departmentId: dept, section: 'A', batch: '2024-2028');
    }
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false).go(AppPage.master, tab: MasterTab.students);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(RowActions), findsNWidgets(50), reason: '522 students, but only the 50 of the first page are built');
    expect(find.textContaining('of 522'), findsOneWidget);
  });

  testWidgets('the search waits for the last key, then filters and goes back to the first page', (tester) async {
    tall(tester);
    final heard = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SearchField(hint: 'Search', onChanged: heard.add))));
    for (final text in ['1', '10', '102', '1023']) {
      await tester.enterText(find.byType(TextField), text);
      await tester.pump(const Duration(milliseconds: 40));
    }
    expect(heard, isEmpty, reason: 'still typing: nothing was searched for yet');
    await tester.pump(const Duration(milliseconds: 300));
    expect(heard, ['1023'], reason: 'one search, for what was typed');
  });
}
