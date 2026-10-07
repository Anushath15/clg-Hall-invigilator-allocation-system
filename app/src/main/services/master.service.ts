/**
 * MASTER DATA: departments and the staff list.
 * Department codes are saved exactly as typed but treated case-insensitively: "CSE" and
 * "cse" are the same department (a second one is refused), lookups ignore case, and lists
 * sort by code ignoring case. The UNIQUE constraint on departments.code is case-sensitive,
 * so the check lives here rather than in the schema; existing databases need no migration.
 */
import { db } from "../db/database"
import { todayLocal, timeNowLocal } from "../../shared/session-dates"
import { validateStaff, validateDepartmentCode, validateDepartmentName, validateHallPlace } from "../../shared/validation"

export interface DepartmentInput { id?: number; code: string; name: string; is_active?: boolean }

export function saveDepartment(data: DepartmentInput): { success: boolean; error?: string; department?: any } {
  if (!String(data?.code ?? "").trim() || !String(data?.name ?? "").trim()) return { success: false, error: "Code and Name are required." }
  const problem = validateDepartmentCode(data.code) ?? validateDepartmentName(data.name)
  if (problem) return { success: false, error: problem }
  const clash = db.queryOne<any>("SELECT code FROM departments WHERE code = ? COLLATE NOCASE AND id != ?", [data.code, data.id ?? 0])
  if (clash) return { success: false, error: `A department with code "${clash.code}" already exists (codes are not case-sensitive).` }
  if (data.id) {
    db.run("UPDATE departments SET code=?,name=?,is_active=? WHERE id=?", [data.code, data.name, data.is_active ? 1 : 0, data.id])
    return { success: true, department: db.queryOne("SELECT * FROM departments WHERE id=?", [data.id]) }
  }
  const { lastInsertRowid } = db.run("INSERT INTO departments(code,name) VALUES(?,?)", [data.code, data.name])
  return { success: true, department: db.queryOne("SELECT * FROM departments WHERE id=?", [lastInsertRowid]) }
}

export interface StaffInput { id?: number; staff_id: string; name: string; email?: string | null; designation?: string | null; role?: string; department_id?: number | null; is_active?: boolean }

/**
 * Add or edit a staff member (an invigilator record; nobody signs in). Fields follow shared/validation.ts;
 * a Staff ID is unique ignoring letter case. Returns the saved record, or { success: false, error }.
 */
export function saveUser(data: StaffInput): any {
  const problem = validateStaff(data)
  if (problem) return { success: false, error: problem }
  const staffId = String(data.staff_id).trim(), name = String(data.name).trim()
  const email = String(data.email ?? "").trim() || null, designation = String(data.designation ?? "").trim() || null
  const clash = db.queryOne<any>("SELECT staff_id, name FROM users WHERE staff_id = ? COLLATE NOCASE AND id != ?", [staffId, data.id ?? 0])
  if (clash) return { success: false, error: `Staff ID ${clash.staff_id} is already used by ${clash.name}. Each Staff ID can be used only once.` }
  if (data.id) {
    db.run(`UPDATE users SET staff_id=?,name=?,email=?,designation=?,role=?,department_id=?,is_active=?,updated_at=datetime('now') WHERE id=?`,
      [staffId, name, email, designation, data.role ?? "staff", data.department_id ?? null, data.is_active ? 1 : 0, data.id])
    return db.queryOne(`SELECT ${USER_COLUMNS} FROM users WHERE id=?`, [data.id])
  }
  const { lastInsertRowid } = db.run("INSERT INTO users(staff_id,name,email,designation,role,department_id,is_active) VALUES(?,?,?,?,?,?,?)",
    [staffId, name, email, designation, data.role ?? "staff", data.department_id ?? null, 1])
  return db.queryOne(`SELECT ${USER_COLUMNS} FROM users WHERE id=?`, [lastInsertRowid])
}

export interface HallInput { id?: number; hall_code: string; floor?: string | null; capacity?: number; block?: string | null; is_active?: boolean }

/**
 * Add or edit a hall. Hall codes are unique ignoring case ("H101" and "h101" are the same hall)
 * and surrounding spaces are removed; a clash is reported by name instead of reaching the
 * database. Returns the saved hall, or { success: false, error }.
 */
