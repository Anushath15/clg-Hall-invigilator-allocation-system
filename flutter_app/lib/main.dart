import 'package:flutter/material.dart';

import 'app.dart';
import 'core/database.dart';
import 'services/app_services.dart';

const appVersion = '1.1.0';

/// HIAS – Hall Invigilator Allocation System (Flutter, MVC).
/// Opens the local database (the same eias.db the Electron app used) and starts the app.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    final path = await AppDatabase.defaultPath();
    final db = AppDatabase.open(path, appVersion: appVersion);
    runApp(HiasApp(services: AppServices(db, appVersion: appVersion)));
  } catch (e, st) {
    runApp(StartupErrorApp(message: '$e\n\n$st'));
  }
}
