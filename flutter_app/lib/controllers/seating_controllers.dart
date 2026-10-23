import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../core/format.dart';
import '../models/domain/categories.dart';
import '../models/domain/hall_layout.dart';
import '../models/domain/list_readers.dart';
import '../models/domain/seating.dart';
import '../models/domain/seating_report.dart';
import '../models/entities.dart';
import '../services/app_services.dart';
import '../services/student_service.dart';
import '../services/subject_service.dart';
import 'workspace_controller.dart';

/// The Student Seating tab of one session: the saved seats, each hall, conflicts, copy / clear / export.
class SeatingPanelController extends ChangeNotifier {
  SeatingPanelController(this.services, this.cycle, this.session, this.allocation) {
    load();
  }
  final AppServices services;
  final ExamCycle? cycle;
  final ExamSession session;
  final List<AllocationRow> allocation;

  List<SeatRow> seats = [];
  List<Hall> halls = [];
  SavedSeating? saved;
  List<SeatingSelection> others = [];
  List<SubjectConflictRow> conflicts = [];
  List<String> warnings = [];
  bool loading = false;
  String find = '';

  void load() {
    seats = services.students.sessionSeating(session.id);
    halls = services.master.halls();
    saved = services.students.savedSeating(session.id);
    others = services.students.selections().where((o) => o.id != session.id).toList();
    conflicts = services.subjects.conflicts(session.id);
    notifyListeners();
  }

  bool get confirmed => session.isConfirmed;

  List<SeatingHallInfo> get sessionHalls {
    final ids = allocation.map((a) => a.hallId).toSet();
    return halls
        .where((h) => ids.contains(h.id))
        .map((h) => SeatingHallInfo(
              id: h.id,
              hallCode: h.hallCode,
              block: h.block,
              floor: h.floor,
              invigilators: allocation.where((a) => a.hallId == h.id).map((a) => a.userName).toList(),
              layout: h.layout,
            ))
        .toList();
  }

  int get totalSeats => sessionHalls.fold(0, (n, h) => n + h.seats);
  List<SeatRow> seatsIn(int hallId) => seats.where((s) => s.hallId == hallId).toList();

  /// The group a hall holds: its students', else the saved settings'.
  String? genderOf(int hallId) {
    final inHall = seatsIn(hallId);
    if (inHall.isNotEmpty) return inHall.map((s) => s.gender).toSet().length > 1 ? 'mixed' : inHall.first.gender;
    final c = saved?.config.halls.where((h) => h.hallId == hallId).firstOrNull;
    return c == null ? null : patternGroup(c.pattern);
  }

  List<UnallocatedStudent> get unallocated => saved?.unallocated ?? const [];
  List<int> get selectedIds => (saved?.studentIds.isNotEmpty ?? false) ? saved!.studentIds : seats.map((s) => s.studentId).toList();
  List<String> get colorKeys => seats.map((s) => s.colorKey).toSet().toList()..sort();

  bool _isBefore(SeatingSelection o) =>
      o.examDate.compareTo(session.examDate) < 0 || (o.examDate == session.examDate && o.sessionType == 'FN' && session.sessionType == 'AN');
  bool get anyEarlier => others.any(_isBefore);

  /// The latest earlier session with seating whose halls are exactly this session's.
  SeatingSelection? get previous {
    final here = (allocation.map((a) => a.hallId).toSet().toList()..sort()).join(',');
    return others.where((o) => _isBefore(o) && o.hallIds.join(',') == here).firstOrNull;
  }

  String describe(SeatingSelection s) => '${s.cycleName} · ${formatDateWithDay(s.examDate)} · ${formatSession(s.sessionType)}';

  /// Moves a seated student to another seat by hand (a taken seat swaps the two). Every rule is checked again;
  /// a move that breaks one is refused with its reasons and nothing changes.
  MoveSeatResult moveStudent(int studentId, {required int hallId, required int row, required int col, required String seat}) {
    final r = services.students.moveSeat(session.id, studentId, hallId: hallId, row: row, col: col, seat: seat);
    if (r.success) load();
    return r;
  }