export function saveHall(data: HallInput): any {
  const code = String(data?.hall_code ?? "").trim()
  if (!code) return { success: false, error: "Hall Code is required." }
  const place = validateHallPlace("Block", data.block) ?? validateHallPlace("Floor", data.floor)
  if (place) return { success: false, error: place }
  const capacity = Number(data.capacity ?? 0)
  if (!Number.isFinite(capacity) || !Number.isInteger(capacity)) return { success: false, error: "Capacity must be a whole number." }
  if (capacity < 0) return { success: false, error: "Capacity cannot be negative." }
  const clash = db.queryOne<any>("SELECT hall_code FROM halls WHERE hall_code = ? COLLATE NOCASE AND id != ?", [code, data.id ?? 0])
  if (clash) return { success: false, error: `Hall ${clash.hall_code} already exists. Each hall code can be used only once (capital and small letters count as the same).` }
  // Halls are identified by code and floor; the NOT NULL name column just mirrors the code.
  const floor = (data.floor && String(data.floor).trim()) || null
  const block = (data.block && String(data.block).trim()) || null
  if (data.id) {
    db.run("UPDATE halls SET hall_code=?,name=?,floor=?,capacity=?,block=?,is_active=? WHERE id=?",
      [code, code, floor, capacity, block, data.is_active ? 1 : 0, data.id])
    return db.queryOne("SELECT * FROM halls WHERE id=?", [data.id])
  }
  const maxOrder = db.queryOne<any>("SELECT MAX(sort_order) as m FROM halls")
  const { lastInsertRowid } = db.run("INSERT INTO halls(hall_code,name,floor,capacity,block,is_active,sort_order) VALUES(?,?,?,?,?,?,?)",
    [code, code, floor, capacity, block, 1, (maxOrder?.m ?? 0) + 1])
  return db.queryOne("SELECT * FROM halls WHERE id=?", [lastInsertRowid])
}

/**
 * The Dashboard numbers. "Upcoming" sessions are those that have not finished yet by the
 * computer's clock: any later day, or today until the session's exam end time passes (a session
 * with no end time counts for the whole day). `now` is the current date and time.
 */
export function getDashboardStats(now: Date = new Date()) {
  const today = todayLocal(now), time = timeNowLocal(now)
  const count = (sql: string, params: any[] = []) => db.queryOne<any>(sql, params)?.c ?? 0
  return {
    totalStaff:         count("SELECT COUNT(*) as c FROM users WHERE is_active=1 AND role='staff'"),
    totalHalls:         count("SELECT COUNT(*) as c FROM halls WHERE is_active=1"),
    totalCycles:        count("SELECT COUNT(*) as c FROM exam_cycles"),
    confirmedSessions:  count("SELECT COUNT(*) as c FROM exam_sessions WHERE status IN ('confirmed','published')"),
    upcomingSessions:   count("SELECT COUNT(*) as c FROM exam_sessions WHERE exam_date > ? OR (exam_date = ? AND (exam_end IS NULL OR exam_end = '' OR exam_end > ?))", [today, today, time]),
    // Sessions that still need an allocation to be generated/confirmed.
    pendingAllocations: count("SELECT COUNT(*) as c FROM exam_sessions WHERE status NOT IN ('confirmed','published')"),
    allocatedHalls:     count("SELECT COUNT(DISTINCT a.hall_id) as c FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.status IN ('confirmed','published')"),
    totalExamDays:      count("SELECT COUNT(DISTINCT exam_date) as c FROM exam_sessions"),
  }
}

/** The department an import row names, by code or name, ignoring case; a code match wins over a name match. */
export function findDepartmentByCodeOrName(value: string): { id: number } | undefined {
  return db.queryOne<any>(
    "SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE ORDER BY (code = ? COLLATE NOCASE) DESC, id LIMIT 1",
    [value, value, value]
  )
}

/** Every users column except password_hash (the desktop app has no passwords; never send one to the window). */
export const USER_COLUMNS = "id, staff_id, name, email, designation, role, department_id, is_active, created_at, updated_at"

export function listUsers(filters?: { role?: string; is_active?: boolean; department_id?: number }) {
  let sql = `SELECT ${USER_COLUMNS.split(", ").map(c => "u." + c).join(", ")}, d.name as department_name, d.code as department_code
             FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE 1=1`
  const params: any[] = []
  if (filters?.role) { sql += ` AND u.role=?`; params.push(filters.role) }
  if (filters?.is_active !== undefined) { sql += ` AND u.is_active=?`; params.push(filters.is_active ? 1 : 0) }
  if (filters?.department_id) { sql += ` AND u.department_id=?`; params.push(filters.department_id) }
  sql += ` ORDER BY d.code COLLATE NOCASE, u.name`
  return db.query(sql, params)
}
