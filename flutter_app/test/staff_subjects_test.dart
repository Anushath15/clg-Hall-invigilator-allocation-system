import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/app.dart';
import 'package:hias/controllers/app_controllers.dart';
import 'package:hias/controllers/master_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';
import 'package:provider/provider.dart';

import 'support/segoe_font.dart';

void main() {
  late AppServices s;

  setUpAll(loadSegoeUi);

  setUp(() {
    s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    seedDemo(s, runFirstSession: false);
  });

  test('a staff member\'s subjects are the active subjects they handle', () {
    final c = StaffController(s);
    final stf1 = c.staff.firstWhere((x) => x.staffId == 'STF001');
    final stf2 = c.staff.firstWhere((x) => x.staffId == 'STF002');
    final stf6 = c.staff.firstWhere((x) => x.staffId == 'STF006');
    expect(c.subjectsOf(stf1).map((x) => x.code), ['CS3401']);
    expect(c.subjectsOf(stf2).map((x) => x.code), ['CS3301']);
    expect(c.subjectsOf(stf6), isEmpty);
    // A subject switched off is no longer something they handle.
    final off = c.subjectsOf(stf1).single;
    s.subjects.save(id: off.id, code: off.code, name: off.name, departmentId: off.departmentId, isActive: false, staffIds: [stf1.id]);
    expect(c.subjectsOf(stf1), isEmpty);
  });

  testWidgets('clicking a staff row shows the subjects the staff member handles', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false).go(AppPage.master, tab: MasterTab.staff);
    await tester.pump(const Duration(milliseconds: 400));

    await tester.tap(find.text('STF001').first);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('CS3401'), findsOneWidget);
    expect(find.text('CS3301'), findsNothing);
  });
}