  Outcome copyPrevious() {
    final p = previous;
    if (p == null) return const Outcome.err('No earlier exam has exactly the same halls.');
    final r = services.students.copy(session.id, p.id);
    if (!r.success) return Outcome.err(r.error!);
    warnings = [];
    load();
    return Outcome('Seating copied from ${describe(p)}: ${r.seated} students seated${r.unallocated.isNotEmpty ? ', ${r.unallocated.length} unallocated' : ''}.');
  }

  /// The halls whose seating is locked (they keep their students and seats when the rest is seated again).
  Set<int> get lockedHalls => {for (final id in saved?.config.lockedHalls ?? const <int>[]) if (sessionHalls.any((h) => h.id == id)) id};

  /// The halls that have students: the only ones that can be locked.
  List<int> get hallsWithStudents => [for (final h in sessionHalls) if (seats.any((x) => x.hallId == h.id)) h.id];

  /// Students selected for the session who have no seat and are not in the unallocated list, e.g. because their
  /// hall was taken out of the session.
  int get needSeat {
    final seated = seats.map((x) => x.studentId).toSet(), listed = unallocated.map((u) => u.studentId).toSet();
    return (saved?.studentIds ?? const <int>[]).where((id) => !seated.contains(id) && !listed.contains(id)).length;
  }

  /// Locks or unlocks halls; returns an error message or null.
  String? setLocked(List<int> hallIds, bool locked) {
    final e = services.students.setHallsLocked(session.id, hallIds, locked);
    if (e == null) load();
    return e;
  }

  /// Seats again everyone not in a locked hall, in the halls that are not locked; locked halls stay as they are.
  Outcome regenerateRemaining() {
    final kept = lockedHalls.length;
    final r = services.students.regenerateRemaining(session.id);
    warnings = r.warnings;
    load();
    if (!r.success) return Outcome.err(r.error ?? 'The remaining students could not be seated.');
    return Outcome('${kept == 0 ? 'Everyone' : 'The remaining students'} seated again${kept == 0 ? '' : ' ($kept locked hall${kept == 1 ? '' : 's'} kept as they were)'}: ${r.seated} seated${r.unallocated.isEmpty ? '' : ', ${r.unallocated.length} unallocated'}.');
  }

  void clear() {
    services.students.clear(session.id);
    warnings = [];
    load();
  }

  void onSaved(ConfirmResult r) {
    warnings = r.warnings;
    load();
  }

  void setFind(String q) {
    find = q;
    notifyListeners();
  }

  List<SeatRow> get found {
    final q = find.trim().toLowerCase();
    if (q.isEmpty) return const [];
    return seats.where((s) => [s.rollNo, s.registerNo, s.studentName].any((v) => v.toLowerCase().contains(q))).take(8).toList();
  }

  Future<Outcome?> export(String kind) async {
    final settings = services.master.settings();
    final tag = '${session.examDate}-${session.sessionType}';
    late Uint8List bytes;
    late String name;
    switch (kind) {
      case 'plan':
        bytes = await services.pdf.seatingPlan(cycle: cycle, session: session, halls: sessionHalls, seats: seats, settings: settings);
        name = 'HIAS-Seating-Plan-$tag.pdf';
      case 'attendance':
        bytes = await services.pdf.attendanceSheets(cycle: cycle, session: session, halls: sessionHalls, seats: seats, settings: settings);
        name = 'HIAS-Attendance-$tag.pdf';
      case 'unallocated':
        bytes = await services.pdf.unallocatedList(cycle: cycle, session: session, unallocated: unallocated, settings: settings);
        name = 'HIAS-Unallocated-$tag.pdf';
      default:
        bytes = await services.pdf.studentSeatList(cycle: cycle, session: session, seats: seats, settings: settings);
        name = 'HIAS-Student-Seats-$tag.pdf';
    }
    final path = await services.files.saveBytes(name, ['pdf'], bytes, title: 'Save report');
    return path == null ? null : Outcome('PDF saved to $path');
  }
}

