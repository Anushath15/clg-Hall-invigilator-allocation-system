/**
 * OFFLINE DESKTOP: the complete admin workflow runs against a local database file with
 * every network API disabled, the local administrator needs no login, a fresh install
 * creates its own database, and databases from older versions open without losing data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import http from "http"
import https from "https"
import net from "net"
import tls from "tls"
import dns from "dns"
import * as XLSX from "xlsx"
import initSqlJs from "sql.js"
import { initDatabase, db, getDbPath } from "../db/database"
import { getLocalAdmin, ensureDefaultAdmin } from "./auth.service"
import { saveDepartment, findDepartmentByCodeOrName, listUsers } from "./master.service"
import { getOrCreateAllocation, editAllocationEntry, confirmAllocation, publishAllocation, getSessionAllocationFull, getStaffDutyHistory, restartRotation } from "./allocation.service"
import { getStaffWiseReport, getDateWiseReport, getCompleteTimetable, getRotationAuditReport } from "./report.service"
import { backupDatabase, restoreDatabase, checkBackupFile } from "./backup.service"
import { importStaffFromSheet } from "../../shared/staff-import"
import { STAFF_DUTY_FIELDS, splitStaffDuties } from "../../shared/staff-duty"

// ─── Network tripwire: any attempt to use the network fails the test ─────────
const networkAttempts: string[] = []
const restores: (() => void)[] = []
function tripwire(obj: any, key: string, label: string) {
  const original = obj[key]
  obj[key] = (..._args: any[]) => { networkAttempts.push(label); throw new Error(`Network use is not allowed offline: ${label}`) }
  restores.push(() => { obj[key] = original })
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hias-offline-"))
const dbFile = path.join(tmp, "eias.db")
const count = (table: string, where = "1=1") => db.queryOne<any>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`)!.c

beforeAll(() => {
  for (const [obj, name] of [[http, "http"], [https, "https"]] as const) { tripwire(obj, "request", `${name}.request`); tripwire(obj, "get", `${name}.get`) }
  tripwire(net, "connect", "net.connect"); tripwire(net, "createConnection", "net.createConnection")
  tripwire(tls, "connect", "tls.connect")
  tripwire(dns, "lookup", "dns.lookup"); tripwire(dns, "resolve", "dns.resolve")
  tripwire(globalThis, "fetch", "fetch")
  if ("WebSocket" in globalThis) tripwire(globalThis, "WebSocket", "WebSocket")
})
afterAll(() => {
  restores.forEach(r => r())
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("Offline desktop", () => {
  it("fresh install: creates the database, schema and default settings, with no demo data", async () => {
    expect(fs.existsSync(dbFile)).toBe(false)
    await initDatabase({ path: dbFile, appVersion: "9.9.9" })
    await ensureDefaultAdmin()
    expect(getDbPath()).toBe(dbFile)
    expect(fs.existsSync(dbFile)).toBe(true)

    const tables = db.query<any>("SELECT name FROM sqlite_master WHERE type = 'table'").map(t => t.name)
    for (const t of ["departments", "users", "halls", "settings", "exam_cycles", "exam_sessions", "allocations", "rotation_history", "audit_log", "notifications"]) expect(tables).toContain(t)
    expect(db.query<any>("SELECT name FROM _migrations ORDER BY name").map(m => m.name))
      .toEqual(["001_initial_schema", "002_rotation_global_order", "003_notifications", "004_hall_floor", "005_notification_session"])
    expect(db.queryOne<any>("SELECT value FROM settings WHERE key = 'app.version'")?.value).toBe("9.9.9")
    expect(db.queryOne<any>("SELECT value FROM settings WHERE key = 'session.fn_start_time'")?.value).toBe("10:00")

    // Only the internal administrator identity; no departments, staff, halls or batches.
    expect(count("users", "role = 'admin'")).toBe(1)
    for (const t of ["departments", "halls", "exam_cycles", "exam_sessions", "allocations", "rotation_history"]) expect(count(t)).toBe(0)
    expect(count("users", "role = 'staff'")).toBe(0)
  })

  it("no login: the local administrator is available without a password, and so are staff records", () => {
    const admin = getLocalAdmin()
    expect(admin.success).toBe(true)
    expect(admin.user).toMatchObject({ staff_id: "ADMIN001", role: "admin" })
    expect(admin.user).not.toHaveProperty("password_hash") // nothing secret reaches the window
    expect(db.queryOne<any>("SELECT password_hash FROM users WHERE role = 'admin'")?.password_hash).toBeNull() // no password at all
    expect(listUsers({ role: "staff" })).toEqual([])
    expect(listUsers().every((u: any) => !("password_hash" in u))).toBe(true)
  })

  it("the whole admin workflow runs with the network disabled", async () => {
    // Master data: departments (mixed-case codes), halls, staff imported from Excel.
    for (const [code, name] of [["CSE", "Computer Science"], ["ece", "Electronics"], ["Mech", "Mechanical"]]) {
      expect(saveDepartment({ code, name }).success).toBe(true)
    }
    for (let i = 1; i <= 4; i++) {
      db.run("INSERT INTO halls(hall_code, name, floor, capacity, block, is_active, sort_order) VALUES(?,?,?,30,?,1,?)", [`H00${i}`, `H00${i}`, "1st", "Main Block", i])
    }
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Staff ID", "Name", "Department", "Email", "Designation"],
      ["STF001", "Anitha R", "cse", "anitha@example.edu", "Assistant Professor"],
      ["STF002", "Bala S", "ECE", "", "Associate Professor"],
      ["STF003", "Chitra M", "mech", "", ""],
      ["STF004", "Dinesh K", "Computer Science", "", ""],
      ["STF005", "Unknown Dept", "CIVIL", "", ""],
      ["STF001", "Duplicate", "CSE", "", ""],
    ])
    const imported: any = importStaffFromSheet(sheet, findDepartmentByCodeOrName,
      staffId => db.queryOne<any>("SELECT id FROM users WHERE staff_id = ?", [staffId]),
      (staffId, name, email, designation, deptId) => db.run(
        "INSERT INTO users(staff_id,name,email,designation,department_id,role,is_active) VALUES(?,?,?,?,?,'staff',1)",
        [staffId, name, email, designation, deptId]))
    expect(imported.inserted).toBe(4)
    expect(imported.issues.map((i: any) => i.row)).toEqual([6, 7]) // unknown department, duplicate staff ID
    const staff = listUsers({ role: "staff", is_active: true }) as any[]
    expect(staff.map(s => s.staff_id).sort()).toEqual(["STF001", "STF002", "STF003", "STF004"])

    // An allocation batch with two sessions.
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(1, 'November 2026', '2026-27', 'draft')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, reporting_time, exam_start, exam_end, status) VALUES(1, 1, '2099-11-02', 'FN', 1, '09:30', '10:00', '13:00', 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, reporting_time, exam_start, exam_end, status) VALUES(2, 1, '2099-11-02', 'AN', 2, '13:30', '14:00', '17:00', 'pending')")
    const userIds = staff.map(s => s.id), hallIds = db.query<any>("SELECT id FROM halls ORDER BY sort_order").map(h => h.id)

    // Generate, check, try an unsafe manual edit, confirm and publish.
    const gen = await getOrCreateAllocation(1, userIds, hallIds)
    expect(gen.validation.isValid).toBe(true)
    const rows = getSessionAllocationFull(1) as any[]
    expect(new Set(rows.map(r => r.hall_code)).size).toBe(4)
    const refused = editAllocationEntry(1, rows[0].userId, rows[1].hallId)
    expect(refused.success).toBe(false)
    expect(refused.error?.rule).toBe("R2")
    expect(editAllocationEntry(1, rows[0].userId, rows[0].hallId).error?.rule).toBe("NO_CHANGE") // no fake "Admin Edited"
    await expect(getOrCreateAllocation(1, [userIds[0], userIds[0], userIds[1], userIds[2]], hallIds)).rejects.toThrow(/selected more than once/)
    expect((await confirmAllocation(1)).success).toBe(true)
    // A confirmed session is locked: no regeneration or edit can put allocations and history out of step.
    await expect(getOrCreateAllocation(1, userIds, [...hallIds].reverse())).rejects.toThrow(/already confirmed/)
    expect(editAllocationEntry(1, rows[0].userId, rows[1].hallId).error?.rule).toBe("LOCKED")
    expect(db.queryOne<any>("SELECT status FROM exam_sessions WHERE id = 1")?.status).toBe("confirmed")
    expect(getSessionAllocationFull(1).map((r: any) => r.hallId)).toEqual(rows.map(r => r.hallId))
    expect(publishAllocation(1)).toMatchObject({ success: true })
    expect(count("notifications", "session_id = 1")).toBe(4) // one duty notice per assigned staff member
    // The next session respects the rotation (no one repeats their session 1 hall).
    const gen2 = await getOrCreateAllocation(2, userIds, hallIds)
    expect(gen2.validation.isValid).toBe(true)
    const first = new Map(rows.map(r => [r.userId, r.hallId]))
    for (const r of getSessionAllocationFull(2) as any[]) expect(r.hallId).not.toBe(first.get(r.userId))

    // Reports.
    expect(getStaffWiseReport().length).toBe(4)
    expect(getDateWiseReport(1).length).toBe(4)
    expect(getCompleteTimetable(1).users.length).toBe(4)
    expect(getRotationAuditReport(1).length).toBeGreaterThan(0)

    // (The session PDF is covered, also with the network disabled, by export-allocation-pdf.test.ts.)

    // Staff duty: the published duty with all its fields.
    const anitha = staff.find(s => s.staff_id === "STF001")
    const duties = getStaffDutyHistory(anitha.id)
    expect(duties.length).toBe(1)
    expect(Object.keys(duties[0]).sort()).toEqual([...STAFF_DUTY_FIELDS].sort())
    expect(duties[0]).toMatchObject({ exam_date: "2099-11-02", session_type: "FN", status: "published", reporting_time: "09:30", exam_start: "10:00", exam_end: "13:00", cycleName: "November 2026" })
    expect(duties[0].hall_code).toBe(rows.find(r => r.userId === anitha.id).hall_code)
    expect(splitStaffDuties(duties, "2026-10-01").next?.hall_code).toBe(duties[0].hall_code)

    // Rotation restart.
    expect(count("rotation_history")).toBe(4)
    expect(restartRotation().success).toBe(true)
    expect(count("rotation_history")).toBe(0)
  })

  it("data persists when the app is restarted", async () => {
    await initDatabase({ path: dbFile })
    expect(count("departments")).toBe(3)
    expect(count("users", "role = 'staff'")).toBe(4)
    expect(count("allocations")).toBe(8)
    expect(getLocalAdmin().success).toBe(true)
  })

  it("backup and restore work locally, with a safety copy, and refuse files that are not HIAS backups", async () => {
    const backup = path.join(tmp, "hias-backup.db")
    expect(backupDatabase(backup)).toEqual({ success: true })
    expect(await checkBackupFile(backup)).toBeNull()

    saveDepartment({ code: "EEE", name: "Electrical" }) // made after the backup
    const beforeRestore = fs.readFileSync(dbFile)

    const notADb = path.join(tmp, "notes.db"); fs.writeFileSync(notADb, "just some text")
    expect((await restoreDatabase(notADb)).error).toMatch(/not a HIAS database/)
    const SQL = await initSqlJs(); const otherDb = new SQL.Database(); otherDb.run("CREATE TABLE something(x)")
    const otherFile = path.join(tmp, "other.db"); fs.writeFileSync(otherFile, Buffer.from(otherDb.export()))
    expect((await restoreDatabase(otherFile)).error).toMatch(/missing: departments/)
    expect(fs.readFileSync(dbFile).equals(beforeRestore)).toBe(true) // nothing replaced

    const restored = await restoreDatabase(backup)
    expect(restored.success).toBe(true)
    expect(fs.readFileSync(restored.safetyCopy!).equals(beforeRestore)).toBe(true)
    expect(fs.readFileSync(dbFile).equals(fs.readFileSync(backup))).toBe(true)

    await initDatabase({ path: dbFile }) // what the app does when it restarts after a restore
    expect(count("departments")).toBe(3)
    expect(count("departments", "code = 'EEE'")).toBe(0)
  })

  it("databases from older versions open with every record kept", async () => {
    // The original (1.0) schema: no migrations table, no rotation order, notifications or hall floor.
    const SQL = await initSqlJs()
    const old = new SQL.Database()
    old.run(`
      CREATE TABLE departments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT, designation TEXT, password_hash TEXT, role TEXT DEFAULT 'staff', department_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
      CREATE TABLE halls (id INTEGER PRIMARY KEY AUTOINCREMENT, hall_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, capacity INTEGER DEFAULT 0, block TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE exam_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, academic_year TEXT NOT NULL, status TEXT DEFAULT 'draft', created_at TEXT, updated_at TEXT);
      CREATE TABLE exam_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL, exam_date TEXT NOT NULL, session_type TEXT NOT NULL, rotation_step INTEGER NOT NULL, reporting_time TEXT, exam_start TEXT, exam_end TEXT, status TEXT DEFAULT 'pending', created_at TEXT, updated_at TEXT);
      CREATE TABLE allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, user_id INTEGER NOT NULL, hall_id INTEGER NOT NULL, is_manually_edited INTEGER DEFAULT 0, edit_reason TEXT, generated_hall_id INTEGER, created_at TEXT, updated_at TEXT, UNIQUE(session_id, user_id), UNIQUE(session_id, hall_id));
      CREATE TABLE rotation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, session_id INTEGER NOT NULL, hall_id INTEGER NOT NULL, rotation_step INTEGER NOT NULL, recorded_at TEXT, UNIQUE(user_id, session_id));
      CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, description TEXT, payload TEXT, created_at TEXT);
      INSERT INTO settings VALUES ('college.name', 'Old College Name'), ('app.version', '1.0.0');
      INSERT INTO departments(code, name) VALUES ('CSE', 'Computer Science'), ('ECE', 'Electronics');
      INSERT INTO users(staff_id, name, role, password_hash, is_active) VALUES ('ADMIN001', 'System Administrator', 'admin', 'old-hash', 1);
      INSERT INTO users(staff_id, name, role, department_id, is_active) VALUES ('S1', 'Asha', 'staff', 1, 1), ('S2', 'Bharath', 'staff', 2, 1), ('S3', 'Chandra', 'staff', 1, 1);
      INSERT INTO halls(hall_code, name, sort_order) VALUES ('H001', 'Hall 1', 1), ('H002', 'Hall 2', 2), ('H003', 'Hall 3', 3);
      INSERT INTO exam_cycles(name, academic_year, status) VALUES ('April 2026', '2025-26', 'draft');
      INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step, status) VALUES (1, '2026-04-01', 'FN', 1, 'confirmed'), (1, '2026-04-01', 'AN', 2, 'pending');
      INSERT INTO allocations(session_id, user_id, hall_id, generated_hall_id) VALUES (1, 2, 1, 1), (1, 3, 2, 2), (1, 4, 3, 3);
      INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, recorded_at) VALUES (4, 1, 3, 1, '2026-04-01 10:02:00'), (2, 1, 1, 1, '2026-04-01 10:00:00'), (3, 1, 2, 1, '2026-04-01 10:01:00');
      INSERT INTO audit_log(action, description) VALUES ('CONFIRM', 'Session 1 confirmed');
    `)
    const oldFile = path.join(tmp, "old-eias.db")
    fs.writeFileSync(oldFile, Buffer.from(old.export()))

    await initDatabase({ path: oldFile, appVersion: "9.9.9" })
    await ensureDefaultAdmin()
    const expected: Record<string, number> = { departments: 2, halls: 3, exam_cycles: 1, exam_sessions: 2, allocations: 3, rotation_history: 3, audit_log: 1 }
    for (const [t, n] of Object.entries(expected)) expect(count(t), t).toBe(n)
    expect(count("users")).toBe(4) // no second administrator created
    expect(db.queryOne<any>("SELECT value FROM settings WHERE key = 'college.name'")?.value).toBe("Old College Name") // user settings kept
    expect(db.queryOne<any>("SELECT value FROM settings WHERE key = 'app.version'")?.value).toBe("9.9.9")
    // New columns and tables were added; rotation order was backfilled in recorded_at order.
    expect(db.query<any>("SELECT user_id FROM rotation_history ORDER BY global_order").map(r => r.user_id)).toEqual([2, 3, 4])
    expect(db.query<any>("PRAGMA table_info(halls)").map(c => c.name)).toContain("floor")
    expect(count("notifications")).toBe(0)
    expect(db.query<any>("PRAGMA table_info(notifications)").map(c => c.name)).toContain("session_id")
    expect(getLocalAdmin().user?.staff_id).toBe("ADMIN001")

    // The next session can be allocated and respects the old history (R1).
    const gen = await getOrCreateAllocation(2, [2, 3, 4], [1, 2, 3])
    expect(gen.validation.isValid).toBe(true)
    const was = new Map([[2, 1], [3, 2], [4, 3]])
    for (const r of getSessionAllocationFull(2) as any[]) expect(r.hallId).not.toBe(was.get(r.userId))
  })

  it("never touched the network", () => {
    expect(networkAttempts).toEqual([])
  })
})
