import '../core/database.dart';
import '../models/entities.dart';

class TimetableData {
  final List<ExamSession> sessions;
  final List<({int userId, int hallId, int sessionId, bool edited})> allocations;
  final List<({int id, String staffId, String name, String? deptName, String? deptCode})> users;
  final Map<int, String> hallCodes;
  const TimetableData(this.sessions, this.allocations, this.users, this.hallCodes);
  List<ExamSession> get confirmedSessions => sessions.where((s) => s.isConfirmed).toList();
}

/// The four reports. Each returns rows ready for the table on screen and the PDF.
class ReportService {
  ReportService(this.db);
  final AppDatabase db;

  List<DbRow> staffWise({int? userId, String? fromYear, String? toYear}) {
    var sql = '''SELECT u.staff_id, u.name as staffName, d.name as deptName, d.code as deptCode, es.exam_date, es.session_type, ec.academic_year,
      h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor, es.reporting_time, es.exam_start, es.exam_end,
      a.is_manually_edited, ec.name as cycleName
      FROM allocations a JOIN users u ON a.user_id = u.id JOIN halls h ON a.hall_id = h.id JOIN exam_sessions es ON a.session_id = es.id
      JOIN exam_cycles ec ON es.cycle_id = ec.id LEFT JOIN departments d ON u.department_id = d.id
      WHERE es.status IN ('confirmed','published')''';
    final p = <Object?>[];
    if (userId != null) {
      sql += ' AND a.user_id = ?';
      p.add(userId);
    }
    if (fromYear != null) {
      sql += ' AND ec.academic_year >= ?';
      p.add(fromYear);
    }
    if (toYear != null) {
      sql += ' AND ec.academic_year <= ?';
      p.add(toYear);
    }
    return db.query("$sql ORDER BY u.name, es.exam_date, CASE es.session_type WHEN 'FN' THEN 0 ELSE 1 END", p);
  }

  List<DbRow> dateWise(int sessionId) => db.query('''SELECT h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor, h.capacity,
        u.staff_id, u.name as staffName, u.designation, d.name as deptName, d.code as deptCode,
        es.exam_date, es.session_type, es.reporting_time, es.exam_start, es.exam_end, a.is_manually_edited
     FROM allocations a JOIN users u ON a.user_id = u.id JOIN halls h ON a.hall_id = h.id JOIN exam_sessions es ON a.session_id = es.id
     LEFT JOIN departments d ON u.department_id = d.id WHERE a.session_id = ? ORDER BY h.sort_order, h.id''', [sessionId]);

  TimetableData timetable(int cycleId) {
    final sessions = db
        .query("SELECT * FROM exam_sessions WHERE cycle_id = ? AND status != 'pending' ORDER BY exam_date, CASE session_type WHEN 'FN' THEN 0 ELSE 1 END", [cycleId])
        .map(ExamSession.fromRow)
        .toList();
    final allocations = db
        .query('SELECT a.user_id, a.hall_id, a.session_id, a.is_manually_edited FROM allocations a JOIN exam_sessions es ON a.session_id = es.id WHERE es.cycle_id = ?', [cycleId])
        .map((r) => (userId: asInt(r['user_id']), hallId: asInt(r['hall_id']), sessionId: asInt(r['session_id']), edited: asBool(r['is_manually_edited'])))
        .toList();
    final users = db
        .query("SELECT u.id, u.staff_id, u.name, d.name as deptName, d.code as deptCode FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.is_active = 1 AND u.role = 'staff' ORDER BY d.code COLLATE NOCASE, u.name")
        .map((r) => (id: asInt(r['id']), staffId: asStr(r['staff_id']), name: asStr(r['name']), deptName: asStrOrNull(r['deptName']), deptCode: asStrOrNull(r['deptCode'])))
        .toList();
    final halls = {for (final h in db.query('SELECT id, hall_code FROM halls')) asInt(h['id']): asStr(h['hall_code'])};
    return TimetableData(sessions, allocations, users, halls);
  }

  List<DbRow> audit(int cycleId) => db.query('''SELECT u.staff_id, u.name as staffName, d.code as deptCode, es.exam_date, es.session_type,
        h.hall_code as assignedHall, gh.hall_code as generatedHall, a.is_manually_edited, a.edit_reason
     FROM allocations a JOIN users u ON a.user_id = u.id JOIN halls h ON a.hall_id = h.id LEFT JOIN halls gh ON a.generated_hall_id = gh.id
     JOIN exam_sessions es ON a.session_id = es.id LEFT JOIN departments d ON u.department_id = d.id
     WHERE es.cycle_id = ? ORDER BY es.exam_date, CASE es.session_type WHEN 'FN' THEN 0 ELSE 1 END, u.name''', [cycleId]);
}