/// "Select Students" for one session.
class StudentSelectorController extends ChangeNotifier {
  StudentSelectorController(this.services, this.session, {required this.academicYear, required this.seats, required List<int> initialIds, List<int> initialSubjectIds = const []}) {
    selected.addAll(initialIds);
    picked.addAll(initialSubjectIds);
    subjects = services.subjects.list().where((s) => s.isActive && s.studentIds.isNotEmpty).toList();
    students = services.students.list(isActive: true);
    final activeIds = students.map((s) => s.id).toSet();
    selected.removeWhere((id) => !activeIds.contains(id));
    sources = services.students.selections().where((x) => x.id != session.id).toList();
  }
  final AppServices services;
  final ExamSession session;
  final String? academicYear;
  final int seats;
  late final List<Student> students;
  late final List<Subject> subjects;
  late final List<SeatingSelection> sources;
  final Set<int> selected = {};
  final List<int> picked = [];
  final Set<String> open = {};
  String query = '';
  List<String>? uploadNote;

  /// How students are picked: by subject, by class, or one by one.
  int tab = 0;
  String subjectQuery = '', classQuery = '';

  void setTab(int t) {
    tab = t;
    notifyListeners();
  }

  void setSubjectQuery(String q) {
    subjectQuery = q;
    notifyListeners();
  }

  void setClassQuery(String q) {
    classQuery = q;
    notifyListeners();
  }

  String yearText(String batch) {
    final y = yearOfStudy(batch, academicYear);
    if (y.ok) return y.label;
    if (y.reason.contains('finished')) return 'Course completed';
    if (y.reason.contains('not started')) return 'Not started yet';
    return 'Year unknown';
  }

  Set<int> get _activeIds => students.map((s) => s.id).toSet();

  /// Active students who study a subject.
  List<int> idsOfSubject(Subject sb) => sb.studentIds.where(_activeIds.contains).toList();

  /// Subjects matching the search (code, name or department).
  List<Subject> get shownSubjects => subjects.where((sb) => matchesSearch(subjectQuery, [sb.code, sb.name, sb.departmentCode])).toList();

  /// Classes (department + section + batch) matching the class search, e.g. "CSE A" or "Final".
  List<({String key, String batch, String dept, String section, List<Student> list})> get classGroups {
    final m = <String, List<Student>>{};
    for (final s in students) {
      m.putIfAbsent('${s.batch}|${s.departmentCode ?? '—'}|${s.section}', () => []).add(s);
    }
    final keys = m.keys.toList()..sort(textCompare);
    final out = <({String key, String batch, String dept, String section, List<Student> list})>[];
    for (final k in keys) {
      final p = k.split('|');
      final label = '${p[1]} ${p[2]} ${yearText(p[0])} ${p[0]}';
      final words = classQuery.toLowerCase().split(RegExp(r'\s+')).where((w) => w.isNotEmpty);
      if (!words.every((w) => label.toLowerCase().contains(w))) continue;
      out.add((key: k, batch: p[0], dept: p[1], section: p[2], list: m[k]!..sort((a, b) => naturalCompare(a.rollNo, b.rollNo))));
    }
    return out;
  }

  /// Whether a subject was chosen as one written in this exam. Only what was clicked counts: students
  /// who study several subjects are selected by any of them, but that does not choose the other subjects.
  bool isPicked(Subject sb) => picked.contains(sb.id);

  /// Ticks or unticks a whole subject (its students, and the subject as one written in this exam).
  /// Unticking keeps the students that another chosen subject still needs.
  void setSubject(Subject sb, bool on) {
    if (on) {
      selected.addAll(idsOfSubject(sb));
      if (!picked.contains(sb.id)) picked.add(sb.id);
    } else {
      picked.remove(sb.id);
      final kept = {for (final other in subjects.where((x) => picked.contains(x.id))) ...idsOfSubject(other)};
      selected.removeAll(idsOfSubject(sb).where((id) => !kept.contains(id)));
    }
    notifyListeners();
  }

  List<({String key, String batch, String dept, String section, List<Student> list})> get groups {
    final m = <String, List<Student>>{};
    for (final s in students) {
      if (!matchesSearch(query, [s.rollNo, s.registerNo, s.name])) continue;
      m.putIfAbsent('${s.batch}|${s.departmentCode ?? '—'}|${s.section}', () => []).add(s);
    }
    final keys = m.keys.toList()..sort(textCompare);
    return [
      for (final k in keys)
        (key: k, batch: k.split('|')[0], dept: k.split('|')[1], section: k.split('|')[2], list: (m[k]!..sort((a, b) => naturalCompare(a.rollNo, b.rollNo))))
    ];
  }

