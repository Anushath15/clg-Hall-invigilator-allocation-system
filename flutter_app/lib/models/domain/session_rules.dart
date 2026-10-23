import 'assignment.dart';

/// Small session rules shared by the services and the screens: rotation order of sessions (R4),
/// manual edit as a swap, and "copy selection from a previous session".

bool isConfirmedStatus(String status) => status == 'confirmed' || status == 'published';

int _slot(String type) => type == 'FN' ? 0 : 1;

class SessionOrderRow {
  final int id, rotationStep;
  final String examDate, sessionType, status;
  const SessionOrderRow({required this.id, required this.examDate, required this.sessionType, required this.rotationStep, required this.status});
}

/// The rotation_step changes that put a batch's unconfirmed sessions into date order after its confirmed ones.
List<({int id, int rotationStep})> unconfirmedStepChanges(List<SessionOrderRow> sessions) {
  var step = sessions.where((s) => isConfirmedStatus(s.status)).fold<int>(0, (m, s) => s.rotationStep > m ? s.rotationStep : m);
  final open = sessions.where((s) => !isConfirmedStatus(s.status)).toList()
    ..sort((a, b) {
      final c = a.examDate.compareTo(b.examDate);
      if (c != 0) return c;
      final s = _slot(a.sessionType) - _slot(b.sessionType);
      if (s != 0) return s;
      final r = a.rotationStep - b.rotationStep;
      return r != 0 ? r : a.id - b.id;
    });
  final out = <({int id, int rotationStep})>[];
  for (final s in open) {
    step++;
    if (s.rotationStep != step) out.add((id: s.id, rotationStep: step));
  }
  return out;
}

class SwapPlan {
  final int? fromHallId; // A's current hall, which B receives
  final int? partnerUserId; // B, who holds the target hall (null: a plain move)
  final bool selfRepeat, partnerRepeat;
  const SwapPlan(this.fromHallId, this.partnerUserId, this.selfRepeat, this.partnerRepeat);
}

/// R1 for both people in "give [userId] the hall [targetHallId]", over the session's hall pool.
SwapPlan planSwap(List<({int userId, int hallId})> entries, int userId, int targetHallId, List<int> pool, HallHistory historyOf) {
  final mine = entries.where((e) => e.userId == userId).firstOrNull;
  final partner = entries.where((e) => e.hallId == targetHallId && e.userId != userId).firstOrNull;
  return SwapPlan(
    mine?.hallId,
    partner?.userId,
    visitedThisCycle(historyOf(userId), pool).contains(targetHallId),
    partner != null && mine != null ? visitedThisCycle(historyOf(partner.userId), pool).contains(mine.hallId) : false,
  );
}

class SelectionSource {
  final int id, cycleId, staffCount;
  final String cycleName, examDate, sessionType, status;
  const SelectionSource({required this.id, required this.cycleId, required this.cycleName, required this.examDate, required this.sessionType, required this.status, required this.staffCount});
}

int _compareTime(String ad, String at, String bd, String bt) {
  final c = ad.compareTo(bd);
  return c != 0 ? c : _slot(at) - _slot(bt);
}

/// The nearest earlier session in the same batch; else the latest earlier session of any batch.
SelectionSource? previousSelectionSource(List<SelectionSource> sources, {required int id, required int cycleId, required String examDate, required String sessionType}) {
  final earlier = sources.where((s) => s.id != id && _compareTime(s.examDate, s.sessionType, examDate, sessionType) < 0).toList()
    ..sort((a, b) {
      final c = _compareTime(b.examDate, b.sessionType, a.examDate, a.sessionType);
      return c != 0 ? c : b.id - a.id;
    });
  return earlier.where((s) => s.cycleId == cycleId).firstOrNull ?? earlier.firstOrNull;
}

/// The picker: this session's own draft first, then this batch's sessions, then other batches, newest first.
({SelectionSource? draft, List<({int cycleId, String cycleName, List<SelectionSource> sessions})> batches}) selectionSourceGroups(
    List<SelectionSource> sources,
    {required int id, required int cycleId, required String status}) {
  final draft = status == 'draft' ? sources.where((s) => s.id == id).firstOrNull : null;
  final others = sources.where((s) => s.id != id).toList()
    ..sort((a, b) {
      final c = _compareTime(b.examDate, b.sessionType, a.examDate, a.sessionType);
      return c != 0 ? c : b.id - a.id;
    });
  final batches = <({int cycleId, String cycleName, List<SelectionSource> sessions})>[];
  for (final s in others) {
    var g = batches.where((b) => b.cycleId == s.cycleId).firstOrNull;
    if (g == null) {
      g = (cycleId: s.cycleId, cycleName: s.cycleName, sessions: <SelectionSource>[]);
      batches.add(g);
    }
    g.sessions.add(s);
  }
  // This batch first (stable for the rest).
  final mine = batches.where((b) => b.cycleId == cycleId).toList();
  final rest = batches.where((b) => b.cycleId != cycleId).toList();
  return (draft: draft, batches: [...mine, ...rest]);
}

/// The ticks to copy from a session's allocation rows: only staff and halls still active. Pairings are dropped.
({List<int> userIds, List<int> hallIds, int inactiveStaff, int inactiveHalls}) selectionFromAllocation(
    List<({int userId, int hallId})> rows, Iterable<int> activeUserIds, Iterable<int> activeHallIds) {
  final users = activeUserIds.toSet(), halls = activeHallIds.toSet();
  final su = rows.map((r) => r.userId).toSet().toList(), sh = rows.map((r) => r.hallId).toSet().toList();
  return (
    userIds: su.where(users.contains).toList()..sort(),
    hallIds: sh.where(halls.contains).toList()..sort(),
    inactiveStaff: su.where((id) => !users.contains(id)).length,
    inactiveHalls: sh.where((id) => !halls.contains(id)).length,
  );
}

/// When a session needs people and halls: its date and the time from reporting (else exam start) to exam end.
///
/// FN and AN of one date, and sessions of different dates, are separate: their allocations never touch each other.
/// Two sessions clash only when they are on the same date and their times overlap (or, when a session has no times,
/// when they are the same FN/AN slot). A student cannot write two exams at once, and a hall cannot hold two.
class SessionSlot {
  final String date, type;
  final String? from, to;
  const SessionSlot({required this.date, required this.type, this.from, this.to});

  bool get hasTimes => (from ?? '').isNotEmpty && (to ?? '').isNotEmpty;

  bool clashesWith(SessionSlot o) {
    if (date != o.date) return false;
    if (hasTimes && o.hasTimes) return from!.compareTo(o.to!) < 0 && o.from!.compareTo(to!) < 0;
    return type == o.type;
  }

  /// "2026-11-03 FN 09:30-13:00".
  String get text => '$date $type${hasTimes ? ' $from-$to' : ''}';
}
