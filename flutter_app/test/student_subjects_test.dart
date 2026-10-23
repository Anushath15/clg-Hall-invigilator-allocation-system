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

  test('a student\'s subjects are the active subjects mapped to that student', () {
    final c = StudentsController(s);
    final cs22 = c.students.firstWhere((x) => x.rollNo == '22CS001');
    final cs23 = c.students.firstWhere((x) => x.rollNo == '23CS001');
    expect(c.subjectsOf(cs22).map((x) => x.code), ['CS3401']);
    expect(c.subjectsOf(cs23).map((x) => x.code), ['CS3301']);
    // A subject switched off is no longer something the student studies.
    final off = c.subjectsOf(cs22).single;
    s.subjects.save(id: off.id, code: off.code, name: off.name, departmentId: off.departmentId, isActive: false);
    expect(c.subjectsOf(cs22), isEmpty);
  });

  testWidgets('clicking a student row shows the subjects the student studies', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false).go(AppPage.master, tab: MasterTab.students);
    await tester.pump(const Duration(milliseconds: 400));

    await tester.tap(find.text('22CS001').first);
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.text('CS3401'), findsOneWidget);
    expect(find.text('CS3301'), findsNothing);
  });
}