  List<String> get batches => students.map((s) => s.batch).toSet().toList()..sort();
  List<int> idsOfBatch(String b) => students.where((s) => s.batch == b).map((s) => s.id).toList();
  bool allOn(List<int> ids) => ids.isNotEmpty && ids.every(selected.contains);
  List<Student> get chosen => students.where((s) => selected.contains(s.id)).toList();

  void setQuery(String q) {
    query = q;
    notifyListeners();
  }

  void setMany(List<int> ids, bool on) {
    on ? selected.addAll(ids) : selected.removeAll(ids);
    notifyListeners();
  }

  void toggleOpen(String k) {
    open.contains(k) ? open.remove(k) : open.add(k);
    notifyListeners();
  }

  void clearAll() {
    selected.clear();
    picked.clear();
    notifyListeners();
  }

  void toggleSubject(Subject sb) {
    final active = students.map((s) => s.id).toSet();
    final ids = sb.studentIds.where(active.contains).toList();
    final on = picked.contains(sb.id);
    setMany(ids, !on);
    on ? picked.remove(sb.id) : picked.add(sb.id);
    notifyListeners();
  }

  Future<Outcome?> uploadList() async {
    final sheet = await services.files.pickSheet();
    if (sheet == null) return null;
    final r = readStudentList(sheet.rows, students.map((s) => (id: s.id, rollNo: s.rollNo, registerNo: s.registerNo)).toList());
    Outcome out;
    if (r.studentIds.isEmpty) {
      out = const Outcome.err('No students in this file match the active student list.');
    } else {
      selected
        ..clear()
        ..addAll(r.studentIds);
      out = Outcome('${r.studentIds.length} student(s) selected from the file.');
    }
    uploadNote = [...r.notFound.map((v) => '$v: not found among active students'), ...r.duplicates.map((v) => '$v: listed more than once')];
    notifyListeners();
    return out;
  }

  Outcome copyFrom(int sessionId) {
    final rows = services.students.sessionSeating(sessionId);
    final active = students.map((s) => s.id).toSet();
    final ids = rows.map((r) => r.studentId).where(active.contains).toList();
    selected
      ..clear()
      ..addAll(ids);
    uploadNote = null;
    notifyListeners();
    return Outcome('${ids.length} student(s) copied${ids.length < rows.length ? ' (${rows.length - ids.length} no longer active)' : ''}.');
  }
}

enum SeatingMethod { rollwise, separate, pattern, custom }

const seatingMethodLabel = {
  SeatingMethod.rollwise: 'Roll number order',
  SeatingMethod.separate: 'Gender based allocation',
  SeatingMethod.pattern: 'Create your own pattern',
  SeatingMethod.custom: 'Custom per hall',
};

/// Seating configuration of one session: each hall's bench pattern, the class limit and the
/// subjects written, with a live preview of the plan; saving re-checks everything.
class SeatingConfigController extends ChangeNotifier {
  SeatingConfigController(this.services, this.session, this.halls, this.studentIds, {List<int>? sessionSubjectIds}) {
    _init(sessionSubjectIds);
  }
  final AppServices services;
  final ExamSession session;
  final List<SeatingHallInfo> halls;
  final List<int> studentIds;

  String? fatal;
  SeatingConfig? autoConfig, separateConfig, rollConfig, config;
  SeatingMethod method = SeatingMethod.separate;
  List<String> sharedPattern = const ['MM', 'FF'];
  ClassLimit classLimit = defaultClassLimit;
  int boys = 0, girls = 0;
  String? shortfall;
  PreviewResult? preview;
  bool previewing = false, saving = false;
  List<UnallocatedStudent>? confirmList;
  Map<String, int> subjects = {};
  List<SessionClass> classes = [];
  List<Subject> subjectList = [];
  List<int> sessionSubjects = [];
  List<({int id, int count})> mappedSubjects = [];
  Timer? _debounce;

  /// Which rules the previewed plan met, relaxed, or could not meet (and which rule stopped which student).
  PlanReport? get report => preview?.report;

  /// Codes of the locked halls: they keep their students, and only the other students are configured.
  List<String> get lockedHallCodes {
    final locked = services.students.savedSeating(session.id)?.config.lockedHalls ?? const <int>[];
    return [for (final h in halls) if (locked.contains(h.id)) h.hallCode];
  }

