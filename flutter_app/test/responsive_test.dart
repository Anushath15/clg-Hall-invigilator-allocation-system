import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hias/app.dart';
import 'package:hias/controllers/app_controllers.dart';
import 'package:hias/core/database.dart';
import 'package:hias/dev/demo_seed.dart';
import 'package:hias/services/app_services.dart';
import 'package:provider/provider.dart';

/// Window sizes from a small laptop window to a large monitor (logical pixels).
const sizes = <Size>[Size(640, 480), Size(800, 600), Size(1024, 700), Size(1280, 720), Size(1920, 1080)];

void main() {
  late AppServices services;
  late DemoSeedResult demo;

  setUpAll(() async {
    // The app's own font, so text is as wide as on a real Windows PC (tests would use a wide placeholder).
    final loader = FontLoader('Segoe UI');
    for (final f in ['segoeui.ttf', 'segoeuib.ttf']) {
      final file = File('C:/Windows/Fonts/$f');
      if (file.existsSync()) loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  });

  setUp(() {
    services = AppServices(AppDatabase.open(':memory:', appVersion: 'test'));
    demo = seedDemo(services);
  });

  for (final size in sizes) {
    testWidgets('every page fits a ${size.width.toInt()}x${size.height.toInt()} window', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(HiasApp(services: services));
      await tester.pump(const Duration(milliseconds: 400));
      final nav = Provider.of<NavigationController>(tester.element(find.byType(Scaffold).first), listen: false);

      // Every layout error is collected with the page it happened on, instead of stopping at the first.
      final problems = <String>{};
      var page = 'start';
      final previous = FlutterError.onError;
      FlutterError.onError = (d) => problems.add('$page: ${_firstLine(d.exceptionAsString())}');

      Future<void> visit(String name, void Function() go) async {
        page = name;
        go();
        await tester.pump(const Duration(milliseconds: 400));
      }

      await visit('dashboard', () => nav.go(AppPage.dashboard));
      await visit('batches', () => nav.go(AppPage.cycles));
      await visit('history', () => nav.go(AppPage.history));
      await visit('reports', () => nav.go(AppPage.reports));
      await visit('settings', () => nav.go(AppPage.settings));
      for (final tab in MasterTab.values) {
        await visit('master ${tab.name}', () => nav.go(AppPage.master, tab: tab));
      }
      await visit('workspace', () => nav.go(AppPage.workspace, cycleId: demo.cycleId, sessionId: demo.sessionIds.first));
      final seating = find.text('Student Seating');
      if (seating.evaluate().isNotEmpty) {
        page = 'student seating';
        await tester.tap(seating.first);
        await tester.pump(const Duration(milliseconds: 400));
      }
      // Dialogs are the tightest layouts: open each one and close it again.
      final opened = <String>{};
      Future<void> dialog(String name, Finder opener) async {
        if (opener.evaluate().isEmpty) return;
        page = name;
        await tester.ensureVisible(opener.first);
        await tester.tap(opener.first, warnIfMissed: false);
        await tester.pump(const Duration(milliseconds: 500));
        if (find.byType(Dialog).evaluate().isNotEmpty) opened.add(name);
        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pump(const Duration(milliseconds: 500));
        // A dialog that Escape did not close (a full-screen editor): its own Cancel button.
        final cancel = find.text('Cancel');
        if (cancel.evaluate().isNotEmpty) {
          await tester.tap(cancel.first, warnIfMissed: false);
          await tester.pump(const Duration(milliseconds: 500));
        }
      }

      await dialog('edit seating configuration', find.text('Edit Configuration'));
      await dialog('select students', find.text('Reselect Students'));
      nav.go(AppPage.master, tab: MasterTab.students);
      await tester.pump(const Duration(milliseconds: 400));
      await dialog('add student', find.text('Add Student'));
      nav.go(AppPage.master, tab: MasterTab.halls);
      await tester.pump(const Duration(milliseconds: 400));
      await dialog('add hall', find.text('Add Hall'));
      nav.go(AppPage.master, tab: MasterTab.staff);
      await tester.pump(const Duration(milliseconds: 400));
      await dialog('add staff', find.text('Add Staff'));
      nav.go(AppPage.cycles);
      await tester.pump(const Duration(milliseconds: 400));
      await dialog('new batch', find.textContaining('New Batch'));

      FlutterError.onError = previous;
      expect(opened, containsAll(['add student', 'add hall', 'add staff']), reason: 'dialogs that opened');
      expect(problems.toList(), isEmpty, reason: 'at ${size.width.toInt()}x${size.height.toInt()}');
    });
  }
}

String _firstLine(String s) => s.split(RegExp(r'[\r\n]+')).first;
