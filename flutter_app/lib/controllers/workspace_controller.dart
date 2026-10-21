import 'package:flutter/foundation.dart';

import '../core/format.dart';
import '../models/domain/list_readers.dart';
import '../models/domain/session_rules.dart';
import '../models/entities.dart';
import '../services/app_services.dart';
import '../services/cycle_service.dart';
import '../services/report_service.dart';

enum WorkspaceView { table, matrix }

enum WorkspacePanel { invigilators, seating }

/// Outcome of an action for the view to show: a message, and whether it was an error.
class Outcome {
  final String message;
  final bool error;
  const Outcome(this.message, {this.error = false});
  const Outcome.err(this.message) : error = true;
}

/// The Allocation Workspace of one batch: its sessions, the invigilator allocation of the active
/// session (generate, swap, confirm, export), and the switch to the student seating.
class WorkspaceController extends ChangeNotifier {
  WorkspaceController(this.services, this.cycleId, {int? sessionId}) {
    loadCycle(preferSessionId: sessionId);
  }
  final AppServices services;
  final int cycleId;

  ExamCycle? cycle;
  List<ExamSession> sessions = [];
  ExamSession? active;
  List<AllocationRow> allocation = [];
  ValidationResult? validation;
  Map<int, Hall> hallsById = {};
  bool loading = false;
  WorkspaceView view = WorkspaceView.table;
  WorkspacePanel panel = WorkspacePanel.invigilators;

  void loadCycle({int? preferSessionId}) {
    cycle = services.cycles.cycle(cycleId);
    sessions = services.cycles.sessions(cycleId);
    hallsById = {for (final h in services.master.halls()) h.id: h};
    final prev = active?.id ?? preferSessionId;
    final next = sessions.where((s) => s.id == prev).firstOrNull ?? sessions.firstOrNull;
    final changed = next?.id != active?.id;
    active = next;
    if (changed) {
      _loadAllocation();
    } else {
      allocation = active == null ? [] : services.allocation.sessionAllocation(active!.id);
    }
    notifyListeners();
  }

  void _loadAllocation() {
    validation = null;
    allocation = active == null ? [] : services.allocation.sessionAllocation(active!.id);
  }

  void selectSession(ExamSession s) {
    if (s.id == active?.id) return;
    active = s;
    _loadAllocation();
    notifyListeners();
  }

  void setView(WorkspaceView v) {
    view = v;
    notifyListeners();
  }

  void setPanel(WorkspacePanel p) {
    panel = p;
    notifyListeners();
  }