  List<SeatHall> get seatHalls => halls.map((h) => SeatHall(h.id, h.hallCode, h.layout)).toList();
  SeatingHallInfo hallOf(int id) => halls.firstWhere((h) => h.id == id);

  void _init(List<int>? sessionSubjectIds) {
    subjectList = services.subjects.list().where((s) => s.isActive).toList();
    final saved = services.students.savedSeating(session.id);
    classLimit = normalizeClassLimit(saved?.config.classLimit);
    final given = saved?.config.subjects ?? {};
    final written = sessionSubjectIds ?? saved?.config.sessionSubjects ?? [];
    final auto = services.students.autoConfigureSeating(session.id, studentIds, classLimit: classLimit, subjects: given, sessionSubjects: written);
    if (!auto.success) {
      fatal = auto.error;
      return;
    }
    subjects = {for (final e in given.entries) if (auto.classes.any((c) => c.key == e.key)) e.key: e.value};
    sessionSubjects = [...written];
    _applyAuto(auto);
    mappedSubjects = auto.mappedSubjects;
    boys = auto.boys;
    girls = auto.girls;
    final sameStudents = saved != null && saved.studentIds.length == studentIds.length && studentIds.every(saved.studentIds.contains);
    final usable = sameStudents && saved.unallocated.isEmpty && normalizeConfig(saved.config, seatHalls).halls.any((h) => h.pattern.isNotEmpty);
    final start = usable ? normalizeConfig(saved.config, seatHalls) : auto.config!;
    final m = methodOf(start);
    method = m.method;
    sharedPattern = m.pattern;
    config = start;
    _schedulePreview();
  }

  void _applyAuto(AutoConfigResult auto) {
    classes = auto.classes;
    autoConfig = auto.config;
    separateConfig = auto.separateConfig;
    rollConfig = auto.rollConfig;
    shortfall = auto.shortfall;
  }

  static ({SeatingMethod method, List<String> pattern}) methodOf(SeatingConfig c) {
    final used = c.halls.where((h) => h.pattern.isNotEmpty).toList();
    if (c.mixGenders) return (method: SeatingMethod.rollwise, pattern: const ['MM', 'FF']);
    if (used.every((h) => h.pattern.length == 1)) return (method: SeatingMethod.separate, pattern: const ['MM', 'FF']);
    if (used.every((h) => listEquals(h.pattern, used.first.pattern))) return (method: SeatingMethod.pattern, pattern: used.first.pattern);
    return (method: SeatingMethod.custom, pattern: const ['MM', 'FF']);
  }

  /// Works out the automatic settings again (after the class limit or subjects changed).
  void _reauto() {
    final auto = services.students.autoConfigureSeating(session.id, studentIds, classLimit: classLimit, subjects: subjects, sessionSubjects: sessionSubjects);
    if (auto.success) _applyAuto(auto);
  }

