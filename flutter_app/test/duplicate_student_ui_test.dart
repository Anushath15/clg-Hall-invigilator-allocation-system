import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/app.dart';
import 'package:hias/controllers/app_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';
import 'package:provider/provider.dart';

import 'support/segoe_font.dart';

void main() {
  setUpAll(loadSegoeUi);

  testWidgets('typing a register number that belongs to another student warns at once under the field', (tester) async {
    tester.view.physicalSize = const Size(1400, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    seedDemo(s);
    final taken = s.students.list().first; // an existing student
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false).go(AppPage.master, tab: MasterTab.students);
    await tester.pump(const Duration(milliseconds: 400));

    await tester.tap(find.text('Add Student'));
    await tester.pump(const Duration(milliseconds: 400));
    // A leading zero must not make it a new number.
    await tester.enterText(find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == 'e.g. 961223104001'), '0${taken.registerNo}');
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('is already used by ${taken.name}'), findsOneWidget);

    // A fresh number clears the warning.
    await tester.enterText(find.byWidgetPredicate((w) => w is TextField && w.decoration?.hintText == 'e.g. 961223104001'), '999000111');
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.textContaining('is already used by'), findsNothing);
  });
}
