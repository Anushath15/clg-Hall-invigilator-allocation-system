import { ipcMain } from "electron"
import { db } from "../db/database"
import * as XLSX from "xlsx"
import bcrypt from "bcryptjs"
import { hardDeleteUser } from "../services/allocation.service"

// Column names accepted in the staff import sheet, matched case-insensitively
// against the header row so "Staff ID", "staff id" and "staff_id" all work.
const STAFF_ID_ALIASES = ["staff id", "staff_id", "staffid", "id"]
const NAME_ALIASES = ["name", "staff name", "full name"]
const DEPARTMENT_ALIASES = ["department", "department code", "dept", "dept code", "department_code"]

function findColumn(headers: string[], aliases: string[]) {
  return headers.find(h => aliases.includes(h.trim().toLowerCase()))
}

// Shared by the Electron (sql.js via db) and browser (webDb) import handlers: reads the
// sheet's header row first so a whole-file problem ("no Department column at all") is
// reported once, up front, rather than as N confusing per-row errors. Only after all three
// required columns are confirmed present does it walk the data rows, collecting a specific
// reason for every row it skips (missing field, unknown department, duplicate staff ID) so
// the UI can show the person exactly what to fix instead of a bare "3 skipped".
function importStaffFromSheet(
  sheet: XLSX.WorkSheet,
  findDepartment: (code: string) => { id: number } | undefined,
  findExistingStaff: (staffId: string) => { id: number } | undefined,
  insertStaff: (staffId: string, name: string, email: string | null, designation: string | null, deptId: number) => void
) {
  const headerRow = ((XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as any[]) || []).map(h => String(h ?? "").trim())
  const staffIdCol = findColumn(headerRow, STAFF_ID_ALIASES)
  const nameCol = findColumn(headerRow, NAME_ALIASES)
  const deptCol = findColumn(headerRow, DEPARTMENT_ALIASES)

  const missingColumns: string[] = []
  if (!staffIdCol) missingColumns.push("Staff ID")
  if (!nameCol) missingColumns.push("Name")
  if (!deptCol) missingColumns.push("Department")
  if (missingColumns.length) {
    return {
      success: false,
      error: `This Excel file is missing required column(s): ${missingColumns.join(", ")}. The first row must have a column for Staff ID, Name and Department.`,
      missingColumns
    }
  }

  const rows: any[] = XLSX.utils.sheet_to_json(sheet)
  if (rows.length === 0) {
    return { success: false, error: "This Excel file has no data rows below the header." }
  }

  let inserted = 0
  const issues: { row: number; reason: string }[] = []
  rows.forEach((row, idx) => {
    const excelRow = idx + 2 // +1 for 0-index, +1 for the header row
    const staffId = String(row[staffIdCol!] ?? "").trim()
    const name = String(row[nameCol!] ?? "").trim()
    const deptCode = String(row[deptCol!] ?? "").trim()

    const missing: string[] = []
    if (!staffId) missing.push("Staff ID")
    if (!name) missing.push("Name")
    if (!deptCode) missing.push("Department")
    if (missing.length) {
      issues.push({ row: excelRow, reason: `Missing ${missing.join(", ")}` })
      return
    }

    const dept = findDepartment(deptCode)
    if (!dept) {
      issues.push({ row: excelRow, reason: `Department "${deptCode}" does not match any existing department (check Master Data → Departments).` })
      return
    }

    if (findExistingStaff(staffId)) {
      issues.push({ row: excelRow, reason: `Staff ID "${staffId}" already exists — skipped.` })
      return
    }

    insertStaff(staffId, name, row["Email"] ?? null, row["Designation"] ?? null, dept.id)
    inserted++
  })

  return { success: true, inserted, skipped: issues.length, issues }
}

