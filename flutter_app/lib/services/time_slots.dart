import '../core/database.dart';
import '../models/domain/session_rules.dart';

/// Another session that is at the same time as a given slot (same date, overlapping times).
class SessionAtSameTime {
  final int id, cycleId;
  final String cycleName, examDate, sessionType;
  final SessionSlot slot;
  const SessionAtSameTime({required this.id, required this.cycleId, required this.cycleName, required this.examDate, required this.sessionType, required this.slot});

  /// "November Series, 2026-11-03 FN 09:30-13:00".
  String get text => '$cycleName, ${slot.text}';
}

/// The sessions of every batch that clash with [slot] (see [SessionSlot.clashesWith]), except [exceptId].
/// With [withSeating] only those that already have students seated.
List<SessionAtSameTime> sessionsAtSameTime(AppDatabase db, SessionSlot slot, {int exceptId = 0, bool withSeating = false, int? inCycle, int? notInCycle}) {
  final rows = db.query(
      '''SELECT es.id, es.cycle_id, ec.name AS cycle_name, es.exam_date, es.session_type, es.reporting_time, es.exam_start, es.exam_end
         FROM exam_sessions es JOIN exam_cycles ec ON ec.id = es.cycle_id
         WHERE es.exam_date = ? AND es.id != ?
           ${inCycle == null ? '' : 'AND es.cycle_id = $inCycle'} ${notInCycle == null ? '' : 'AND es.cycle_id != $notInCycle'}
           ${withSeating ? 'AND EXISTS (SELECT 1 FROM seat_allocations sa WHERE sa.session_id = es.id)' : ''}
         ORDER BY es.session_type, es.id''',
      [slot.date, exceptId]);
  final out = <SessionAtSameTime>[];
  for (final r in rows) {
    final other = SessionSlot(date: asStr(r['exam_date']), type: asStr(r['session_type']), from: asStrOrNull(r['reporting_time']) ?? asStrOrNull(r['exam_start']), to: asStrOrNull(r['exam_end']));
    if (!slot.clashesWith(other)) continue;
    out.add(SessionAtSameTime(id: asInt(r['id']), cycleId: asInt(r['cycle_id']), cycleName: asStr(r['cycle_name']), examDate: other.date, sessionType: other.type, slot: other));
  }
  return out;
}
