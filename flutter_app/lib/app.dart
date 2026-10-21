import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'controllers/app_controllers.dart';
import 'core/theme.dart';
import 'services/app_services.dart';
import 'views/shell/admin_shell.dart';
import 'views/widgets/common.dart';

class HiasApp extends StatelessWidget {
  const HiasApp({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AppServices>.value(value: services),
        ChangeNotifierProvider(create: (_) => NavigationController()),
        ChangeNotifierProvider(create: (_) => SettingsController(services)),
        ChangeNotifierProvider(create: (_) => DataVersion()),
      ],
      child: MaterialApp(
        title: 'HIAS – Hall Invigilator Allocation System',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        scaffoldMessengerKey: scaffoldMessengerKey,
        home: const AdminShell(),
      ),
    );
  }
}

/// Shown when the database cannot be opened, so the user is never left with a blank window.
class StartupErrorApp extends StatelessWidget {
  const StartupErrorApp({super.key, required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(32),
            child: SingleChildScrollView(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('HIAS failed to start', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: Colors.red)),
                const SizedBox(height: 12),
                SelectableText(message),
              ]),
            ),
          ),
        ),
      );
}
