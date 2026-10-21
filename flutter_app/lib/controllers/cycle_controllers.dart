import 'package:flutter/foundation.dart';

import '../core/format.dart';
import '../models/domain/validation.dart';
import '../models/entities.dart';
import '../services/app_services.dart';
import '../services/cycle_service.dart';

/// Allocation Batches: the list of batches.
class CyclesController extends ChangeNotifier {
  CyclesController(this.services) {
    load();
  }
  final AppServices services;
  List<ExamCycle> cycles = [];

  void load() {
    cycles = services.cycles.cycles();
    notifyListeners();
  }
}

class DateSessionConfig {
  bool fn, an;
  String? fnReport, fnStart, fnEnd, anReport, anStart, anEnd;
  DateSessionConfig({this.fn = true, this.an = true});
}

enum WizardStep { info, dates, sessions }

/// The "New Allocation Batch" wizard: batch info, exam dates, then sessions and timings.
class CycleWizardController extends ChangeNotifier {
  CycleWizardController(this.services) {
    final s = services.master.settings();
    fnReport = s['session.fn_reporting_time'] ?? fnReport;
    fnStart = s['session.fn_start_time'] ?? fnStart;
    fnEnd = s['session.fn_end_time'] ?? fnEnd;
    anReport = s['session.an_reporting_time'] ?? anReport;
    anStart = s['session.an_start_time'] ?? anStart;
    anEnd = s['session.an_end_time'] ?? anEnd;
  }
  final AppServices services;

  WizardStep step = WizardStep.info;
  String name = '';
  String academicYear = '${DateTime.now().year}-${DateTime.now().year + 1}';
  int numDays = 10;
  final List<String> dates = [];
  final Map<String, DateSessionConfig> config = {};
  final Set<String> expanded = {};
  bool showPresets = false, loading = false;
  String fnReport = '09:30', fnStart = '10:00', fnEnd = '13:00', anReport = '13:30', anStart = '14:00', anEnd = '17:00';

  void update(VoidCallback f) {
    f();
    notifyListeners();
  }

  /// Toggles a date; returns an error message when the limit is reached.
  String? toggleDate(String date) {
    if (dates.contains(date)) {
      dates.remove(date);
      config.remove(date);
    } else {
      if (dates.length >= numDays) return 'Already selected $numDays dates. Increase "Number of Exam Days" in Step 1 to select more.';
      dates.add(date);
      dates.sort();
      config[date] = DateSessionConfig();
    }
    notifyListeners();
    return null;
  }

  /// Selects the next [count] days after today, skipping Sundays.
  int autoSelect(int count) {
    dates.clear();
    config.clear();
    var cursor = DateTime.now().add(const Duration(days: 1));
    var safety = 0;
    while (dates.length < count && safety < 120) {
      safety++;
      if (cursor.weekday != DateTime.sunday) {
        final d = isoDate(cursor);
        dates.add(d);
        config[d] = DateSessionConfig();
      }
      cursor = DateTime(cursor.year, cursor.month, cursor.day + 1);
    }
    notifyListeners();
    return dates.length;
  }

  void clearDates() {
    dates.clear();
    config.clear();
    expanded.clear();
    notifyListeners();
  }

  void removeDate(String d) {
    dates.remove(d);
    config.remove(d);
    notifyListeners();
  }

  void applyPreset(bool twoHour) {
    fnReport = '09:30';
    fnStart = '10:00';
    fnEnd = twoHour ? '12:00' : '13:00';
    anReport = '13:30';
    anStart = '14:00';
    anEnd = twoHour ? '16:00' : '17:00';
    for (final c in config.values) {
      c
        ..fnReport = fnReport
        ..fnStart = fnStart
        ..fnEnd = fnEnd
        ..anReport = anReport
        ..anStart = anStart
        ..anEnd = anEnd;
    }
    notifyListeners();
  }

  int get totalSessions => dates.fold(0, (n, d) => n + ((config[d]?.fn ?? true) ? 1 : 0) + ((config[d]?.an ?? true) ? 1 : 0));

  /// Moves to the next step; returns an error message when the current step is not complete.
  String? next() {
    if (step == WizardStep.info) {
      final p = _infoProblem();
      if (p != null) return p;
      step = WizardStep.dates;
    } else if (step == WizardStep.dates) {
      if (dates.length != numDays) return 'Please select exactly $numDays exam dates (currently ${dates.length} selected).';
      step = WizardStep.sessions;
    }
    notifyListeners();
    return null;
  }

  void back() {
    step = step == WizardStep.sessions ? WizardStep.dates : WizardStep.info;
    notifyListeners();
  }

  String? _infoProblem() => validateBatchName(name) ?? validateAcademicYear(academicYear);

  /// Creates the batch with its sessions; returns the batch, or throws with the reason.
  ExamCycle create() {
    final problem = _infoProblem();
    if (problem != null) throw ArgumentError(problem);
    final sessions = <SessionInput>[];
    for (final d in dates.toSet().toList()..sort()) {
      final c = config[d] ?? DateSessionConfig(an: false);
      if (c.fn) sessions.add(SessionInput(examDate: d, sessionType: 'FN', reportingTime: c.fnReport ?? fnReport, examStart: c.fnStart ?? fnStart, examEnd: c.fnEnd ?? fnEnd));
      if (c.an) sessions.add(SessionInput(examDate: d, sessionType: 'AN', reportingTime: c.anReport ?? anReport, examStart: c.anStart ?? anStart, examEnd: c.anEnd ?? anEnd));
    }
    if (sessions.isEmpty) throw ArgumentError('Please enable at least one FN or AN session.');
    late ExamCycle cycle;
    services.db.transaction(() {
      cycle = services.cycles.createCycle(name.trim(), academicYear.trim());
      services.cycles.createSessions(cycle.id, sessions);
    });
    return cycle;
  }
}
