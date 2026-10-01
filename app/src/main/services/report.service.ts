import { db } from "../db/database"

export function getStaffWiseReport(userId?: number, fromYear?: string, toYear?: string) {
  let sql = `SELECT u.staff_id, u.name as staffName, d.name as deptName, d.code as deptCode,
    es.exam_date, es.session_type, ec.academic_year,
    h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor,
    es.reporting_time, es.exam_start, es.exam_end,
    a.is_manually_edited, ec.name as cycleName
  FROM allocations a
  JOIN users u ON a.user_id = u.id
  JOIN halls h ON a.hall_id = h.id
  JOIN exam_sessions es ON a.session_id = es.id
  JOIN exam_cycles ec ON es.cycle_id = ec.id
  LEFT JOIN departments d ON u.department_id = d.id
  WHERE es.status IN ('confirmed','published')`
  const params: any[] = []
  if (userId) { sql += ` AND a.user_id = ?`; params.push(userId) }
  if (fromYear) { sql += ` AND ec.academic_year >= ?`; params.push(fromYear) }
  if (toYear) { sql += ` AND ec.academic_year <= ?`; params.push(toYear) }
  sql += ` ORDER BY u.name, es.exam_date, CASE es.session_type WHEN 'FN' THEN 0 ELSE 1 END`
  return db.query(sql, params)
}

export function getDateWiseReport(sessionId: number) {
  return db.query(
    `SELECT h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor, h.capacity,
            u.staff_id, u.name as staffName, u.designation,
            d.name as deptName, d.code as deptCode,
            es.exam_date, es.session_type, es.reporting_time, es.exam_start, es.exam_end,
            a.is_manually_edited
     FROM allocations a
     JOIN users u ON a.user_id = u.id
     JOIN halls h ON a.hall_id = h.id
     JOIN exam_sessions es ON a.session_id = es.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE a.session_id = ?
     ORDER BY h.sort_order, h.id`, [sessionId]
  )
}

export function getCompleteTimetable(cycleId: number) {
  // Chronological: by date, then Forenoon before Afternoon (plain ORDER BY session_type
  // would put "AN" first).
  const sessions = db.query(
    "SELECT * FROM exam_sessions WHERE cycle_id = ? AND status != 'pending' ORDER BY exam_date, CASE session_type WHEN 'FN' THEN 0 ELSE 1 END",
    [cycleId]
  )
  const allocations = db.query(
    "SELECT a.user_id, a.hall_id, a.session_id, a.is_manually_edited FROM allocations a JOIN exam_sessions es ON a.session_id = es.id WHERE es.cycle_id = ?", [cycleId]
  )
  // Invigilators only (not the admin account).
  const users = db.query(
    "SELECT u.id, u.staff_id, u.name, d.name as deptName, d.code as deptCode FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.is_active = 1 AND u.role = 'staff' ORDER BY d.code COLLATE NOCASE, u.name"
  )
  const halls = db.query("SELECT * FROM halls WHERE is_active = 1 ORDER BY sort_order, id")
  return { sessions, allocations, users, halls }
}

export function getRotationAuditReport(cycleId: number) {
  return db.query(
    `SELECT u.staff_id, u.name as staffName, d.code as deptCode,
            es.exam_date, es.session_type,
            h.hall_code as assignedHall,
            gh.hall_code as generatedHall,
            a.is_manually_edited, a.edit_reason
     FROM allocations a
     JOIN users u ON a.user_id = u.id
     JOIN halls h ON a.hall_id = h.id
     LEFT JOIN halls gh ON a.generated_hall_id = gh.id
     JOIN exam_sessions es ON a.session_id = es.id
     LEFT JOIN departments d ON u.department_id = d.id
     WHERE es.cycle_id = ?
     ORDER BY es.exam_date, CASE es.session_type WHEN 'FN' THEN 0 ELSE 1 END, u.name`, [cycleId]
  )
}
