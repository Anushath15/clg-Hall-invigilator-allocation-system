import 'package:flutter/material.dart';

import 'app.dart';
import 'core/database.dart';
import 'dev/demo_extras.dart';
import 'dev/demo_seed.dart';
import 'services/app_services.dart';

const appVersion = '1.1.0';

/// HIAS – Hall Invigilator Allocation System (Flutter, MVC).
/// Opens the local database (the same eias.db the Electron app used) and starts the app.
/// Run with `--demo` to use a separate demo database (eias-demo.db) filled with sample data;
/// the real eias.db is never touched in that mode.
Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final demo = args.contains('--demo') || const bool.fromEnvironment('HIAS_DEMO');
    var path = await AppDatabase.defaultPath();
    if (demo) path = path.replaceFirst(RegExp(r'eias\.db$'), 'eias-demo.db');
    final db = AppDatabase.open(path, appVersion: appVersion);
    final services = AppServices(db, appVersion: appVersion);
    if (demo && db.queryOne('SELECT id FROM departments LIMIT 1') == null) seedDemo(services);
    if (demo) seedDemoExtras(services);
    runApp(HiasApp(services: services));
  } catch (e, st) {
    runApp(StartupErrorApp(message: '$e\n\n$st'));
  }
}
