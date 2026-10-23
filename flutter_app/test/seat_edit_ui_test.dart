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

  testWidgets('Edit seats: a blocked move shows its reasons, an allowed swap is saved', (tester) async {
    tester.view.physicalSize = const Size(1500, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final s = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    final demo = seedDemo(s);
    await tester.pumpWidget(HiasApp(services: s));
    await tester.pump(const Duration(milliseconds: 300));
    Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false)
        .go(AppPage.workspace, cycleId: demo.cycleId, sessionId: demo.sessionIds.first);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Student Seating').first);
    await tester.pump(const Duration(milliseconds: 400));

    // Open hall H101 and switch on editing.
    await tester.ensureVisible(find.text('H101').first);
    await tester.tap(find.text('H101').first);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(find.text('Edit seats'));
    await tester.pump(const Duration(milliseconds: 300));

    String seatOf(String roll) => s.students.sessionSeating(demo.sessionIds.first).where((x) => x.rollNo == roll).map((x) => '${x.hallCode}-${x.benchNo}${x.seat}').single;
    Future<void> click(String roll) async {
      await tester.ensureVisible(find.text(roll).first);
      await tester.tap(find.text(roll).first);
      await tester.pump(const Duration(milliseconds: 300));
    }

    // 22CS004 -> 22EC002's seat would seat 22EC002 beside 22EC004 (one class twice on a bench): refused.
    final before = seatOf('22CS004');
    await click('22CS004');
    expect(find.textContaining('Moving 22CS004'), findsOneWidget);
    await click('22EC002');
    expect(find.textContaining('This move is not allowed'), findsOneWidget);
    expect(find.textContaining('same class'), findsOneWidget);
    expect(seatOf('22CS004'), before, reason: 'nothing changed');

    // After a refused move the student stays picked: choosing 23CS018's seat instead swaps the two, which keeps
    // every rule, so it is saved and each student takes the other's seat.
    final a = seatOf('23CS018');
    await click('23CS018');
    expect(find.textContaining('swapped seats'), findsOneWidget);
    expect(seatOf('23CS018'), before);
    expect(seatOf('22CS004'), a);
  });
}
