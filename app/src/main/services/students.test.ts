/**
 * Students and seating against the desktop database: the master list (save, import, delete),
 * hall bench layouts, and a session's seating plan (generate, read back, clean-up).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { initDatabase, db } from "../db/database"
import { saveHall } from "./master.service"
import { getOrCreateAllocation, deleteSession } from "./allocation.service"
import {
  saveStudent, listStudents, listStudentBatches, deleteStudent, importStudents,
  generateSeating, getSessionSeating, getSeatingSelections, clearSeating,
  getSeatingConfig, autoConfigureSeating, previewSeating, confirmSeating
} from "../../shared/students"

beforeAll(async () => { await initDatabase({ inMemory: true }) })
beforeEach(() => {
  for (const t of ["seat_allocations", "seating_configs", "students", "rotation_history", "allocations", "exam_sessions", "exam_cycles", "halls"]) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM users WHERE role='staff'")
  db.run("DELETE FROM departments")
  db.run("INSERT INTO departments(code, name) VALUES('CSE', 'Computer Science'), ('ECE', 'Electronics')")
})

const dept = (code: string) => db.queryOne<any>("SELECT id FROM departments WHERE code = ?", [code])!.id
let n = 0
function addStudent(gender: "M" | "F", batch: string, code = "CSE") {
  n++
  const r = saveStudent(db, { roll_no: `R${n}`, register_no: `REG${n}`, name: `Student ${String.fromCharCode(65 + (n % 26))}`, gender, batch, department_id: dept(code) })
  if (!r.success) throw new Error(r.error)
  return r.student.id as number
}
function addHall(code: string, rows: number, cols: number, disabled: string[] = []) {
  const h = saveHall({ hall_code: code, bench_rows: rows, bench_cols: cols, disabled_benches: disabled, is_active: true })
  if (h?.success === false) throw new Error(h.error)
  return h.id as number
}
/** A session whose invigilator allocation uses `hallIds` (one invigilator each). */
async function sessionWithHalls(hallIds: number[]) {
  const cycle = db.run("INSERT INTO exam_cycles(name, academic_year) VALUES('Nov Series', '2026-27')").lastInsertRowid
  const session = db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, '2099-11-20', 'FN', 1)", [cycle]).lastInsertRowid
  const staff = hallIds.map((_, i) => db.run("INSERT INTO users(staff_id, name, role, is_active) VALUES(?, ?, 'staff', 1)", [`S${n}_${i}`, `Staff ${i}`]).lastInsertRowid)
  await getOrCreateAllocation(session, staff, hallIds)
  return { session, staff }
}

