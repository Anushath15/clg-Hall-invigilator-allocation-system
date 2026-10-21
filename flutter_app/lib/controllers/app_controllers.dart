import 'package:flutter/foundation.dart';

import '../models/domain/schema.dart';
import '../services/app_services.dart';

/// The pages of the app (the sidebar destinations and the allocation workspace).
enum AppPage { dashboard, cycles, workspace, history, reports, master, settings }

enum MasterTab { staff, students, subjects, halls, departments }

class NavState {
  final AppPage page;
  final MasterTab tab;
  final int? cycleId, sessionId;
  const NavState(this.page, {this.tab = MasterTab.staff, this.cycleId, this.sessionId});
}

/// Which page is shown, with a Back history (like the browser history of the Electron app).
class NavigationController extends ChangeNotifier {
  final List<NavState> _stack = [const NavState(AppPage.dashboard)];
  bool sidebarCollapsed = false;

  NavState get current => _stack.last;
  bool get canGoBack => _stack.length > 1;

  void go(AppPage page, {MasterTab tab = MasterTab.staff, int? cycleId, int? sessionId}) {
    _stack.add(NavState(page, tab: tab, cycleId: cycleId, sessionId: sessionId));
    if (_stack.length > 50) _stack.removeAt(0);
    notifyListeners();
  }

  void back() {
    if (!canGoBack) return;
    _stack.removeLast();
    notifyListeners();
  }

  void toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    notifyListeners();
  }
}

/// The saved settings, shared by every screen (college name on headers, default timings).
class SettingsController extends ChangeNotifier {
  SettingsController(this.services) {
    reload();
  }
  final AppServices services;
  Map<String, String> values = {};

  String get collegeName => values['college.name'] ?? defaultCollegeName;
  String get shortName => values['college.short_name'] ?? defaultShortName;
  String get(String key, [String fallback = '']) => values[key] ?? fallback;

  void reload() {
    values = services.master.settings();
    notifyListeners();
  }

  /// Saves several settings; the first problem stops it. Returns an error message or null.
  String? saveAll(Map<String, String> changed) {
    for (final e in changed.entries) {
      final r = services.master.saveSetting(e.key, e.value);
      if (!r.success) return r.error;
    }
    reload();
    return null;
  }
}

/// Lets every open screen reload after the data changed underneath it (e.g. a restore).
class DataVersion extends ChangeNotifier {
  int version = 0;
  void bump() {
    version++;
    notifyListeners();
  }
}
