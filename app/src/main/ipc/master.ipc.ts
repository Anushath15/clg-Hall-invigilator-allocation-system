import { ipcMain } from "electron"
import { db } from "../db/database"
import * as XLSX from "xlsx"
import { hardDeleteUser } from "../services/allocation.service"
import { validateCollegeName, validateCollegeShortName, validateTimeOfDay } from "../../shared/validation"
import { saveDepartment, saveHall, saveUser, findDepartmentByCodeOrName, listUsers, USER_COLUMNS } from "../services/master.service"
import { importStaffFromSheet } from "../../shared/staff-import"

export function registerMasterHandlers() {
  // DEPARTMENTS
  ipcMain.handle("master:getDepartments", () => db.query("SELECT * FROM departments ORDER BY name"))
  ipcMain.handle("master:saveDepartment", async (_, data) => saveDepartment(data))
  ipcMain.handle("master:deleteDepartment", async (_, id) => {
    const inUse = db.queryOne("SELECT id FROM users WHERE department_id=?", [id])
    if (inUse) return { success: false, error: "Cannot delete: staff assigned to this department." }
    db.run("DELETE FROM departments WHERE id=?", [id]); return { success: true }
  })

  // USERS
  ipcMain.handle("master:getUsers", async (_, filters) => listUsers(filters))
  // Staff are data records only: they never sign in to the desktop app, so no passwords.
  ipcMain.handle("master:saveUser", async (_, data) => saveUser(data))
  ipcMain.handle("master:deleteUser", async (_, id) => {
    db.run("UPDATE users SET is_active=0 WHERE id=?", [id]); return { success: true }
  })
  ipcMain.handle("master:hardDeleteUser", async (_, id) => hardDeleteUser(id))
  ipcMain.handle("master:importUsersFromExcel", async (_, filePath) => {
    try {
      const wb = XLSX.readFile(filePath)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      return importStaffFromSheet(sheet, findDepartmentByCodeOrName,
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
  ipcMain.handle("master:saveHall", async (_, data) => saveHall(data))
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
    const problem = key === "college.name" ? validateCollegeName(value)
      : key === "college.short_name" ? validateCollegeShortName(value)
      : /^session\.(fn|an)_(reporting|start|end)_time$/.test(key) ? validateTimeOfDay(value) // each default time must be a valid HH:MM
      : null
    if (problem) return { success: false, error: problem }
    db.run("UPDATE settings SET value=? WHERE key=?", [String(value).trim(), key]); return { success: true }
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