describe("Student master", () => {
  it("saves a student with roll number, register number, gender, department and batch", () => {
    const r = saveStudent(db, { roll_no: "23CS001", register_no: "961223104001", name: "Anu  S", gender: "Female", batch: "2023 - 2027", department_id: dept("CSE") })
    expect(r.success).toBe(true)
    const s = listStudents(db)[0]
    expect(s).toMatchObject({ roll_no: "23CS001", register_no: "961223104001", name: "Anu S", gender: "F", batch: "2023-2027", department_code: "CSE" })
  })

  it("roll and register numbers are unique ignoring case", () => {
    saveStudent(db, { roll_no: "23CS001", register_no: "REG1", name: "Anu", gender: "F", batch: "2023-2027", department_id: dept("CSE") })
    expect(saveStudent(db, { roll_no: "23cs001", register_no: "REG2", name: "Ben", gender: "M", batch: "2023-2027", department_id: dept("CSE") }))
      .toEqual({ success: false, error: "Roll Number 23CS001 is already used by Anu." })
    expect(saveStudent(db, { roll_no: "23CS002", register_no: "reg1", name: "Ben", gender: "M", batch: "2023-2027", department_id: dept("CSE") }))
      .toEqual({ success: false, error: "Register Number REG1 is already used by Anu." })
  })

  it("a department is required", () => {
    expect(saveStudent(db, { roll_no: "1", register_no: "1", name: "Anu", gender: "F", batch: "2023-2027" })).toEqual({ success: false, error: "Department is required." })
  })

  it("lists batches and filters by batch and gender", () => {
    addStudent("M", "2024-2028"); addStudent("F", "2023-2027"); addStudent("M", "2023-2027")
    expect(listStudentBatches(db)).toEqual(["2023-2027", "2024-2028"])
    expect(listStudents(db, { batch: "2023-2027", gender: "M" })).toHaveLength(1)
  })

  it("imports from a sheet, reporting every skipped row with its reason", () => {
    const r = importStudents(db, [
      ["Roll No", "Register No", "Name", "Gender", "Department", "Batch"],
      ["23CS001", "961223104001", "Anu S", "F", "CSE", "2023-2027"],
      ["23CS002", "961223104002", "Bala K", "Male", "Computer Science", "2023-2027"],
      ["23CS003", "961223104003", "Chitra", "X", "CSE", "2023-2027"],
      ["23CS004", "961223104004", "Devi", "F", "MECH", "2023-2027"],
      ["23CS001", "961223104005", "Esak", "M", "CSE", "2023-2027"],
      ["", "", "", "", "", ""]
    ])
    expect(r).toMatchObject({ success: true, inserted: 2, skipped: 3 })
    if (!r.success) return
    expect(r.issues.map(i => i.row)).toEqual([4, 5, 6])
    expect(r.issues[0].reason).toMatch(/Gender/)
    expect(r.issues[1].reason).toMatch(/MECH/)
    expect(r.issues[2].reason).toMatch(/already used/)
  })

  it("a sheet without the required columns is refused up front", () => {
    const r = importStudents(db, [["Roll No", "Name"], ["1", "Anu"]])
    expect(r.success).toBe(false)
    expect(!r.success && r.missingColumns).toEqual(["Register No", "Gender", "Department", "Batch"])
  })
})

describe("Hall bench layout", () => {
  it("saves rows, columns and switched-off benches; capacity becomes two seats per bench", () => {
    const id = addHall("A101", 6, 6, ["6-3", "6-3", "9-9"])
    const h = db.queryOne<any>("SELECT * FROM halls WHERE id = ?", [id])
    expect(h).toMatchObject({ bench_rows: 6, bench_cols: 6, disabled_benches: '["6-3"]', capacity: 70 })
  })

  it("rejects a layout with every bench switched off", () => {
    const r = saveHall({ hall_code: "X", bench_rows: 1, bench_cols: 1, disabled_benches: ["1-1"], is_active: true })
    expect(r.success).toBe(false)
  })

  it("a hall without a layout keeps its typed capacity", () => {
    const h = saveHall({ hall_code: "B1", capacity: 40, is_active: true })
    expect(h.capacity).toBe(40)
  })
})