export function registerMasterHandlers() {
  // DEPARTMENTS
  ipcMain.handle("master:getDepartments", () => db.query("SELECT * FROM departments ORDER BY name"))
  ipcMain.handle("master:saveDepartment", async (_, data) => {
    if (data.id) {
      db.run("UPDATE departments SET code=?,name=?,is_active=? WHERE id=?", [data.code, data.name, data.is_active ? 1 : 0, data.id])
      return db.queryOne("SELECT * FROM departments WHERE id=?", [data.id])
    }
    const { lastInsertRowid } = db.run("INSERT INTO departments(code,name) VALUES(?,?)", [data.code, data.name])
    return db.queryOne("SELECT * FROM departments WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("master:deleteDepartment", async (_, id) => {
    const inUse = db.queryOne("SELECT id FROM users WHERE department_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: staff assigned to this department." }
    db.run("DELETE FROM departments WHERE id=?", [id]); return { success: true }
  })

  // USERS
  ipcMain.handle("master:getUsers", async (_, filters) => {
    let sql = `SELECT u.*, d.name as department_name, d.code as department_code
               FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE 1=1`
    const params: any[] = []
    if (filters?.role) { sql += ` AND u.role=?`; params.push(filters.role) }
    if (filters?.is_active !== undefined) { sql += ` AND u.is_active=?`; params.push(filters.is_active ? 1 : 0) }
    if (filters?.department_id) { sql += ` AND u.department_id=?`; params.push(filters.department_id) }
    sql += ` ORDER BY d.code, u.name`
    return db.query(sql, params)
  })
  ipcMain.handle("master:saveUser", async (_, data) => {
    const hash = data.password ? await bcrypt.hash(data.password, 12) : null
    if (data.id) {
      let sql = `UPDATE users SET staff_id=?,name=?,email=?,designation=?,role=?,department_id=?,is_active=?,updated_at=datetime('now')`
      const params: any[] = [data.staff_id, data.name, data.email??null, data.designation??null, data.role??"staff", data.department_id??null, data.is_active?1:0]
      if (hash) { sql += `,password_hash=?`; params.push(hash) }
      sql += ` WHERE id=?`; params.push(data.id)
      db.run(sql, params)
      return db.queryOne("SELECT * FROM users WHERE id=?", [data.id])
    }
    const { lastInsertRowid } = db.run(
      "INSERT INTO users(staff_id,name,email,designation,role,department_id,is_active,password_hash) VALUES(?,?,?,?,?,?,?,?)",
      [data.staff_id, data.name, data.email??null, data.designation??null, data.role??"staff", data.department_id??null, 1, hash]
    )
    return db.queryOne("SELECT * FROM users WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("master:deleteUser", async (_, id) => {
    db.run("UPDATE users SET is_active=0 WHERE id=?", [id]); return { success: true }
  })
  ipcMain.handle("master:hardDeleteUser", async (_, id) => hardDeleteUser(id))
  ipcMain.handle("master:importUsersFromExcel", async (_, filePath) => {
    try {
      const wb = XLSX.readFile(filePath)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      return importStaffFromSheet(sheet, (code) =>
        db.queryOne<any>("SELECT id FROM departments WHERE code=? COLLATE NOCASE OR name=? COLLATE NOCASE", [code, code]),
        (staffId) => db.queryOne<any>("SELECT id FROM users WHERE staff_id=?", [staffId]),
        (staffId, name, email, designation, deptId) =>
          db.run(
            "INSERT INTO users(staff_id,name,email,designation,department_id,role,is_active) VALUES(?,?,?,?,?,?,?)",
            [staffId, name, email, designation, deptId, "staff", 1]
          )
      )
    } catch(e: any) { return { success: false, error: e.message } }
  })

  // HALLS
  // id is an explicit tiebreak: sort_order defaults to 0 for every hall and the
  // UI never sets it, so without this the row order is undefined SQL tie-break
  // behavior — and this array's order is what the rotation engine indexes into.
  ipcMain.handle("master:getHalls", () => db.query("SELECT * FROM halls ORDER BY sort_order, id"))
  ipcMain.handle("master:saveHall", async (_, data) => {
    // Halls are identified by code and floor; the NOT NULL name column just mirrors the code.
    const name = data.hall_code
    const floor = (data.floor && String(data.floor).trim()) || null
    if (data.id) {
      db.run("UPDATE halls SET hall_code=?,name=?,floor=?,capacity=?,block=?,is_active=? WHERE id=?",
        [data.hall_code, name, floor, data.capacity??0, data.block??null, data.is_active?1:0, data.id])
      return db.queryOne("SELECT * FROM halls WHERE id=?", [data.id])
    }
    const maxOrder = db.queryOne<any>("SELECT MAX(sort_order) as m FROM halls")
    const { lastInsertRowid } = db.run("INSERT INTO halls(hall_code,name,floor,capacity,block,is_active,sort_order) VALUES(?,?,?,?,?,?,?)",
      [data.hall_code, name, floor, data.capacity??0, data.block??null, 1, (maxOrder?.m??0)+1])
    return db.queryOne("SELECT * FROM halls WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("master:deleteHall", async (_, id) => {
    const inUse = db.queryOne("SELECT id FROM allocations WHERE hall_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: hall has existing allocations." }
    db.run("DELETE FROM halls WHERE id=?", [id]); return { success: true }
  })

  // SETTINGS
  ipcMain.handle("master:getSettings", () => {
    const rows = db.query<any>("SELECT key,value FROM settings")
    return Object.fromEntries(rows.map((r: any) => [r.key, r.value]))
  })
  ipcMain.handle("master:saveSetting", async (_, key, value) => {
    db.run("UPDATE settings SET value=? WHERE key=?", [value, key]); return { success: true }
  })

  // DASHBOARD STATS
  ipcMain.handle("master:dashboardStats", () => {
    return {
      totalStaff:       db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE is_active=1 AND role='staff'")?.c ?? 0,
      totalHalls:       db.queryOne<any>("SELECT COUNT(*) as c FROM halls WHERE is_active=1")?.c ?? 0,
      totalCycles:      db.queryOne<any>("SELECT COUNT(*) as c FROM exam_cycles")?.c ?? 0,
      confirmedSessions:db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE status IN ('confirmed','published')")?.c ?? 0,
      // Sessions from today (local date) onwards, whatever their status.
      upcomingSessions: db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE exam_date >= date('now','localtime')")?.c ?? 0,
      // Sessions that still need an allocation to be generated/confirmed.
      pendingAllocations: db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE status NOT IN ('confirmed','published')")?.c ?? 0,
      allocatedHalls:   db.queryOne<any>(`SELECT COUNT(DISTINCT a.hall_id) as c FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.status IN ('confirmed','published')`)?.c ?? 0,
      totalExamDays:    db.queryOne<any>("SELECT COUNT(DISTINCT exam_date) as c FROM exam_sessions")?.c ?? 0
    }
  })
}