  void _schedulePreview() {
    previewing = true;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 200), () {
      if (config == null) return;
      final r = services.students.preview(session.id, studentIds, config!.copyWith(classLimit: classLimit, subjects: subjects, sessionSubjects: sessionSubjects));
      preview = r.success ? r : null;
      previewing = false;
      notifyListeners();
    });
    notifyListeners();
  }

  SeatingConfig autoFor(SeatingMethod m, [List<String>? pattern]) => switch (m) {
        SeatingMethod.separate => separateConfig!,
        SeatingMethod.pattern => configureWithPattern({'M': boys, 'F': girls}, seatHalls, pattern ?? sharedPattern),
        SeatingMethod.rollwise => rollConfig!,
        SeatingMethod.custom => autoConfig!,
      };

  void chooseMethod(SeatingMethod m) {
    if (m == method) return;
    method = m;
    if (m != SeatingMethod.custom) {
      config = autoFor(m);
    } else if (config!.mixGenders) {
      config = autoConfig;
    }
    _schedulePreview();
  }

  void changeSharedPattern(List<String> p) {
    sharedPattern = p;
    config = config!.copyWith(halls: config!.halls.map((h) => h.pattern.isNotEmpty ? HallSeatingConfig(h.hallId, p) : h).toList());
    _schedulePreview();
  }

  void setPattern(int hallId, List<String> pattern) {
    config = config!.copyWith(halls: config!.halls.map((h) => h.hallId == hallId ? HallSeatingConfig(hallId, pattern) : h).toList());
    _schedulePreview();
  }

  void setClassLimit(ClassLimit l) {
    classLimit = normalizeClassLimit(l);
    _reauto();
    _schedulePreview();
  }

  void setSubjects(Map<String, int> s) {
    subjects = s;
    _reauto();
    _schedulePreview();
  }

  void toggleSessionSubject(int id) {
    sessionSubjects = sessionSubjects.contains(id) ? sessionSubjects.where((x) => x != id).toList() : [...sessionSubjects, id];
    _reauto();
    _schedulePreview();
  }

  void autoAssign() {
    config = autoFor(method);
    _schedulePreview();
  }

  void seatEveryone() {
    final m = methodOf(autoConfig!);
    method = m.method;
    if (m.method == SeatingMethod.pattern) sharedPattern = m.pattern;
    config = autoConfig;
    _schedulePreview();
  }

  int get totalSeats => config!.halls.fold(0, (n, h) => n + (h.pattern.isNotEmpty ? hallOf(h.hallId).seats : 0));
  int seatsFor(String g) => config!.halls.fold(0, (n, h) => n + patternSeats(h.pattern, hallOf(h.hallId).benchList)[g]!);

  SeatingPlan? get plan => preview?.plan;
  List<String> get errors => preview?.errors ?? const [];
  List<String> get warnings => preview?.warnings ?? const [];
  List<UnallocatedStudent> get unallocated => plan?.unallocated ?? const [];

  /// The preview's seats of a hall, as seat rows for the bench grid.
  List<SeatRow> previewSeats(int hallId) {
    final byId = {for (final s in preview?.students ?? const <PlanStudent>[]) s.id: s};
    return (plan?.seats ?? const <Seat>[]).where((s) => s.hallId == hallId).map((s) {
      final st = byId[s.studentId];
      return SeatRow(
          studentId: s.studentId, rollNo: st?.rollNo ?? '', studentName: st?.name ?? '', gender: st?.gender ?? 'M', batch: st?.batch ?? '', deptCode: st?.deptCode,
          year: st?.year, category: st?.category, hallId: s.hallId, hallCode: hallOf(s.hallId).hallCode, benchRow: s.row, benchCol: s.col, benchNo: s.benchNo, seat: s.seat);
    }).toList();
  }

  List<String> get previewColorKeys => (preview?.students ?? const <PlanStudent>[]).map((s) => s.category.isNotEmpty ? s.category : (s.year.isNotEmpty ? s.year : s.batch)).toSet().toList()..sort();

  bool get canSave => plan != null && errors.isEmpty && !previewing && !saving && plan!.seats.isNotEmpty;

  /// Saves; when some students would be left out the list is shown first (confirmList).
  ConfirmResult? save({required bool acceptUnallocated}) {
    if (!acceptUnallocated && unallocated.isNotEmpty) {
      confirmList = unallocated;
      notifyListeners();
      return null;
    }
    saving = true;
    notifyListeners();
    try {
      final r = services.students.confirm(session.id, studentIds, config!.copyWith(classLimit: classLimit, subjects: subjects, sessionSubjects: sessionSubjects), acceptUnallocated: acceptUnallocated);
      if (r.needsConfirmation) {
        confirmList = r.unallocated;
        return null;
      }
      if (r.success) confirmList = null;
      return r;
    } finally {
      saving = false;
      notifyListeners();
    }
  }

  void cancelConfirm() {
    confirmList = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }
}

/// The hall seating modes offered on a hall card.
class HallMode {
  final String? group;
  final String label;
  final List<String> pattern;
  const HallMode(this.group, this.label, this.pattern);
}

const hallModes = [
  HallMode('M', 'Boys', ['MM']),
  HallMode('F', 'Girls', ['FF']),
  HallMode('mixed', 'Boys & Girls', ['MM', 'FF']),
  HallMode(null, 'Not used', []),
];

/// Seats of a hall layout for display.
String hallKinds(HallLayout l) => kindSummary(l);