describe("Session seating", () => {
  it("seats the selected students in the session's halls, boys and girls apart", async () => {
    const h1 = addHall("A1", 3, 4), h2 = addHall("A2", 3, 4)
    const ids = [
      ...Array.from({ length: 10 }, () => addStudent("M", "2023-2027")), ...Array.from({ length: 10 }, () => addStudent("M", "2024-2028")),
      ...Array.from({ length: 6 }, () => addStudent("F", "2023-2027")), ...Array.from({ length: 6 }, () => addStudent("F", "2024-2028"))
    ]
    const { session } = await sessionWithHalls([h1, h2])
    const r = await generateSeating(db, session, ids)
    expect(r.success).toBe(true)
    const rows = getSessionSeating(db, session)
    expect(rows).toHaveLength(32)
    for (const hallId of [h1, h2]) expect(new Set(rows.filter(x => x.hallId === hallId).map(x => x.gender)).size).toBe(1)
    // Bench mates are never of the same class (here: the same batch, all CSE).
    const benches = new Map<string, any[]>()
    for (const x of rows) benches.set(`${x.hallId}/${x.bench_no}`, [...(benches.get(`${x.hallId}/${x.bench_no}`) ?? []), x])
    for (const b of benches.values()) if (b.length === 2) expect(b[0].batch).not.toBe(b[1].batch)
    // Cycle 2026-27: 2023-2027 is Final Year, 2024-2028 Third Year.
    expect(new Set(rows.map(x => x.year))).toEqual(new Set(["Final Year", "Third Year"]))
    expect(rows.find(x => x.batch === "2023-2027")!.category).toBe("CSE – Final Year")
    expect(getSeatingSelections(db)).toMatchObject([{ id: session, studentCount: 32 }])
  })

  it("previews a configured plan without saving it; confirming saves the plan and its configuration", async () => {
    const h1 = addHall("A1", 2, 2), h2 = addHall("A2", 2, 2)
    const ids = [addStudent("M", "2023-2027"), addStudent("M", "2024-2028"), addStudent("F", "2023-2027"), addStudent("F", "2024-2028")]
    const { session } = await sessionWithHalls([h1, h2])
    const auto = autoConfigureSeating(db, session, ids)
    expect(auto.success).toBe(true)
    if (!auto.success) return
    expect(auto).toMatchObject({ boys: 2, girls: 2 })
    // The girls get the first hall.
    const config = { halls: [{ hallId: h1, pattern: ["FF" as const] }, { hallId: h2, pattern: ["MM" as const] }] }
    const preview = previewSeating(db, session, ids, config)
    expect(preview.success && preview.errors).toEqual([])
    expect(preview.success && preview.plan.hallGender).toEqual({ [h1]: "F", [h2]: "M" })
    expect(getSessionSeating(db, session)).toEqual([])

    const r = await confirmSeating(db, session, ids, config)
    expect(r).toMatchObject({ success: true, seated: 4, unallocated: [] })
    const rows = getSessionSeating(db, session)
    expect(new Set(rows.filter(x => x.hallId === h1).map(x => x.gender))).toEqual(new Set(["F"]))
    expect(getSeatingConfig(db, session)).toMatchObject({ studentIds: ids, unallocated: [], config: { halls: [{ hallId: h1, pattern: ["FF"] }, { hallId: h2, pattern: ["MM"] }] } })
  })

  it("students who cannot be seated: nothing is saved until the list is accepted, then the list is kept", async () => {
    const h1 = addHall("A1", 1, 2) // 2 benches
    const ids = Array.from({ length: 6 }, () => addStudent("M", "2023-2027"))
    const { session } = await sessionWithHalls([h1])
    const r = await generateSeating(db, session, ids)
    expect(r).toMatchObject({ success: false, needsConfirmation: true, error: "4 boys could not be seated: not enough seats for them in the halls." })
    expect(getSessionSeating(db, session)).toEqual([])

    const auto = autoConfigureSeating(db, session, ids)
    if (!auto.success) throw new Error(auto.error)
    const ok = await confirmSeating(db, session, ids, auto.config, { acceptUnallocated: true })
    expect(ok).toMatchObject({ success: true, seated: 2 })
    expect(getSessionSeating(db, session)).toHaveLength(2)
    const saved = getSeatingConfig(db, session)!
    expect(saved.unallocated).toHaveLength(4)
    expect(saved.unallocated[0].reason).toMatch(/two students of the same class never share a bench/)
    expect(getSeatingSelections(db)).toMatchObject([{ id: session, studentCount: 6 }]) // everyone selected, seated or not
    clearSeating(db, session)
    expect(getSeatingConfig(db, session)).toBeNull()
  })

  it("a configuration that breaks a rule is refused and nothing is saved", async () => {
    const h1 = addHall("A1", 1, 2), bare = addHall("A0", 0, 0)
    const ids = [addStudent("M", "2023-2027"), addStudent("M", "2024-2028")]
    const { session } = await sessionWithHalls([h1, bare])
    const noLayout = { halls: [{ hallId: h1, pattern: ["MM" as const] }, { hallId: bare, pattern: ["MM" as const] }] }
    const r = await confirmSeating(db, session, ids, noLayout)
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/A0 has no bench layout/) })
    expect(getSessionSeating(db, session)).toEqual([])
    expect(getSeatingConfig(db, session)).toBeNull()
  })

  it("saving the same plan again replaces it: no duplicate seats or configurations", async () => {
    const h1 = addHall("A1", 2, 2)
    const ids = [addStudent("M", "2023-2027"), addStudent("M", "2024-2028"), addStudent("M", "2024-2028")]
    const { session } = await sessionWithHalls([h1])
    expect((await generateSeating(db, session, ids)).success).toBe(true)
    const first = getSessionSeating(db, session)
    for (let i = 0; i < 3; i++) expect((await generateSeating(db, session, ids)).success).toBe(true)
    const again = getSessionSeating(db, session)
    expect(again).toEqual(first)
    expect(new Set(again.map(r => r.studentId)).size).toBe(3)
    expect(db.query("SELECT * FROM seat_allocations WHERE session_id = ?", [session])).toHaveLength(3)
    expect(db.query("SELECT * FROM seating_configs WHERE session_id = ?", [session])).toHaveLength(1)
  })

  it("a save that fails part-way changes nothing: the previous plan and settings stay", async () => {
    const h1 = addHall("A1", 2, 2), h2 = addHall("A2", 2, 2)
    const ids = [addStudent("M", "2023-2027"), addStudent("M", "2024-2028"), addStudent("F", "2023-2027"), addStudent("F", "2024-2028")]
    const { session } = await sessionWithHalls([h1, h2])
    expect((await generateSeating(db, session, ids)).success).toBe(true)
    const before = getSessionSeating(db, session), beforeConfig = getSeatingConfig(db, session)

    const auto = autoConfigureSeating(db, session, ids)
    if (!auto.success) throw new Error(auto.error)
    const swapped = { ...auto.config, halls: auto.config.halls.map(h => ({ ...h, pattern: [h.pattern[0] === "MM" ? "FF" as const : "MM" as const] })) }
    // The new seats are written, then saving the settings fails.
    const realRun = db.run
    const spy = vi.spyOn(db, "run").mockImplementation((sql: string, params?: any[]) => {
      if (sql.startsWith("INSERT INTO seating_configs")) throw new Error("disk full")
      return realRun(sql, params)
    })
    try {
      const r = await confirmSeating(db, session, ids, swapped)
      expect(r).toMatchObject({ success: false, error: expect.stringMatching(/could not be saved, so the previous plan was kept unchanged.*disk full/) })
    } finally { spy.mockRestore() }
    expect(getSessionSeating(db, session)).toEqual(before)
    expect(getSeatingConfig(db, session)).toEqual(beforeConfig)
  })

  it("needs the invigilator allocation first, and refuses inactive students", async () => {
    const id = addStudent("M", "2023-2027")
    const cycle = db.run("INSERT INTO exam_cycles(name, academic_year) VALUES('S', '2026-27')").lastInsertRowid
    const bare = db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step) VALUES(?, '2099-01-05', 'AN', 1)", [cycle]).lastInsertRowid
    expect(await generateSeating(db, bare, [id])).toMatchObject({ success: false, error: expect.stringMatching(/invigilator allocation first/) })
    const { session } = await sessionWithHalls([addHall("A1", 2, 2)])
    db.run("UPDATE students SET is_active = 0 WHERE id = ?", [id])
    expect(await generateSeating(db, session, [id])).toMatchObject({ success: false, error: expect.stringMatching(/Inactive/) })
  })

  it("regenerating the invigilators with other halls removes the old seating; same halls keep it", async () => {
    const h1 = addHall("A1", 2, 2), h2 = addHall("A2", 2, 2)
    const ids = [addStudent("M", "2023-2027"), addStudent("M", "2024-2028")]
    const { session, staff } = await sessionWithHalls([h1])
    await generateSeating(db, session, ids)
    await getOrCreateAllocation(session, staff, [h1])
    expect(getSessionSeating(db, session)).toHaveLength(2)
    await getOrCreateAllocation(session, staff, [h2])
    expect(getSessionSeating(db, session)).toEqual([])
  })

  it("a seated student cannot be deleted; deleting the session removes its seating", async () => {
    const id = addStudent("M", "2023-2027")
    const { session } = await sessionWithHalls([addHall("A1", 1, 1)])
    await generateSeating(db, session, [id])
    expect(deleteStudent(db, id).success).toBe(false)
    expect(deleteSession(session).success).toBe(true)
    expect(db.query("SELECT * FROM seat_allocations")).toEqual([])
    expect(db.query("SELECT * FROM seating_configs")).toEqual([])
    expect(deleteStudent(db, id).success).toBe(true)
  })
})
