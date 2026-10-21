import 'package:flutter/foundation.dart';

import '../core/database.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';
import '../services/app_services.dart';
import '../services/report_service.dart';
import 'workspace_controller.dart';

/// Allocation History: filter confirmed allocations and export them.
class HistoryController extends ChangeNotifier {
  HistoryController(this.services) {
    cycles = services.cycles.cycles();
    users = services.master.staff(role: 'staff');
    halls = services.master.halls();
  }
  final AppServices services;
  late final List<ExamCycle> cycles;
  late final List<Staff> users;
  late final List<Hall> halls;
  List<ExamSession> sessions = [];
  int? cycleId, userId, hallId, sessionId;
  List<DbRow> rows = [];
  bool searched = false;

  void setCycle(int? id) {
    cycleId = id;
    sessionId = null;
    sessions = id == null ? [] : services.cycles.sessions(id).where((s) => s.status != 'pending').toList();
    notifyListeners();
  }

  void setFilter({int? user, int? hall, int? session, bool clearUser = false, bool clearHall = false, bool clearSession = false}) {
    if (user != null || clearUser) userId = user;
    if (hall != null || clearHall) hallId = hall;
    if (session != null || clearSession) sessionId = session;
    notifyListeners();
  }

  void search() {
    rows = services.allocation.history(cycleId: cycleId, userId: userId, hallId: hallId, sessionId: sessionId);
    searched = true;
    notifyListeners();
  }

  void clear() {
    cycleId = userId = hallId = sessionId = null;
    sessions = [];
    rows = [];
    searched = false;
    notifyListeners();
  }

  Future<Outcome?> exportPdf() async {
    final bytes = await services.pdf.allocationHistory(rows, services.master.settings());
    final path = await services.files.saveBytes('HIAS-allocation-history.pdf', ['pdf'], bytes, title: 'Save report');
    return path == null ? null : Outcome('PDF saved to $path');
  }
}

/// Reports: staff-wise, date-wise, timetable grid and rotation audit.
class ReportsController extends ChangeNotifier {
  ReportsController(this.services) {
    cycles = services.cycles.cycles();
    users = services.master.staff(role: 'staff');
  }
  final AppServices services;
  late final List<ExamCycle> cycles;
  late final List<Staff> users;
  String active = 'staffwise';
  List<ExamSession> sessions = [];
  int? cycleId, userId, sessionId;
  List<DbRow>? rows;
  TimetableData? timetable;

  bool get hasData => rows != null || timetable != null;

  void setActive(String k) {
    active = k;
    rows = null;
    timetable = null;
    notifyListeners();
  }

  void setCycle(int? id) {
    cycleId = id;
    sessionId = null;
    sessions = id == null ? [] : services.cycles.sessions(id).where((s) => s.isConfirmed).toList();
    notifyListeners();
  }

  void setUser(int? id) {
    userId = id;
    notifyListeners();
  }

  void setSession(int? id) {
    sessionId = id;
    notifyListeners();
  }

  /// Builds the report; returns an error when a required filter is missing.
  String? generate() {
    rows = null;
    timetable = null;
    if (active == 'staffwise') {
      rows = services.reports.staffWise(userId: userId);
    } else if (active == 'datewise' && sessionId != null) {
      rows = services.reports.dateWise(sessionId!);
    } else if (active == 'timetable' && cycleId != null) {
      timetable = services.reports.timetable(cycleId!);
    } else if (active == 'audit' && cycleId != null) {
      rows = services.reports.audit(cycleId!);
    } else {
      notifyListeners();
      return active == 'datewise' ? 'Please select a batch and a session.' : 'Please select a batch.';
    }
    notifyListeners();
    return null;
  }

  Future<Outcome?> exportPdf() async {
    final bytes = await services.pdf.report(active, rows: rows, timetable: timetable, settings: services.master.settings());
    final path = await services.files.saveBytes('HIAS-$active-report.pdf', ['pdf'], bytes, title: 'Save report');
    return path == null ? null : Outcome('PDF saved to $path');
  }
}

/// Settings: backup / restore, restart rotation and deleting batches.
class SettingsPageController extends ChangeNotifier {
  SettingsPageController(this.services) {
    load();
  }
  final AppServices services;
  List<ExamCycle> cycles = [];
  List<DeletedBatch> deleted = [];

  String get dbPath => services.db.path;

  void load() {
    cycles = services.cycles.cycles();
    deleted = services.cycles.deletedBatches();
    notifyListeners();
  }

  Future<Outcome?> backup() async {
    final dest = await services.files.pickSavePath('hias-backup.db', ['db'], title: 'Save backup');
    if (dest == null) return null;
    final r = services.backup.backup(dest);
    return r.success ? const Outcome('Database backed up successfully!') : Outcome.err('Backup failed: ${r.error}');
  }

  /// Restores a backup and reopens the database at once.
  Future<Outcome?> restore() async {
    final src = await services.files.pickFile(['db'], title: 'Choose a HIAS backup');
    if (src == null) return null;
    final r = services.backup.restore(src);
    if (!r.success) return Outcome.err('Restore failed: ${r.error}');
    load();
    return Outcome('Database restored.${r.value != null ? ' The previous data was kept in ${r.value}.' : ''}');
  }

  Outcome restartRotation() {
    try {
      services.allocation.restartRotation();
      return const Outcome('Rotation restarted. Every staff member starts a fresh round with all halls open again.');
    } catch (e) {
      return Outcome.err('Failed to restart rotation: $e');
    }
  }

  String? deleteBatch(ExamCycle c, {required String typedBatchName, required String personName, required String staffId}) {
    final problem = validateBatchDeletion(batchName: c.name, typedBatchName: typedBatchName, personName: personName, staffId: staffId);
    if (problem != null) return problem;
    final r = services.cycles.deleteCycle(c.id, typedBatchName: typedBatchName.trim(), personName: personName.trim(), staffId: staffId.trim());
    if (r.success) load();
    return r.error;
  }
}
