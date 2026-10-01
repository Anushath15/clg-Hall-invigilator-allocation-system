/**
 * Department codes are saved exactly as typed but compared case-insensitively
 * (duplicates, sorting, and the Excel staff import).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import * as XLSX from "xlsx"
import { initDatabase, db } from "../db/database"
import { saveDepartment, findDepartmentByCodeOrName, listUsers } from "./master.service"
import { getSessionAllocationFull } from "./allocation.service"
import { getCompleteTimetable } from "./report.service"
import { importStaffFromSheet } from "../../shared/staff-import"

beforeAll(async () => { await initDatabase({ inMemory: true }) })
beforeEach(() => {
  for (const t of ["rotation_history", "allocations", "exam_sessions", "exam_cycles", "halls"]) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM users WHERE role='staff'")
  db.run("DELETE FROM departments")
})

const codes = () => db.query<any>("SELECT code FROM departments ORDER BY id").map(r => r.code)
const deptId = (code: string) => db.queryOne<any>("SELECT id FROM departments WHERE code = ?", [code])!.id
function addStaff(staffId: string, name: string, code: string) {
  db.run("INSERT INTO users(staff_id, name, role, department_id, is_active) VALUES(?,?,'staff',?,1)", [staffId, name, deptId(code)])
  return db.queryOne<any>("SELECT id FROM users WHERE staff_id = ?", [staffId])!.id
}

describe("Department codes", () => {
  it("are saved exactly as typed", () => {
    for (const code of ["cse", "Ece", "MECH"]) expect(saveDepartment({ code, name: `Dept ${code}` }).success).toBe(true)
    expect(codes()).toEqual(["cse", "Ece", "MECH"])
  })

  it("CSE and cse are duplicates, whichever is saved first", () => {
    expect(saveDepartment({ code: "CSE", name: "Computer Science" }).success).toBe(true)
    for (const code of ["cse", "Cse", "CSE"]) {
      const r = saveDepartment({ code, name: "Another" })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/"CSE" already exists/)
    }
    expect(saveDepartment({ code: "ece", name: "Electronics" }).success).toBe(true)
    expect(saveDepartment({ code: "ECE", name: "Electronics again" }).success).toBe(false)
    expect(codes()).toEqual(["CSE", "ece"])
  })

  it("a missing or blank code or name is refused with a message, and nothing is saved", () => {
    for (const bad of [{}, { code: "  ", name: "Blank code" }, { code: "CSE", name: " " }, { code: "CSE" }] as any[]) {
      expect(saveDepartment(bad)).toEqual({ success: false, error: "Code and Name are required." })
    }
    expect(codes()).toEqual([])
  })

  it("editing may change the case of a department's own code, but not take another's", () => {
    const cse = saveDepartment({ code: "CSE", name: "Computer Science" }).department
    const ece = saveDepartment({ code: "ECE", name: "Electronics" }).department
    expect(saveDepartment({ ...cse, code: "Cse" }).success).toBe(true)
    expect(saveDepartment({ ...ece, code: "cse" }).success).toBe(false)
    expect(codes()).toEqual(["Cse", "ECE"])
  })

  it("existing uppercase departments stay compatible without a migration", () => {
    // Rows saved by the old form, which forced uppercase.
    db.run("INSERT INTO departments(code, name) VALUES('CSE', 'Computer Science'), ('ECE', 'Electronics')")
    const cse = db.queryOne<any>("SELECT * FROM departments WHERE code = 'CSE'")
    expect(saveDepartment({ ...cse, name: "Computer Science and Engineering" }).success).toBe(true)
    expect(saveDepartment({ code: "ece", name: "Duplicate" }).success).toBe(false)
    expect(findDepartmentByCodeOrName("ece")?.id).toBe(deptId("ECE"))
    expect(findDepartmentByCodeOrName("CSE")?.id).toBe(deptId("CSE"))
  })

  it("sort ignoring case in the staff list, a session's allocation and the timetable", () => {
    // Case-sensitive order would be CSE, MECH, ece; ignoring case it is CSE, ece, MECH.
    for (const [code, name] of [["CSE", "Computer Science"], ["MECH", "Mechanical"], ["ece", "Electronics"]]) saveDepartment({ code, name })
    const ids = [addStaff("S1", "Mala", "MECH"), addStaff("S2", "Bala", "ece"), addStaff("S3", "Anu", "CSE")]
    const expected = ["CSE", "ece", "MECH"]

    expect(listUsers({ role: "staff" }).map((u: any) => u.department_code)).toEqual(expected)

    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(1, 'Batch', '2026-27', 'draft')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(1, 1, '2026-11-01', 'FN', 1, 'draft')")
    ids.forEach((userId, i) => {
      db.run("INSERT INTO halls(id, hall_code, name, capacity, sort_order, is_active) VALUES(?,?,?,30,?,1)", [i + 1, `H${i + 1}`, `H${i + 1}`, i + 1])
      db.run("INSERT INTO allocations(session_id, user_id, hall_id, generated_hall_id) VALUES(1, ?, ?, ?)", [userId, i + 1, i + 1])
    })
    expect(getSessionAllocationFull(1).map((a: any) => a.deptCode)).toEqual(expected)
    expect(getCompleteTimetable(1).users.map((u: any) => u.deptCode)).toEqual(expected)
  })
})

describe("Excel staff import: department matching", () => {
  function runImport(rows: (string | number)[][]) {
    const sheet = XLSX.utils.aoa_to_sheet([["Staff ID", "Name", "Department"], ...rows])
    return importStaffFromSheet(sheet, findDepartmentByCodeOrName,
      staffId => db.queryOne<any>("SELECT id FROM users WHERE staff_id = ?", [staffId]),
      (staffId, name, email, designation, deptId) =>
        db.run("INSERT INTO users(staff_id, name, email, designation, department_id, role, is_active) VALUES(?,?,?,?,?,'staff',1)",
          [staffId, name, email, designation, deptId]))
  }
  const deptOf = (staffId: string) => db.queryOne<any>("SELECT department_id FROM users WHERE staff_id = ?", [staffId])?.department_id

  it("matches department codes and names in any case, including existing uppercase codes", () => {
    db.run("INSERT INTO departments(code, name) VALUES('CSE', 'Computer Science')") // saved by the old uppercase form
    saveDepartment({ code: "ece", name: "Electronics and Communication" })
    saveDepartment({ code: "Mech", name: "Mechanical Engineering" })

    const r: any = runImport([
      ["S1", "Anitha", "cse"], ["S2", "Bala", "Cse"], ["S3", "Chitra", "ECE"],
      ["S4", "Dinesh", "mech"], ["S5", "Esther", "mechanical engineering"], ["S6", "Faizal", "CIVIL"]
    ])
    expect(r.inserted).toBe(5)
    expect(r.issues).toEqual([{ row: 7, reason: expect.stringContaining('"CIVIL" does not match') }])
    expect([deptOf("S1"), deptOf("S2")]).toEqual([deptId("CSE"), deptId("CSE")])
    expect(deptOf("S3")).toBe(deptId("ece"))
    expect([deptOf("S4"), deptOf("S5")]).toEqual([deptId("Mech"), deptId("Mech")])
  })

  it("prefers a code match over another department's name", () => {
    saveDepartment({ code: "ITS", name: "it" }) // older department whose name is "it"
    saveDepartment({ code: "IT", name: "Information Technology" })
    expect(findDepartmentByCodeOrName("It")?.id).toBe(deptId("IT"))
  })
})
