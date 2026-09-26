/**
 * Web API implementation for browser environment (Firebase Hosting).
 * Provides the identical interface to the Electron preload `window.api`.
 */

import bcrypt from "bcryptjs"
import * as XLSX from "xlsx"
import { webDb } from "./web-db"

// In-memory cache for browser file selection
let cachedSelectedFile: File | null = null

async function ensureDb() {
  await webDb.initWebDatabase()
}

// -------------------------------------------------------------
// Validation Engine
// -------------------------------------------------------------
function validateAllocation(
  sessionId: number,
  entries: { userId: number; hallId: number; sessionId: number }[],
  hallIds: number[],
  userIds: number[]
) {
  const errors: { rule: string; message: string; userId?: number; hallId?: number }[] = []
  const warnings: string[] = []

  // R7 - Count match
  if (entries.length !== hallIds.length || entries.length !== userIds.length) {
    errors.push({ rule: "R7", message: `Staff count (${userIds.length}) must equal hall count (${hallIds.length}).` })
  }

  // R5 - Staff availability
  for (const e of entries) {
    const u = webDb.queryOne<any>("SELECT id, name, staff_id, is_active FROM users WHERE id = ?", [e.userId])
    if (u && !u.is_active) errors.push({ rule: "R5", message: `${u.name} (${u.staff_id}) is inactive.`, userId: u.id })
  }

  // R6 - Hall availability
  for (const e of entries) {
    const h = webDb.queryOne<any>("SELECT id, hall_code, is_active FROM halls WHERE id = ?", [e.hallId])
    if (h && !h.is_active) errors.push({ rule: "R6", message: `Hall ${h.hall_code} is inactive.`, hallId: h.id })
  }

  // R2 - Hall duplication
  const hallCounts = new Map<number, number>()
  for (const e of entries) hallCounts.set(e.hallId, (hallCounts.get(e.hallId) ?? 0) + 1)
  for (const [hallId, count] of hallCounts) {
    if (count > 1) {
      const hall = webDb.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [hallId])
      errors.push({ rule: "R2", message: `Hall ${hall?.hall_code ?? hallId} is assigned to ${count} staff in the same session.`, hallId })
    }
  }

  // R3 - Staff duplication
  const userCounts = new Map<number, number>()
  for (const e of entries) userCounts.set(e.userId, (userCounts.get(e.userId) ?? 0) + 1)
  for (const [userId, count] of userCounts) {
    if (count > 1) {
      const user = webDb.queryOne<any>("SELECT name FROM users WHERE id = ?", [userId])
      errors.push({ rule: "R3", message: `${user?.name ?? userId} is assigned to ${count} halls in the same session.`, userId })
    }
  }

  // R1 - Circular rotation non-repetition within cycle length
  const cycleLength = hallIds.length
  const lookback = Math.max(0, cycleLength - 1)
  for (const e of entries) {
    const recentRows = webDb.query<any>(
      "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
      [e.userId, lookback]
    )
    const usedInCycle = recentRows.map((r: any) => r.hall_id)
    if (usedInCycle.includes(e.hallId)) {
      const user = webDb.queryOne<any>("SELECT name FROM users WHERE id = ?", [e.userId])
      const hall = webDb.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [e.hallId])
      const prev = webDb.queryOne<any>(
        `SELECT es.exam_date, es.session_type FROM rotation_history rh
         JOIN exam_sessions es ON rh.session_id = es.id
         WHERE rh.user_id = ? AND rh.hall_id = ?
         ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
        [e.userId, e.hallId]
      )
      errors.push({
        rule: "R1",
        message: `${user?.name} was already assigned Hall ${hall?.hall_code} on ${prev?.exam_date ?? "?"} (${prev?.session_type ?? "?"}) in the current rotation cycle. Cannot repeat.`,
        userId: e.userId, hallId: e.hallId
      })
    }
  }

  // R4 - Rotation integrity
  const session = webDb.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
  if (session) {
    const prevConfirmed = webDb.queryOne<any>(
      `SELECT id FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ? AND status IN ('confirmed','published')
       ORDER BY rotation_step DESC LIMIT 1`,
      [session.cycle_id, session.rotation_step]
    )
    if (!prevConfirmed) {
      const hasPrevious = webDb.queryOne<any>(
        "SELECT id FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ?",
        [session.cycle_id, session.rotation_step]
      )
      if (hasPrevious) {
        errors.push({
          rule: "R4",
          message: "Previous session(s) in this cycle have not been confirmed yet. Confirm sessions in order."
        })
      }
    }
  }

  return { isValid: errors.length === 0, blockingErrors: errors, warnings }
}

function validateSingleEdit(
  userId: number,
  hallId: number,
  sessionId: number,
  currentEntries: { userId: number; hallId: number }[],
  sessionHallPool?: number[]
) {
  const user = webDb.queryOne<any>("SELECT * FROM users WHERE id = ?", [userId])
  if (!user?.is_active) return `${user?.name ?? "Staff"} is inactive.`

  const hall = webDb.queryOne<any>("SELECT * FROM halls WHERE id = ?", [hallId])
  if (!hall?.is_active) return `Hall ${hall?.hall_code ?? hallId} is inactive.`

  const sessionHalls = sessionHallPool && sessionHallPool.length > 0
    ? sessionHallPool
    : webDb.query<any>("SELECT DISTINCT COALESCE(generated_hall_id, hall_id) as h_id FROM allocations WHERE session_id = ?", [sessionId]).map((r: any) => r.h_id)

  if (sessionHalls.length > 0 && !sessionHalls.includes(hallId)) {
    return `Hall ${hall.hall_code} is not part of this session's hall pool.`
  }

  const hallTaken = currentEntries.find(e => e.hallId === hallId && e.userId !== userId)
  if (hallTaken) return `Hall ${hall.hall_code} is already assigned to another invigilator in this session.`

  const cycleLength = sessionHalls.length > 0 ? sessionHalls.length : 10
  const lookback = Math.max(0, cycleLength - 1)
  const recentRows = webDb.query<any>(
    "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
    [userId, lookback]
  )
  const usedInCycle = recentRows.map((r: any) => r.hall_id)
  if (usedInCycle.includes(hallId)) {
    const prev = webDb.queryOne<any>(
      `SELECT es.exam_date, es.session_type FROM rotation_history rh
       JOIN exam_sessions es ON rh.session_id = es.id
       WHERE rh.user_id = ? AND rh.hall_id = ?
       ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
      [userId, hallId]
    )
    return `${user.name} was already assigned Hall ${hall.hall_code} on ${prev?.exam_date ?? "?"} (${prev?.session_type ?? "?"}) in the current rotation cycle.`
  }
  return null
}

// -------------------------------------------------------------
// Rotation Engine
// -------------------------------------------------------------
function isUsedInCurrentCycle(userId: number, hallId: number, cycleLength: number): boolean {
  const lookback = Math.max(0, cycleLength - 1)
  const recentRows = webDb.query<any>(
    "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
    [userId, lookback]
  )
  return recentRows.some(r => r.hall_id === hallId)
}

function computeNextHall(
  userId: number,
  hallIds: number[],
  alreadyAssigned: Set<number>
): number {
  const lastRecord = webDb.queryOne<any>(
    "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT 1",
    [userId]
  )

  if (!lastRecord) {
    const firstFree = hallIds.find(h => !alreadyAssigned.has(h))
    if (firstFree !== undefined) return firstFree
    return hallIds[0]
  }

  const lastHallIndex = hallIds.indexOf(lastRecord.hall_id)
  if (lastHallIndex === -1) {
    const cycleLength = hallIds.length
    const candidate =
      hallIds.find(h => !alreadyAssigned.has(h) && !isUsedInCurrentCycle(userId, h, cycleLength)) ??
      hallIds.find(h => !alreadyAssigned.has(h)) ??
      hallIds[0]
    return candidate
  }

  for (let attempt = 1; attempt <= hallIds.length; attempt++) {
    const candidate = hallIds[(lastHallIndex + attempt) % hallIds.length]
    if (!alreadyAssigned.has(candidate)) return candidate
  }
  return hallIds[0]
}

function generateRotation(sessionId: number, userIds: number[], hallIds: number[]) {
  if (userIds.length !== hallIds.length) {
    throw new Error(`Staff count (${userIds.length}) must equal hall count (${hallIds.length})`)
  }

  const staffWithHistory: number[] = []
  const staffWithoutHistory: number[] = []

  for (const userId of userIds) {
    const hist = webDb.queryOne<any>(
      "SELECT id FROM rotation_history WHERE user_id = ? LIMIT 1",
      [userId]
    )
    if (hist) staffWithHistory.push(userId)
    else staffWithoutHistory.push(userId)
  }

  const assignedMap = new Map<number, number>()
  const assignedHalls = new Set<number>()

  for (const userId of staffWithHistory) {
    const nextHallId = computeNextHall(userId, hallIds, assignedHalls)
    assignedMap.set(userId, nextHallId)
    assignedHalls.add(nextHallId)
  }

  for (const userId of staffWithoutHistory) {
    const nextHallId = computeNextHall(userId, hallIds, assignedHalls)
    assignedMap.set(userId, nextHallId)
    assignedHalls.add(nextHallId)
  }

  return userIds.map(userId => ({
    userId,
    hallId: assignedMap.get(userId)!,
    isAutoGenerated: true
  }))
}

function getSessionAllocationFull(sessionId: number) {
  return webDb.query(
    `SELECT a.id, a.is_manually_edited, a.edit_reason,
            u.id as userId, u.staff_id, u.name as userName, u.designation,
            d.name as deptName, d.code as deptCode,
            h.id as hallId, h.hall_code, h.name as hallName,
            gh.hall_code as generatedHallCode
     FROM allocations a
     JOIN users u ON a.user_id = u.id
     JOIN halls h ON a.hall_id = h.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN halls gh ON a.generated_hall_id = gh.id
     WHERE a.session_id = ?
     ORDER BY d.code, u.name`,
    [sessionId]
  )
}


// -------------------------------------------------------------
// Audit Log Helper
// -------------------------------------------------------------
function writeAuditLog(userId: number | null, action: string, description: string, payload?: any) {
  try {
    webDb.run(
      "INSERT INTO audit_log(user_id, action, description, payload, created_at) VALUES(?,?,?,?,datetime('now'))",
      [userId, action, description, payload ? JSON.stringify(payload) : null]
    )
  } catch {
    // Audit log failure must never crash the main operation
  }
}

// -------------------------------------------------------------
// The Web API Object
// -------------------------------------------------------------
export const webApi = {
  // Auth
  login: async (staffId: string, password: string) => {
    await ensureDb()
    const user = webDb.queryOne<any>("SELECT * FROM users WHERE staff_id = ?", [staffId])
    if (!user) return { success: false, error: "Invalid Staff ID or password." }
    if (!user.is_active) return { success: false, error: "Account is inactive. Please contact administrator." }

    if (!user.password_hash) {
      const hash = await bcrypt.hash(password, 12)
      webDb.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id])
      return { success: true, user: { id: user.id, name: user.name, staff_id: user.staff_id, role: user.role, department_id: user.department_id } }
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return { success: false, error: "Invalid Staff ID or password." }
    writeAuditLog(user.id, "LOGIN", `User ${user.staff_id} logged in`, { role: user.role })
    return { success: true, user: { id: user.id, name: user.name, staff_id: user.staff_id, role: user.role, department_id: user.department_id } }
  },

  logout: async () => ({ success: true }),

  changePassword: async (userId: number, oldPw: string, newPw: string) => {
    await ensureDb()
    const user = webDb.queryOne<any>("SELECT * FROM users WHERE id = ?", [userId])
    if (!user) return { success: false, error: "User not found." }
    if (user.password_hash) {
      const valid = await bcrypt.compare(oldPw, user.password_hash)
      if (!valid) return { success: false, error: "Current password is incorrect." }
    }
    const hash = await bcrypt.hash(newPw, 12)
    webDb.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId])
    return { success: true }
  },

  // Departments
  getDepartments: async () => {
    await ensureDb()
    return webDb.query("SELECT * FROM departments ORDER BY name")
  },

  saveDepartment: async (data: any) => {
    await ensureDb()
    if (data.id) {
      webDb.run("UPDATE departments SET code=?,name=?,is_active=? WHERE id=?", [data.code, data.name, data.is_active ? 1 : 0, data.id])
      return webDb.queryOne("SELECT * FROM departments WHERE id=?", [data.id])
    }
    const { lastInsertRowid } = webDb.run("INSERT INTO departments(code,name) VALUES(?,?)", [data.code, data.name])
    return webDb.queryOne("SELECT * FROM departments WHERE id=?", [lastInsertRowid])
  },

  deleteDepartment: async (id: number) => {
    await ensureDb()
    const inUse = webDb.queryOne("SELECT id FROM users WHERE department_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: staff assigned to this department." }
    webDb.run("DELETE FROM departments WHERE id=?", [id])
    return { success: true }
  },

  // Users
  getUsers: async (filters?: any) => {
    await ensureDb()
    let sql = `SELECT u.*, d.name as department_name, d.code as department_code
               FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE 1=1`
    const params: any[] = []
    if (filters?.role) { sql += ` AND u.role=?`; params.push(filters.role) }
    if (filters?.is_active !== undefined) { sql += ` AND u.is_active=?`; params.push(filters.is_active ? 1 : 0) }
    if (filters?.department_id) { sql += ` AND u.department_id=?`; params.push(filters.department_id) }
    sql += ` ORDER BY d.code, u.name`
    return webDb.query(sql, params)
  },

  saveUser: async (data: any) => {
    await ensureDb()
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null
    if (data.id) {
      let sql = `UPDATE users SET staff_id=?,name=?,email=?,designation=?,role=?,department_id=?,is_active=?,updated_at=datetime('now')`
      const params: any[] = [data.staff_id, data.name, data.email??null, data.designation??null, data.role??"staff", data.department_id??null, data.is_active?1:0]
      if (hash) { sql += `,password_hash=?`; params.push(hash) }
      sql += ` WHERE id=?`; params.push(data.id)
      webDb.run(sql, params)
      writeAuditLog(null, "STAFF_STATUS_CHANGE", `Staff ${data.staff_id} updated`, { id: data.id, is_active: data.is_active })
      return webDb.queryOne("SELECT * FROM users WHERE id=?", [data.id])
    }
    const { lastInsertRowid } = webDb.run(
      "INSERT INTO users(staff_id,name,email,designation,role,department_id,is_active,password_hash) VALUES(?,?,?,?,?,?,?,?)",
      [data.staff_id, data.name, data.email??null, data.designation??null, data.role??"staff", data.department_id??null, 1, hash]
    )
    writeAuditLog(null, "CREATE_STAFF", `Staff created: ${data.staff_id} - ${data.name}`, { id: lastInsertRowid, staff_id: data.staff_id })
    return webDb.queryOne("SELECT * FROM users WHERE id=?", [lastInsertRowid])
  },

  deleteUser: async (id: number) => {
    await ensureDb()
    webDb.run("UPDATE users SET is_active=0 WHERE id=?", [id])
    writeAuditLog(null, "STAFF_STATUS_CHANGE", `Staff ID ${id} deactivated`, { id, is_active: 0 })
    return { success: true }
  },

  importUsersFromExcel: async (filePath: string) => {
    await ensureDb()
    try {
      let wb: XLSX.WorkBook
      if (cachedSelectedFile) {
        const ab = await cachedSelectedFile.arrayBuffer()
        wb = XLSX.read(ab, { type: "array" })
      } else {
        return { success: false, error: "No Excel file selected." }
      }

      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      let inserted = 0, skipped = 0
      for (const row of rows) {
        const staffId = String(row["Staff ID"] ?? row["staff_id"] ?? "").trim()
        const name = String(row["Name"] ?? row["name"] ?? "").trim()
        if (!staffId || !name) { skipped++; continue }
        const deptCode = String(row["Department"] ?? row["department"] ?? "").trim()
        const dept = deptCode ? webDb.queryOne<any>("SELECT id FROM departments WHERE code=?", [deptCode]) : null
        const exists = webDb.queryOne("SELECT id FROM users WHERE staff_id=?", [staffId])
        if (!exists) {
          webDb.run(
            "INSERT INTO users(staff_id,name,email,designation,department_id,role,is_active) VALUES(?,?,?,?,?,?,?)",
            [staffId, name, row["Email"]??null, row["Designation"]??null, dept?.id??null, "staff", 1]
          )
          inserted++
        } else skipped++
      }
      return { success: true, inserted, skipped }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  // Halls
  getHalls: async () => {
    await ensureDb()
    // NOTE: sort_order defaults to 0 for every hall and is never set by the UI,
    // so it does not actually order anything. h.id is added as an explicit,
    // immutable tiebreak because this array's order is what the rotation
    // engine indexes into — an undefined tiebreak here silently breaks the
    // "visit every hall before repeating" guarantee.
    return webDb.query("SELECT * FROM halls ORDER BY sort_order, id")
  },

  saveHall: async (data: any) => {
    await ensureDb()
    if (data.id) {
      webDb.run("UPDATE halls SET hall_code=?,name=?,capacity=?,block=?,is_active=? WHERE id=?",
        [data.hall_code, data.name, data.capacity??0, data.block??null, data.is_active?1:0, data.id])
      writeAuditLog(null, "HALL_STATUS_CHANGE", `Hall ${data.hall_code} updated`, { id: data.id, is_active: data.is_active })
      return webDb.queryOne("SELECT * FROM halls WHERE id=?", [data.id])
    }
    const maxOrder = webDb.queryOne<any>("SELECT MAX(sort_order) as m FROM halls")
    const { lastInsertRowid } = webDb.run("INSERT INTO halls(hall_code,name,capacity,block,is_active,sort_order) VALUES(?,?,?,?,?,?)",
      [data.hall_code, data.name, data.capacity??0, data.block??null, 1, (maxOrder?.m??0)+1])
    writeAuditLog(null, "CREATE_HALL", `Hall created: ${data.hall_code}`, { id: lastInsertRowid, hall_code: data.hall_code })
    return webDb.queryOne("SELECT * FROM halls WHERE id=?", [lastInsertRowid])
  },

  deleteHall: async (id: number) => {
    await ensureDb()
    const inUse = webDb.queryOne("SELECT id FROM allocations WHERE hall_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: hall has existing allocations." }
    webDb.run("DELETE FROM halls WHERE id=?", [id])
    writeAuditLog(null, "DELETE_HALL", `Hall ID ${id} deleted`, { id })
    return { success: true }
  },

  // Settings
  getSettings: async () => {
    await ensureDb()
    const rows = webDb.query<{ key: string; value: string }>("SELECT key, value FROM settings")
    const map: Record<string, string> = {}
    rows.forEach(r => { map[r.key] = r.value })
    return map
  },

  saveSetting: async (key: string, value: string) => {
    await ensureDb()
    webDb.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=?", [key, value, value])
    return { success: true }
  },

  getDashboardStats: async () => {
    await ensureDb()
    const staffRow = webDb.queryOne<any>("SELECT COUNT(*) as total FROM users WHERE role='staff' AND is_active=1")
    const hallsRow = webDb.queryOne<any>("SELECT COUNT(*) as total FROM halls WHERE is_active=1")
    const cyclesRow = webDb.queryOne<any>("SELECT COUNT(*) as total FROM exam_cycles")
    const confirmedRow = webDb.queryOne<any>("SELECT COUNT(*) as total FROM exam_sessions WHERE status IN ('confirmed','published')")
    // Upcoming = sessions from today onwards that are not yet published
    const upcomingRow = webDb.queryOne<any>(
      `SELECT COUNT(*) as total FROM exam_sessions WHERE exam_date >= date('now') AND status != 'published'`
    )
    // Allocated halls = distinct halls that have at least one allocation in confirmed/published sessions
    const allocatedRow = webDb.queryOne<any>(
      `SELECT COUNT(DISTINCT a.hall_id) as total
       FROM allocations a
       JOIN exam_sessions es ON a.session_id = es.id
       WHERE es.status IN ('confirmed','published')`
    )
    // Total unique exam days (distinct exam_date values across all sessions)
    const examDaysRow = webDb.queryOne<any>(
      `SELECT COUNT(DISTINCT exam_date) as total FROM exam_sessions`
    )
    return {
      totalStaff: staffRow?.total ?? 0,
      totalHalls: hallsRow?.total ?? 0,
      totalCycles: cyclesRow?.total ?? 0,
      confirmedSessions: confirmedRow?.total ?? 0,
      upcomingSessions: upcomingRow?.total ?? 0,
      allocatedHalls: allocatedRow?.total ?? 0,
      totalExamDays: examDaysRow?.total ?? 0
    }
  },

  // Cycles
  getCycles: async () => {
    await ensureDb()
    return webDb.query("SELECT * FROM exam_cycles ORDER BY created_at DESC")
  },

  createCycle: async (data: any) => {
    await ensureDb()
    const { lastInsertRowid } = webDb.run("INSERT INTO exam_cycles(name,academic_year,status) VALUES(?,?,?)", [data.name, data.academic_year, "draft"])
    writeAuditLog(null, "CREATE_CYCLE", `Exam cycle created: ${data.name}`, { id: lastInsertRowid, name: data.name, academic_year: data.academic_year })
    return webDb.queryOne("SELECT * FROM exam_cycles WHERE id=?", [lastInsertRowid])
  },

  updateCycle: async (id: number, data: any) => {
    await ensureDb()
    webDb.run("UPDATE exam_cycles SET name=?,academic_year=?,status=?,updated_at=datetime('now') WHERE id=?",
      [data.name, data.academic_year, data.status, id])
    return webDb.queryOne("SELECT * FROM exam_cycles WHERE id=?", [id])
  },

  getSessions: async (cycleId: number) => {
    await ensureDb()
    return webDb.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
  },

  createSessions: async (cycleId: number, sessions: any[]) => {
    await ensureDb()
    return webDb.runTransaction(() => {
      // Safety guard: only delete sessions that are NOT confirmed or published
      // Never cascade-delete historical/confirmed allocation data
      const safeToDelete = webDb.query<any>(
        "SELECT id FROM exam_sessions WHERE cycle_id=? AND status NOT IN ('confirmed','published')",
        [cycleId]
      )
      for (const s of safeToDelete) {
        webDb.run("DELETE FROM exam_sessions WHERE id=?", [s.id])
      }
      // Find the highest existing rotation_step (from surviving confirmed sessions)
      const maxStepRow = webDb.queryOne<any>(
        "SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?",
        [cycleId]
      )
      let step = (maxStepRow?.m ?? 0) + 1
      const seen = new Set<string>()
      // Don't re-add sessions that already exist (confirmed/published)
      const existing = webDb.query<any>(
        "SELECT exam_date, session_type FROM exam_sessions WHERE cycle_id=?",
        [cycleId]
      )
      for (const e of existing) seen.add(`${e.exam_date}_${e.session_type}`)

      for (const s of sessions) {
        const key = `${s.exam_date}_${s.session_type}`
        if (seen.has(key)) continue
        seen.add(key)
        webDb.run(
          "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
          [cycleId, s.exam_date, s.session_type, step++, s.reporting_time??null, s.exam_start??null, s.exam_end??null, "pending"]
        )
      }
      writeAuditLog(null, "CREATE_SESSION", `Generated ${sessions.length} sessions for cycle ${cycleId}`, { cycleId, count: sessions.length })
      return webDb.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
    })
  },

  updateSession: async (id: number, data: any) => {
    await ensureDb()
    const current = webDb.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
    if (!current) return null
    const examDate = data.exam_date ?? current.exam_date
    const sessionType = data.session_type ?? current.session_type

    const conflict = webDb.queryOne<any>(
      "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=? AND id!=?",
      [current.cycle_id, examDate, sessionType, id]
    )
    if (conflict) {
      throw new Error(`A ${sessionType === "FN" ? "Forenoon (FN)" : "Afternoon (AN)"} session already exists for ${examDate} in this cycle.`)
    }

    const reportingTime = data.reporting_time !== undefined ? data.reporting_time : current.reporting_time
    const examStart = data.exam_start !== undefined ? data.exam_start : current.exam_start
    const examEnd = data.exam_end !== undefined ? data.exam_end : current.exam_end
    const status = data.status ?? current.status
    const rotationStep = data.rotation_step !== undefined ? data.rotation_step : current.rotation_step

    webDb.run(
      "UPDATE exam_sessions SET exam_date=?,session_type=?,reporting_time=?,exam_start=?,exam_end=?,status=?,rotation_step=?,updated_at=datetime('now') WHERE id=?",
      [examDate, sessionType, reportingTime, examStart, examEnd, status, rotationStep, id]
    )
    return webDb.queryOne("SELECT * FROM exam_sessions WHERE id=?", [id])
  },

  addSession: async (cycleId: number, data: any) => {
    await ensureDb()
    const exists = webDb.queryOne<any>(
      "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=?",
      [cycleId, data.exam_date, data.session_type]
    )
    if (exists) {
      throw new Error(`A ${data.session_type === "FN" ? "Forenoon (FN)" : "Afternoon (AN)"} session already exists for ${data.exam_date} in this cycle.`)
    }

    const maxStep = webDb.queryOne<any>("SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?", [cycleId])
    const step = (maxStep?.m ?? 0) + 1
    const { lastInsertRowid } = webDb.run(
      "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
      [cycleId, data.exam_date, data.session_type, step, data.reporting_time??null, data.exam_start??null, data.exam_end??null, "pending"]
    )
    writeAuditLog(null, "CREATE_SESSION", `Added session ${data.exam_date} ${data.session_type} for cycle ${cycleId}`, { id: lastInsertRowid, cycleId, ...data })
    return webDb.queryOne("SELECT * FROM exam_sessions WHERE id=?", [lastInsertRowid])
  },

  deleteSession: async (id: number) => {
    await ensureDb()
    const session = webDb.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
    if (!session) return { success: false, error: "Session not found." }
    if (session.status === "confirmed" || session.status === "published") {
      return { success: false, error: "Cannot delete a confirmed or published session. Reopen it first." }
    }
    const hasAllocations = webDb.queryOne<any>("SELECT COUNT(*) as c FROM allocations WHERE session_id=?", [id])
    if (hasAllocations && hasAllocations.c > 0) {
      return { success: false, error: "Cannot delete session: allocations already exist." }
    }
    webDb.run("DELETE FROM exam_sessions WHERE id=?", [id])
    const remaining = webDb.query<any>("SELECT id FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step, id", [session.cycle_id])
    remaining.forEach((s, idx) => {
      webDb.run("UPDATE exam_sessions SET rotation_step=? WHERE id=?", [idx + 1, s.id])
    })
    writeAuditLog(null, "DELETE_SESSION", `Session ID ${id} deleted`, { id, cycle_id: session.cycle_id })
    return { success: true }
  },


  // Allocation
  generateAllocation: async (sessionId: number, userIds: number[], hallIds: number[]) => {
    await ensureDb()
    const entries = generateRotation(sessionId, userIds, hallIds)

    webDb.run("DELETE FROM allocations WHERE session_id = ?", [sessionId])
    for (const e of entries) {
      webDb.run(
        "INSERT OR REPLACE INTO allocations(session_id, user_id, hall_id, is_manually_edited, generated_hall_id) VALUES(?,?,?,0,?)",
        [sessionId, e.userId, e.hallId, e.hallId]
      )
    }
    webDb.run("UPDATE exam_sessions SET status='draft' WHERE id=?", [sessionId])
    writeAuditLog(null, "GENERATE_ALLOCATION", `Draft allocation generated for session ${sessionId}`, { sessionId, staffCount: userIds.length, hallCount: hallIds.length })

    const validationEntries = entries.map(e => ({ ...e, sessionId }))
    const validation = validateAllocation(sessionId, validationEntries, hallIds, userIds)
    const fullAllocation = getSessionAllocationFull(sessionId)
    return { entries: fullAllocation, validation }
  },

  getSessionAllocation: async (sessionId: number) => {
    await ensureDb()
    return getSessionAllocationFull(sessionId)
  },

  editAllocation: async (sessionId: number, userId: number, newHallId: number, editReason?: string) => {
    await ensureDb()
    const current = webDb.query<any>("SELECT user_id, hall_id, generated_hall_id FROM allocations WHERE session_id = ?", [sessionId])
    const currentEntries = current.map((r: any) => ({ userId: r.user_id, hallId: r.hall_id, sessionId }))
    const sessionHallPool = Array.from(new Set(current.map((r: any) => r.generated_hall_id || r.hall_id))) as number[]
    const error = validateSingleEdit(userId, newHallId, sessionId, currentEntries, sessionHallPool)
    if (error) return { success: false, error }

    webDb.run(
      "UPDATE allocations SET hall_id=?, is_manually_edited=1, edit_reason=?, updated_at=datetime('now') WHERE session_id=? AND user_id=?",
      [newHallId, editReason ?? null, sessionId, userId]
    )
    writeAuditLog(null, "EDIT_ALLOCATION", `Manual override for session ${sessionId}, user ${userId} to hall ${newHallId}`, { sessionId, userId, newHallId, editReason })
    return { success: true }
  },

  getValidHalls: async (userId: number, sessionId: number) => {
    await ensureDb()
    const allocations = webDb.query<any>("SELECT hall_id, user_id, generated_hall_id FROM allocations WHERE session_id = ?", [sessionId])
    const sessionHallIds = Array.from(new Set(allocations.map((a: any) => a.generated_hall_id || a.hall_id))) as number[]
    const occupiedHallIds = allocations.filter((a: any) => a.user_id !== userId).map((a: any) => a.hall_id)
    const cycleLength = sessionHallIds.length > 0 ? sessionHallIds.length : 10
    const lookback = Math.max(0, cycleLength - 1)

    const recentRows = webDb.query<any>(
      "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
      [userId, lookback]
    )
    const usedInCycle = new Set(recentRows.map((r: any) => r.hall_id))
    return sessionHallIds.map(hallId => {
      if (occupiedHallIds.includes(hallId)) return { hallId, isValid: false, reason: "Assigned to another invigilator" }
      if (usedInCycle.has(hallId)) return { hallId, isValid: false, reason: "Already visited in cycle" }
      return { hallId, isValid: true }
    })
  },

  confirmAllocation: async (sessionId: number) => {
    await ensureDb()
    const allocations = webDb.query<any>("SELECT * FROM allocations WHERE session_id = ?", [sessionId])
    if (!allocations.length) {
      return { success: false, error: "No allocations found for this session." }
    }
    const session = webDb.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
    if (!session) {
      return { success: false, error: "Exam session not found." }
    }

    const entries = allocations.map((a: any) => ({ userId: a.user_id, hallId: a.hall_id, sessionId }))
    const hallIds = allocations.map((a: any) => a.hall_id)
    const userIds = allocations.map((a: any) => a.user_id)
    const validation = validateAllocation(sessionId, entries, hallIds, userIds)
    if (!validation.isValid) {
      return {
        success: false,
        error: "Validation failed. Cannot confirm.",
        validation,
        blockingErrors: validation.blockingErrors
      }
    }

    // Commit to rotation history with global_order
    const maxRow = webDb.queryOne<{ max_order: number | null }>(
      "SELECT MAX(global_order) as max_order FROM rotation_history"
    )
    let nextGlobalOrder = (maxRow?.max_order ?? 0) + 1

    for (const e of entries) {
      const existing = webDb.queryOne<{ id: number; global_order: number }>(
        "SELECT id, global_order FROM rotation_history WHERE user_id = ? AND session_id = ?",
        [e.userId, sessionId]
      )
      if (existing) {
        webDb.run(
          `UPDATE rotation_history 
           SET hall_id = ?, rotation_step = ?, recorded_at = datetime('now')
           WHERE id = ?`,
          [e.hallId, session.rotation_step, existing.id]
        )
      } else {
        webDb.run(
          `INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at)
           VALUES(?,?,?,?,?,datetime('now'))`,
          [e.userId, sessionId, e.hallId, session.rotation_step, nextGlobalOrder++]
        )
      }
    }

    webDb.run("UPDATE exam_sessions SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?", [sessionId])
    writeAuditLog(null, "CONFIRM_ALLOCATION", `Session ${sessionId} confirmed`, { sessionId, count: entries.length })
    return { success: true }
  },

  publishAllocation: async (sessionId: number) => {
    await ensureDb()
    const session = webDb.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
    if (!session) return { success: false, error: "Exam session not found." }
    if (session.status !== "confirmed") {
      return { success: false, error: "Session must be confirmed before publishing." }
    }

    webDb.run("UPDATE exam_sessions SET status = 'published', updated_at = datetime('now') WHERE id = ?", [sessionId])
    const unpub = webDb.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE cycle_id = ? AND status != 'published'", [session.cycle_id])
    if (!unpub || unpub.c === 0) {
      webDb.run("UPDATE exam_cycles SET status = 'published' WHERE id = ?", [session.cycle_id])
    }
    writeAuditLog(null, "PUBLISH_ALLOCATION", `Session ${sessionId} published`, { sessionId })

    // Create in-app notifications for all staff assigned in this session
    try {
      const allocations = webDb.query<any>(
        `SELECT a.user_id, h.hall_code, ec.name as cycle_name
         FROM allocations a
         JOIN halls h ON a.hall_id = h.id
         JOIN exam_sessions es ON a.session_id = es.id
         JOIN exam_cycles ec ON es.cycle_id = ec.id
         WHERE a.session_id = ?`,
        [sessionId]
      )
      const sessionLabel = `${session.exam_date} ${session.session_type}`
      for (const a of allocations) {
        webDb.run(
          "INSERT INTO notifications(user_id, title, message, session_id) VALUES(?,?,?,?)",
          [
            a.user_id,
            "New Exam Duty Published",
            `Your invigilation duty has been published for ${sessionLabel} — Hall ${a.hall_code} (${a.cycle_name}).`,
            sessionId
          ]
        )
      }
    } catch (e) {
      // Notification failure must never block publish
      console.warn("[EIAS] Failed to create notifications:", e)
    }

    return { success: true }
  },

  removeAllocation: async (sessionId: number, userId: number) => {
    await ensureDb()
    const session = webDb.queryOne<any>("SELECT status FROM exam_sessions WHERE id = ?", [sessionId])
    if (!session) return { success: false, error: "Session not found." }
    if (session.status === "published") {
      return { success: false, error: "Cannot remove allocations from a published session. Reopen it first." }
    }
    const existing = webDb.queryOne<any>(
      "SELECT id FROM allocations WHERE session_id = ? AND user_id = ?",
      [sessionId, userId]
    )
    if (!existing) return { success: false, error: "Allocation entry not found." }
    webDb.run("DELETE FROM allocations WHERE session_id = ? AND user_id = ?", [sessionId, userId])
    writeAuditLog(null, "REMOVE_ALLOCATION", `Removed allocation for session ${sessionId}, user ${userId}`, { sessionId, userId })
    return { success: true }
  },

  getStaffDutyHistory: async (userId: number) => {
    await ensureDb()
    return webDb.query(
      `SELECT rh.hall_id as hallId, rh.session_id as sessionId, rh.rotation_step as rotationStep,
              rh.global_order as globalOrder, es.exam_date as examDate, es.session_type as sessionType,
              h.hall_code, h.name as hallName, ec.name as cycleName
       FROM rotation_history rh
       JOIN exam_sessions es ON rh.session_id = es.id
       JOIN exam_cycles ec ON es.cycle_id = ec.id
       JOIN halls h ON rh.hall_id = h.id
       WHERE rh.user_id = ?
       ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC`,
      [userId]
    )
  },

  getAllocationHistory: async (filters: any) => {
    await ensureDb()
    let sql = `SELECT u.staff_id, u.name as staffName, d.code as deptCode, h.hall_code,
               es.exam_date, es.session_type, ec.name as cycleName, a.is_manually_edited
               FROM allocations a
               JOIN users u ON a.user_id=u.id
               JOIN halls h ON a.hall_id=h.id
               JOIN exam_sessions es ON a.session_id=es.id
               JOIN exam_cycles ec ON es.cycle_id=ec.id
               LEFT JOIN departments d ON u.department_id=d.id
               WHERE 1=1`
    const params: any[] = []
    if (filters?.cycleId) { sql += ` AND es.cycle_id=?`; params.push(filters.cycleId) }
    if (filters?.userId) { sql += ` AND a.user_id=?`; params.push(filters.userId) }
    if (filters?.hallId) { sql += ` AND a.hall_id=?`; params.push(filters.hallId) }
    if (filters?.sessionId) { sql += ` AND a.session_id=?`; params.push(filters.sessionId) }
    sql += ` ORDER BY es.exam_date, es.session_type, u.name`
    return webDb.query(sql, params)
  },

  // Reports
  getStaffWiseReport: async (userId?: number, fromYear?: string, toYear?: string) => {
    await ensureDb()
    let sql = `SELECT u.staff_id, u.name as staffName, d.name as deptName,
      es.exam_date, es.session_type, ec.academic_year,
      h.hall_code, h.name as hallName,
      es.reporting_time, es.exam_start, es.exam_end,
      a.is_manually_edited, ec.name as cycleName
    FROM allocations a
    JOIN users u ON a.user_id = u.id
    JOIN halls h ON a.hall_id = h.id
    JOIN exam_sessions es ON a.session_id = es.id
    JOIN exam_cycles ec ON es.cycle_id = ec.id
    LEFT JOIN departments d ON u.department_id = d.id
    WHERE es.status = 'published'`
    const params: any[] = []
    if (userId) { sql += ` AND a.user_id = ?`; params.push(userId) }
    if (fromYear) { sql += ` AND ec.academic_year >= ?`; params.push(fromYear) }
    if (toYear) { sql += ` AND ec.academic_year <= ?`; params.push(toYear) }
    sql += ` ORDER BY u.name, es.exam_date, es.session_type`
    return webDb.query(sql, params)
  },

  getDateWiseReport: async (sessionId: number) => {
    await ensureDb()
    return webDb.query(
      `SELECT es.exam_date, es.session_type, es.reporting_time, es.exam_start, es.exam_end,
        ec.name as cycleName, ec.academic_year,
        h.hall_code, h.name as hallName, h.block,
        u.staff_id, u.name as staffName, d.name as deptName,
        a.is_manually_edited, a.edit_reason
      FROM allocations a
      JOIN exam_sessions es ON a.session_id = es.id
      JOIN exam_cycles ec ON es.cycle_id = ec.id
      JOIN halls h ON a.hall_id = h.id
      JOIN users u ON a.user_id = u.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE a.session_id = ?
      ORDER BY h.sort_order, h.hall_code`,
      [sessionId]
    )
  },

  getCompleteTimetable: async (cycleId: number) => {
    await ensureDb()
    const cycle = webDb.queryOne<any>("SELECT * FROM exam_cycles WHERE id = ?", [cycleId])
    const sessions = webDb.query<any>(
      "SELECT * FROM exam_sessions WHERE cycle_id = ? ORDER BY rotation_step",
      [cycleId]
    )
    // Include hall_id and user_id explicitly so AllocationMatrixView lookups work correctly
    const allocations = webDb.query<any>(
      `SELECT a.session_id, a.user_id, a.hall_id, a.is_manually_edited,
              u.staff_id, u.name as staffName, d.code as deptCode,
              h.hall_code, h.name as hallName
       FROM allocations a
       JOIN exam_sessions es ON a.session_id = es.id
       JOIN users u ON a.user_id = u.id
       JOIN halls h ON a.hall_id = h.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE es.cycle_id = ?
       ORDER BY es.rotation_step, h.sort_order`,
      [cycleId]
    )
    // Build unique ordered staff list from allocations in this cycle
    const userMap = new Map<number, any>()
    for (const a of allocations) {
      if (!userMap.has(a.user_id)) {
        userMap.set(a.user_id, {
          id: a.user_id,
          staff_id: a.staffId ?? a.staff_id,
          name: a.staffName,
          deptName: a.deptCode ?? null
        })
      }
    }
    const users = Array.from(userMap.values())
    return { cycle, sessions, allocations, users }
  },

  getAuditReport: async (cycleId: number) => {
    await ensureDb()
    return webDb.query(
      `SELECT rh.rotation_step, rh.global_order, rh.recorded_at,
        u.staff_id, u.name as staffName, d.code as deptCode,
        h.hall_code, es.exam_date, es.session_type
      FROM rotation_history rh
      JOIN exam_sessions es ON rh.session_id = es.id
      JOIN users u ON rh.user_id = u.id
      JOIN halls h ON rh.hall_id = h.id
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE es.cycle_id = ?
      ORDER BY rh.global_order DESC, rh.rotation_step DESC, u.name`,
      [cycleId]
    )
  },

  // File Dialogs & Storage
  openFileDialog: async (filters?: any[]): Promise<string | null> => {
    return new Promise((resolve) => {
      const input = document.createElement("input")
      input.type = "file"
      if (filters && filters.length > 0) {
        const exts = filters.flatMap((f: any) => f.extensions || []).map((e: string) => `.${e}`).join(",")
        if (exts) input.accept = exts
      }
      input.onchange = () => {
        if (input.files && input.files[0]) {
          cachedSelectedFile = input.files[0]
          resolve(input.files[0].name)
        } else {
          resolve(null)
        }
      }
      input.click()
    })
  },

  openSaveDialog: async (_filters?: any[], defaultName?: string): Promise<string | null> => {
    return defaultName ?? "eias-backup.db"
  },

  backupDatabase: async (destPath: string) => {
    try {
      await ensureDb()
      const data = webDb.exportDatabaseBlob()
      const blob = new Blob([data], { type: "application/x-sqlite3" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = destPath || "eias-backup.db"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  },

  restoreDatabase: async (_srcPath: string) => {
    try {
      if (!cachedSelectedFile) return { success: false, error: "No backup file selected." }
      const ab = await cachedSelectedFile.arrayBuffer()
      await webDb.importDatabaseBuffer(new Uint8Array(ab))
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }
}