  Set<String> get duplicateKeys {
    final counts = <String, int>{};
    for (final s in sessions) {
      final k = '${s.examDate}_${s.sessionType}';
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return {for (final e in counts.entries) if (e.value > 1) e.key};
  }

  bool isDuplicate(ExamSession s) => duplicateKeys.contains('${s.examDate}_${s.sessionType}');

  /// A pending session with an allocation shows as a draft.
  String get effectiveStatus => active == null ? 'pending' : (active!.status == 'pending' && allocation.isNotEmpty ? 'draft' : active!.status);

  List<Staff> activeStaff() => services.master.staff(isActive: true, role: 'staff').where((u) => u.isActive).toList();
  List<Hall> activeHalls() => services.master.halls().where((h) => h.isActive).toList();

  Outcome generate(List<int> userIds, List<int> hallIds) {
    if (active == null) return const Outcome.err('No session selected.');
    if (active!.isConfirmed) return const Outcome.err('This session is already confirmed. It cannot be regenerated.');
    if (userIds.length != hallIds.length) return const Outcome.err('Staff count must equal hall count.');
    loading = true;
    notifyListeners();
    try {
      final r = services.allocation.generate(active!.id, userIds, hallIds);
      sessions = services.cycles.sessions(cycleId);
      active = sessions.firstWhere((s) => s.id == active!.id, orElse: () => active!);
      allocation = r.entries;
      validation = r.validation;
      return r.validation.isValid ? const Outcome('Draft allocation generated successfully!') : Outcome.err('${r.validation.blockingErrors.length} validation issue(s). Review below.');
    } catch (e) {
      return Outcome.err(_msg(e));
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  List<ValidHall> validHallsFor(AllocationRow entry) => services.allocation.validHallsFor(entry.userId, active!.id);
  List<StaffDutyRow> dutyHistory(int userId) => services.allocation.staffDutyHistory(userId).take(20).toList();
  String? staffName(int? userId) => allocation.where((a) => a.userId == userId).firstOrNull?.userName;

  Outcome applyEdit(AllocationRow entry, int hallId) {
    final r = services.allocation.edit(active!.id, entry.userId, hallId);
    if (!r.success) return Outcome.err(r.error?.message ?? 'Invalid assignment.');
    _loadAllocation();
    notifyListeners();
    return Outcome(r.swappedWithUserId != null ? 'Swapped: ${entry.userName} and ${staffName(r.swappedWithUserId) ?? 'the other invigilator'}' : 'Hall updated!');
  }

  Outcome confirm() {
    loading = true;
    notifyListeners();
    try {
      final r = services.allocation.confirm(active!.id);
      if (r.success) {
        loadCycle();
        _loadAllocation();
        if (r.validation?.warnings.isNotEmpty ?? false) validation = r.validation;
        return Outcome((r.validation?.warnings.isNotEmpty ?? false) ? 'Allocation confirmed with ${r.validation!.warnings.length} unavoidable repeat(s).' : 'Allocation confirmed and locked!');
      }
      validation = r.validation;
      return Outcome.err(r.error ?? 'Validation failed — check errors below.');
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// The earliest unconfirmed session before the active one (the R4 "go to" link).
  ExamSession? get firstUnconfirmedEarlier => sessions.where((s) => active != null && s.rotationStep < active!.rotationStep && !s.isConfirmed).firstOrNull;

  Outcome deleteSession(int id) {
    final r = services.cycles.deleteSession(id);
    if (!r.success) return Outcome.err(r.error ?? 'Could not delete the session.');
    if (active?.id == id) active = null;
    loadCycle();
    _loadAllocation();
    notifyListeners();
    return const Outcome('Session deleted.');
  }

  Outcome addSession(SessionInput data) {
    try {
      final s = services.cycles.addSession(cycleId, data);
      sessions = services.cycles.sessions(cycleId);
      active = sessions.firstWhere((x) => x.id == s.id);
      _loadAllocation();
      notifyListeners();
      return Outcome('Session added for ${data.examDate} (${data.sessionType})!');
    } catch (e) {
      return Outcome.err(_msg(e));
    }
  }

  Outcome updateSession(int id, SessionInput data) {
    try {
      services.cycles.updateSession(id, data);
      loadCycle();
      return const Outcome('Session schedule and timings updated!');
    } catch (e) {
      return Outcome.err(_msg(e));
    }
  }

  Future<Outcome?> exportPdf() async {
    if (active == null || allocation.isEmpty) return const Outcome.err('Nothing to export for this session.');
    final bytes = await services.pdf.allocationSheet(cycle: cycle, session: active!, allocation: allocation, settings: services.master.settings());
    final path = await services.files.saveBytes('HIAS-Allocation-${active!.examDate}-${active!.sessionType}.pdf', ['pdf'], bytes, title: 'Save report');
    return path == null ? null : Outcome('PDF saved to $path');
  }

  TimetableData timetable() => services.reports.timetable(cycleId);

  /// Regenerates with the same staff and halls (used by the seating panel to avoid subject clashes).
  Outcome reassignSameSelection() => generate(allocation.map((a) => a.userId).toList(), allocation.map((a) => a.hallId).toList());

  static String _msg(Object e) => e is ArgumentError ? '${e.message}' : (e is StateError ? e.message : '$e');
}

/// "Select Invigilators & Halls": tick staff and halls, search, upload a duty list, or copy another session's selection.
class StaffHallSelectorController extends ChangeNotifier {
  StaffHallSelectorController(this.services, this.session) {
    users = services.master.staff(isActive: true, role: 'staff').where((u) => u.isActive).toList();
    halls = services.master.halls().where((h) => h.isActive).toList();
    sources = services.allocation.sessionSelections();
  }
  final AppServices services;
  final ExamSession session;
  late final List<Staff> users;
  late final List<Hall> halls;
  late final List<SelectionSource> sources;
  final List<int> selUsers = [], selHalls = [];
  String query = '', hallQuery = '';
  ({String file, DutyListResult result})? upload;
  ({String label, int staff, int halls, int inactiveStaff, int inactiveHalls})? copied;

  List<Staff> get visibleUsers => users.where((u) => matchesSearch(query, [u.name, u.staffId])).toList();
  List<Hall> get visibleHalls => halls.where((h) => matchesSearch(hallQuery, [h.hallCode, h.block])).toList();
  Map<String, List<Staff>> get byDept {
    final m = <String, List<Staff>>{};
    for (final u in visibleUsers) {
      m.putIfAbsent(u.departmentName ?? 'Other', () => []).add(u);
    }
    return m;
  }

  SelectionSource? get previous => previousSelectionSource(sources, id: session.id, cycleId: session.cycleId, examDate: session.examDate, sessionType: session.sessionType);
  ({SelectionSource? draft, List<({int cycleId, String cycleName, List<SelectionSource> sessions})> batches}) get groups =>
      selectionSourceGroups(sources, id: session.id, cycleId: session.cycleId, status: session.status);

  String sourceLabel(SelectionSource s) =>
      s.id == session.id ? "this session's current draft" : '${formatDateWithDay(s.examDate)} · ${s.sessionType}${s.cycleId == session.cycleId ? '' : ' (${s.cycleName})'}';

  void setQuery(String q) {
    query = q;
    notifyListeners();
  }

  void setHallQuery(String q) {
    hallQuery = q;
    notifyListeners();
  }

  void toggleUser(int id) {
    selUsers.contains(id) ? selUsers.remove(id) : selUsers.add(id);
    notifyListeners();
  }

  void toggleHall(int id) {
    selHalls.contains(id) ? selHalls.remove(id) : selHalls.add(id);
    notifyListeners();
  }

  void toggleAll(List<Staff> list) {
    final ids = list.map((u) => u.id).toList();
    if (ids.every(selUsers.contains)) {
      selUsers.removeWhere(ids.contains);
    } else {
      for (final id in ids) {
        if (!selUsers.contains(id)) selUsers.add(id);
      }
    }
    notifyListeners();
  }

  void toggleShownHalls() {
    final ids = visibleHalls.map((h) => h.id).toList();
    if (ids.every(selHalls.contains)) {
      selHalls.removeWhere(ids.contains);
    } else {
      for (final id in ids) {
        if (!selHalls.contains(id)) selHalls.add(id);
      }
    }
    notifyListeners();
  }

  void selectAllHalls() {
    selHalls
      ..clear()
      ..addAll(halls.map((h) => h.id));
    notifyListeners();
  }

  void clearUsers() {
    selUsers.clear();
    notifyListeners();
  }

  void clearHalls() {
    selHalls.clear();
    notifyListeners();
  }

  void dismissUpload() {
    upload = null;
    notifyListeners();
  }

  void dismissCopied() {
    copied = null;
    notifyListeners();
  }

  /// Copies only which staff and halls are ticked, never who had which hall.
  Outcome copyFrom(SelectionSource s) {
    final rows = services.allocation.sessionAllocation(s.id).map((a) => (userId: a.userId, hallId: a.hallId)).toList();
    final sel = selectionFromAllocation(rows, users.map((u) => u.id), halls.map((h) => h.id));
    if (sel.userIds.isEmpty) return const Outcome.err('None of the staff from that session are active any more.');
    selUsers
      ..clear()
      ..addAll(sel.userIds);
    selHalls
      ..clear()
      ..addAll(sel.hallIds);
    query = '';
    hallQuery = '';
    upload = null;
    copied = (label: sourceLabel(s), staff: sel.userIds.length, halls: sel.hallIds.length, inactiveStaff: sel.inactiveStaff, inactiveHalls: sel.inactiveHalls);
    notifyListeners();
    return Outcome('Copied from ${sourceLabel(s)}.');
  }

  Future<Outcome?> uploadDutyList() async {
    final sheet = await services.files.pickSheet();
    if (sheet == null) return null;
    final result = readDutyList(sheet.rows, users.map((u) => (id: u.id, staffId: u.staffId, name: u.name)).toList(), halls.map((h) => (id: h.id, hallCode: h.hallCode)).toList());
    Outcome out;
    if (result.userIds.isEmpty) {
      out = const Outcome.err('No invigilators from this file match the active staff list.');
    } else {
      selUsers
        ..clear()
        ..addAll(result.userIds);
      if (result.hasHallColumn) {
        selHalls
          ..clear()
          ..addAll(result.hallIds);
        hallQuery = '';
      }
      query = '';
      out = Outcome('${result.userIds.length} invigilator(s) selected from the file.');
    }
    upload = (file: sheet.name, result: result);
    copied = null;
    notifyListeners();
    return out;
  }

  List<String> get uploadIssues => upload == null
      ? const []
      : [
          ...upload!.result.notFound.map((v) => '$v: not found among active staff'),
          ...upload!.result.ambiguous.map((v) => '$v: more than one staff member has this name, use Staff IDs'),
          ...upload!.result.duplicates.map((v) => '$v: listed more than once'),
          ...upload!.result.hallsNotFound.map((v) => 'Hall $v: not found among active halls'),
        ];

  Future<String?> downloadTemplate() => services.files.saveTemplate(
        'HIAS-Duty-List-Template.xlsx',
        'Duty List',
        [
          ['Staff ID', 'Name', 'Department', 'Hall'],
          ...users.map((u) => [u.staffId, u.name, u.departmentCode ?? u.departmentName ?? '', ''])
        ],
        widths: [12, 28, 14, 10],
      );

  bool get canSubmit => selUsers.isNotEmpty && selUsers.length == selHalls.length;
}
