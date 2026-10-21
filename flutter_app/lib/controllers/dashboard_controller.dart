import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/format.dart';
import '../models/entities.dart';
import '../services/app_services.dart';

class Activity {
  final String type, label, sub, date;
  const Activity(this.type, this.label, this.sub, this.date);
}

/// The Dashboard: counts (refreshed every minute, since "upcoming" depends on the clock), recent
/// batches and an activity feed from their sessions.
class DashboardController extends ChangeNotifier {
  DashboardController(this.services) {
    load();
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => _refreshStats());
  }
  final AppServices services;
  Timer? _timer;
  DashboardStats stats = const DashboardStats();
  List<ExamCycle> cycles = [];
  List<Activity> activity = [];

  void load() {
    stats = services.master.dashboardStats();
    cycles = services.cycles.cycles();
    final list = <Activity>[];
    for (final c in cycles.take(3)) {
      for (final s in services.cycles.sessions(c.id).take(5)) {
        final sub = '${c.name} · ${formatDate(s.examDate)} ${s.sessionType}';
        final date = s.updatedAt ?? s.createdAt ?? '';
        if (s.status == 'published') list.add(Activity('published', 'Allocation published', sub, date));
        if (s.status == 'confirmed') list.add(Activity('confirmed', 'Allocation confirmed', sub, date));
        if (s.status == 'draft') list.add(Activity('draft', 'Draft allocation created', sub, date));
      }
    }
    list.sort((a, b) => b.date.compareTo(a.date));
    activity = list.take(8).toList();
    notifyListeners();
  }

  void _refreshStats() {
    stats = services.master.dashboardStats();
    notifyListeners();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
