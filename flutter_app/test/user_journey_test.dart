import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/app.dart';
import 'package:hias/controllers/app_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';
import 'package:provider/provider.dart';

import 'support/segoe_font.dart';

/// A user walking through the whole application: every page and every tab opens on the demo college, at a wide and
/// at a narrow window, without an error on screen.
void main() {
  setUpAll(loadSegoeUi);

  for (final size in const [Size(1500, 1000), Size(900, 700)]) {
    testWidgets('every page and tab opens at ${size.width.toInt()}x${size.height.toInt()}', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
      final demo = seedDemo(s);
      await tester.pumpWidget(HiasApp(services: s));
      await tester.pump(const Duration(milliseconds: 400));
      final nav = Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false);

      Future<void> visit(String what, void Function() go) async {
        go();
        await tester.pump(const Duration(milliseconds: 500));
        await tester.pump(const Duration(milliseconds: 500));
        expect(tester.takeException(), isNull, reason: 'opening $what');
        expect(find.byType(ErrorWidget), findsNothing, reason: 'opening $what');
      }

      await visit('dashboard', () => nav.go(AppPage.dashboard));
      await visit('batches', () => nav.go(AppPage.cycles));
      await visit('history', () => nav.go(AppPage.history));
      await visit('reports', () => nav.go(AppPage.reports));
      await visit('settings', () => nav.go(AppPage.settings));
      for (final t in MasterTab.values) {
        await visit('master ${t.name}', () => nav.go(AppPage.master, tab: t));
      }
      for (final id in demo.sessionIds) {
        await visit('session $id', () => nav.go(AppPage.workspace, cycleId: demo.cycleId, sessionId: id));
        for (final tab in ['Student Seating', 'Invigilator Allocation']) {
          final f = find.text(tab);
          if (f.evaluate().isEmpty) continue;
          await tester.tap(f.first);
          await tester.pump(const Duration(milliseconds: 500));
          expect(tester.takeException(), isNull, reason: '$tab of session $id');
        }
      }
    });
  }
}
