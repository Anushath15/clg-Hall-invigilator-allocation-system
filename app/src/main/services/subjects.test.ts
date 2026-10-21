/**
 * Subjects against the desktop database: the subject master with its staff, the subject each class
 * writes in a session's seating, and invigilators kept out of halls writing their subject.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { initDatabase, db } from "../db/database"
import { saveHall } from "./master.service"
import { getOrCreateAllocation } from "./allocation.service"
import { saveStudent, autoConfigureSeating, confirmSeating, getSeatingConfig } from "../../shared/students"
import { saveSubject, listSubjects, deleteSubject, importSubjects, getSubjectConflicts, setSubjectStudents, importStudentSubjects } from "../../shared/subjects"
import { categoryKey } from "../../shared/categories"

beforeAll(async () => { await initDatabase({ inMemory: true }) })
beforeEach(() => {
  for (const t of ["student_subjects", "staff_subjects", "subjects", "seat_allocations", "seating_configs", "students", "rotation_history", "allocations", "exam_sessions", "exam_cycles", "halls"]) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM users WHERE role='staff'")
  db.run("DELETE FROM departments")
  db.run("INSERT INTO departments(code, name) VALUES('CSE', 'Computer Science'), ('ECE', 'Electronics')")
})

const dept = (code: string) => db.queryOne<any>("SELECT id FROM departments WHERE code = ?", [code])!.id
let n = 0
function addStudents(count: number, code: string, batch: string) {
  return Array.from({ length: count }, () => {
    n++
    const r = saveStudent(db, { roll_no: `R${n}`, register_no: `REG${n}`, name: `Student ${n}`, gender: "M", section: "A", batch, department_id: dept(code) })
    if (!r.success) throw new Error(r.error)
    return r.student.id as number
  })
}
const addStaff = (id: string) => db.run("INSERT INTO users(staff_id, name, role, is_active) VALUES(?, ?, 'staff', 1)", [id, `Staff ${id}`]).lastInsertRowid

describe("Subject master", () => {
  it("saves a subject with the staff who handle it, and rejects a code used twice", () => {
    const a = addStaff("ST1"), b = addStaff("ST2")
    const r = saveSubject(db, { code: "CS301", name: "Compiler Design", department_id: dept("CSE"), staff_ids: [a, b] })
    expect(r.success).toBe(true)
    expect(listSubjects(db)).toEqual([expect.objectContaining({ code: "CS301", name: "Compiler Design", department_code: "CSE", staff: [expect.objectContaining({ staff_id: "ST1" }), expect.objectContaining({ staff_id: "ST2" })] })])
    expect(saveSubject(db, { code: "cs301", name: "Other" })).toMatchObject({ success: false, error: expect.stringMatching(/already used/) })
    expect(saveSubject(db, { code: "", name: "X" })).toMatchObject({ success: false })
  })

  it("imports subjects from a sheet with staff ids, reporting unknown ones", () => {
    addStaff("ST9")
    const r = importSubjects(db, [["Subject Code", "Subject Name", "Department", "Staff IDs"], ["MA101", "Maths", "", "ST9; NOPE"], ["EC201", "Signals", "ECE", ""], ["", "No code", "", ""]])
    expect(r).toMatchObject({ success: true, inserted: 2, skipped: 1 })
    expect(listSubjects(db).find(s => s.code === "MA101")!.staff.map((u: any) => u.staff_id)).toEqual(["ST9"])
    expect(importSubjects(db, [["Name"], ["x"]])).toMatchObject({ success: false })
  })

  it("deleting a subject removes its staff mapping", () => {
    const a = addStaff("ST1")
    const r = saveSubject(db, { code: "X1", name: "X", staff_ids: [a] }) as { id: number }
    deleteSubject(db, r.id)
    expect(db.query("SELECT * FROM staff_subjects")).toEqual([])
  })
})

describe("Subjects in a session", () => {
  it("seats by the subject each class writes and keeps invigilators out of halls writing their subject", async () => {
    const FINAL = "2023-2027", THIRD = "2024-2028"
    const ids = [...addStudents(16, "CSE", FINAL), ...addStudents(16, "ECE", THIRD)]
    const h1 = saveHall({ hall_code: "A1", bench_rows: 4, bench_cols: 2, is_active: true }).id
    const h2 = saveHall({ hall_code: "A2", bench_rows: 4, bench_cols: 2, is_active: true }).id
    const cycle = db.run("INSERT INTO exam_cycles(name, academic_year) VALUES('Nov', '2026-27')").lastInsertRowid
    const session = db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, '2099-11-20', 'FN', 1)", [cycle]).lastInsertRowid
    const s1 = addStaff("T1"), s2 = addStaff("T2")
    const cs = saveSubject(db, { code: "CS401", name: "AI", staff_ids: [s1] }) as { id: number }
    const ec = saveSubject(db, { code: "EC301", name: "VLSI", staff_ids: [s2] }) as { id: number }
    await getOrCreateAllocation(session, [s1, s2], [h1, h2])

    const subjects = { [categoryKey(dept("CSE"), FINAL)]: cs.id, [categoryKey(dept("ECE"), THIRD)]: ec.id }
    const auto = autoConfigureSeating(db, session, ids, undefined, { subjects })
    if (!auto.success) throw new Error(auto.error)
    expect(auto.classes.map(c => c.count)).toEqual([16, 16])
    const saved = await confirmSeating(db, session, ids, { ...auto.config, subjects }, { acceptUnallocated: true })
    expect(saved.success).toBe(true)
    expect(getSeatingConfig(db, session)!.config.subjects).toEqual(subjects)

    // Both halls hold both papers, so each invigilator clashes whatever the hall: kept, but reported.
    await getOrCreateAllocation(session, [s1, s2], [h1, h2])
    expect(db.query("SELECT * FROM seat_allocations WHERE session_id = ?", [session]).length).toBe(32) // seating kept
    expect(getSubjectConflicts(db, session).map(c => c.staffId).sort()).toEqual(["T1", "T2"])
  })

  it("a teacher is moved to a hall that does not write their subject when one exists", async () => {
    const FINAL = "2023-2027"
    const ids = addStudents(16, "CSE", FINAL)
    const halls = [1, 2, 3].map(i => saveHall({ hall_code: `B${i}`, bench_rows: 4, bench_cols: 2, is_active: true }).id)
    const cycle = db.run("INSERT INTO exam_cycles(name, academic_year) VALUES('Nov', '2026-27')").lastInsertRowid
    const session = db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, '2099-11-21', 'FN', 1)", [cycle]).lastInsertRowid
    const staff = ["U1", "U2", "U3"].map(addStaff)
    const cs = saveSubject(db, { code: "CS402", name: "ML", staff_ids: [staff[0]] }) as { id: number }
    const subjects = { [categoryKey(dept("CSE"), FINAL)]: cs.id }
    for (let k = 0; k < 6; k++) {
      // Different sessions give different draws; in each, U1 must not be in the hall seating CS402.
      const sess = k === 0 ? session : db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, ?, 'FN', 1)", [cycle, `2099-12-0${k}`]).lastInsertRowid
      await getOrCreateAllocation(sess, staff, halls)
      // Only the first hall is used, so only it writes CS402 (one student per bench: a single paper).
      const auto = autoConfigureSeating(db, sess, ids, undefined, { subjects })
      if (!auto.success) throw new Error(auto.error)
      const only = { ...auto.config, halls: auto.config.halls.map((h, i) => ({ ...h, pattern: i === 0 ? ["MM" as const] : [] })), subjects }
      const saved = await confirmSeating(db, sess, ids, only, { acceptUnallocated: true })
      expect(saved.success).toBe(true)
      await getOrCreateAllocation(sess, staff, halls)
      expect(getSubjectConflicts(db, sess)).toEqual([])
    }
  })
})

describe("Students mapped to subjects", () => {
  it("maps students to a subject, by hand and from a sheet", () => {
    const ids = addStudents(3, "CSE", "2023-2027")
    const sub = saveSubject(db, { code: "EL1", name: "Elective 1" }) as { id: number }
    saveSubject(db, { code: "EL2", name: "Elective 2" })
    expect(setSubjectStudents(db, sub.id, [ids[0], ids[1]])).toMatchObject({ success: true, count: 2 })
    expect(listSubjects(db).find(s => s.code === "EL1")!.student_ids.sort()).toEqual([ids[0], ids[1]].sort())
    const roll = db.queryOne<any>("SELECT roll_no FROM students WHERE id = ?", [ids[2]])!.roll_no
    const r = importStudentSubjects(db, [["Roll No", "Subject Codes"], [roll, "EL1; EL2; NOPE"], ["MISSING", "EL1"]])
    expect(r).toMatchObject({ success: true, inserted: 2, skipped: 2 })
    expect(listSubjects(db).find(s => s.code === "EL2")!.student_ids).toEqual([ids[2]])
  })

  it("seats each student by the subject they are mapped to, and finds invigilator clashes from it", async () => {
    const FINAL = "2023-2027"
    const ids = addStudents(8, "CSE", FINAL)
    const h = saveHall({ hall_code: "C1", bench_rows: 4, bench_cols: 1, is_active: true }).id
    const cycle = db.run("INSERT INTO exam_cycles(name, academic_year) VALUES('Nov', '2026-27')").lastInsertRowid
    const session = db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, '2099-11-25', 'FN', 1)", [cycle]).lastInsertRowid
    const t = addStaff("E1")
    const e1 = saveSubject(db, { code: "E1", name: "Elective 1", staff_ids: [t] }) as { id: number }
    const e2 = saveSubject(db, { code: "E2", name: "Elective 2" }) as { id: number }
    setSubjectStudents(db, e1.id, ids.slice(0, 4)); setSubjectStudents(db, e2.id, ids.slice(4))
    await getOrCreateAllocation(session, [t], [h])
    const auto = autoConfigureSeating(db, session, ids, undefined, { sessionSubjects: [e1.id, e2.id] })
    if (!auto.success) throw new Error(auto.error)
    expect(auto.classes[0]).toMatchObject({ count: 8, mapped: 8 })
    expect(auto.mappedSubjects.sort((a, b) => a.id - b.id)).toEqual([{ id: e1.id, count: 4 }, { id: e2.id, count: 4 }])
    // One class, but two electives: all 8 fit on 4 benches (by class alone only 4 could sit).
    const saved = await confirmSeating(db, session, ids, { ...auto.config, sessionSubjects: [e1.id, e2.id] })
    expect(saved).toMatchObject({ success: true, seated: 8 })
    expect(getSubjectConflicts(db, session).map(c => c.subjectCode)).toEqual(["E1"])
  })
})
