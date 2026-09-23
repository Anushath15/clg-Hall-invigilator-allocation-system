import { ipcMain } from "electron"
import { db } from "../db/database"
import * as XLSX from "xlsx"
import bcrypt from "bcryptjs"

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
  ipcMain.handle("master:importUsersFromExcel", async (_, filePath) => {
    try {
      const wb = XLSX.readFile(filePath)
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      let inserted = 0, skipped = 0
      for (const row of rows) {
        const staffId = String(row["Staff ID"] ?? row["staff_id"] ?? "").trim()
        const name = String(row["Name"] ?? row["name"] ?? "").trim()
        if (!staffId || !name) { skipped++; continue }
        const deptCode = String(row["Department"] ?? row["department"] ?? "").trim()
        const dept = deptCode ? db.queryOne<any>("SELECT id FROM departments WHERE code=?", [deptCode]) : null
        const exists = db.queryOne("SELECT id FROM users WHERE staff_id=?", [staffId])
        if (!exists) {
          db.run(
            "INSERT INTO users(staff_id,name,email,designation,department_id,role,is_active) VALUES(?,?,?,?,?,?,?)",
            [staffId, name, row["Email"]??null, row["Designation"]??null, dept?.id??null, "staff", 1]
          )
          inserted++
        } else skipped++
      }
      return { success: true, inserted, skipped }
    } catch(e: any) { return { success: false, error: e.message } }
  })

  // HALLS
  // id is an explicit tiebreak: sort_order defaults to 0 for every hall and the
  // UI never sets it, so without this the row order is undefined SQL tie-break
  // behavior — and this array's order is what the rotation engine indexes into.
  ipcMain.handle("master:getHalls", () => db.query("SELECT * FROM halls ORDER BY sort_order, id"))
  ipcMain.handle("master:saveHall", async (_, data) => {
    if (data.id) {
      db.run("UPDATE halls SET hall_code=?,name=?,capacity=?,block=?,is_active=? WHERE id=?",
        [data.hall_code, data.name, data.capacity??0, data.block??null, data.is_active?1:0, data.id])
      return db.queryOne("SELECT * FROM halls WHERE id=?", [data.id])
    }
    const maxOrder = db.queryOne<any>("SELECT MAX(sort_order) as m FROM halls")
    const { lastInsertRowid } = db.run("INSERT INTO halls(hall_code,name,capacity,block,is_active,sort_order) VALUES(?,?,?,?,?,?)",
      [data.hall_code, data.name, data.capacity??0, data.block??null, 1, (maxOrder?.m??0)+1])
    return db.queryOne("SELECT * FROM halls WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("master:deleteHall", async (_, id) => {
    const inUse = db.queryOne("SELECT id FROM allocations WHERE hall_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: hall has existing allocations." }
    db.run("DELETE FROM halls WHERE id=?", [id]); return { success: true }
  })
  ipcMain.handle("master:reorderHalls", async (_, hallIds: number[]) => {
    hallIds.forEach((id, i) => db.run("UPDATE halls SET sort_order=? WHERE id=?", [i+1, id]))
    return { success: true }
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
    const today = new Date().toISOString().split("T")[0]
    return {
      totalStaff:       db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE is_active=1 AND role='staff'")?.c ?? 0,
      totalHalls:       db.queryOne<any>("SELECT COUNT(*) as c FROM halls WHERE is_active=1")?.c ?? 0,
      totalCycles:      db.queryOne<any>("SELECT COUNT(*) as c FROM exam_cycles")?.c ?? 0,
      confirmedSessions:db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE status IN ('confirmed','published')")?.c ?? 0,
      upcomingSessions: db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions WHERE exam_date>=? AND status != 'published'", [today])?.c ?? 0,
      allocatedHalls:   db.queryOne<any>(`SELECT COUNT(DISTINCT a.hall_id) as c FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.status IN ('confirmed','published')`)?.c ?? 0,
      totalExamDays:    db.queryOne<any>("SELECT COUNT(DISTINCT exam_date) as c FROM exam_sessions")?.c ?? 0
    }
  })
}
