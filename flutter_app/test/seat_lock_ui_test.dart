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

  testWidgets('lock a hall, see it locked, regenerate remaining and keep the locked hall', (tester) async {
    tester.view.physicalSize = const Size(1500, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    final session = demo.sessionIds.first;
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false).go(AppPage.workspace, cycleId: demo.cycleId, sessionId: session);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Student Seating').first);
    await tester.pump(const Duration(milliseconds: 400));

    // Nothing is locked yet: no banner, no regenerate button.
    expect(find.text('Regenerate remaining'), findsNothing);
    expect(find.textContaining('locked:'), findsNothing);

    // Open H101 and lock it.
    await tester.ensureVisible(find.text('H101').first);
    await tester.tap(find.text('H101').first);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Lock hall'));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Locked'), findsOneWidget);
    expect(find.text('Unlock hall'), findsOneWidget);
    final h101 = s.master.halls().firstWhere((h) => h.hallCode == 'H101').id;
    expect(s.students.savedSeating(session)!.config.lockedHalls, [h101]);

    // Close the popup: the panel shows the lock and offers Regenerate remaining.
    await tester.tap(find.byTooltip('Close'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.textContaining('1 hall is locked: H101'), findsOneWidget);
    expect(find.text('Regenerate remaining'), findsOneWidget);
    expect(find.byIcon(Icons.lock), findsWidgets);

    // Regenerate remaining (after confirming): H101 is exactly as before.
    String h101Seats() => (s.students.sessionSeating(session).where((x) => x.hallId == h101).map((x) => '${x.studentId}:${x.benchNo}${x.seat}').toList()..sort()).join(',');
    final before = h101Seats();
    await tester.ensureVisible(find.text('Regenerate remaining'));
    await tester.tap(find.text('Regenerate remaining'));
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Regenerate').last);
    await tester.pump(const Duration(milliseconds: 600));
    expect(h101Seats(), before);
    expect(s.students.sessionSeating(session).length, 72);
  });
}
