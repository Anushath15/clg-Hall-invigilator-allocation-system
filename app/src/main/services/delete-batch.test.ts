/**
 * Deleting a whole batch (Settings → Delete Batch): the batch name must be typed, the person
 * deleting must give their name and Staff ID, and a record of the deletion is kept. The batch's
 * sessions and allocations go (confirmed ones included) and nothing of any other batch; the
 * rotation history stays, so the duties already done still count for later allocations.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getOrCreateAllocation, confirmAllocation, deleteCycle, getDeletedBatches } from "./allocation.service"
import { hallHistory, getStaffHallHistory } from "./rotation.engine"
import { validateAllocation } from "./validation.engine"

const STAFF = [101, 102, 103], HALLS = [1, 2, 3]
const count = (table: string, where = "1=1", params: any[] = []) => db.queryOne<any>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params)!.c
const ok = { typedBatchName: "Batch A", personName: "Staff 101", staffId: "S101" }

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'CSE')")
  db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(104, 'S104', 'Retired Person', 'staff', 1, 0)")
  for (const id of STAFF) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
  for (const h of HALLS) db.run("INSERT INTO halls(id, hall_code, name, sort_order, is_active) VALUES(?,?,?,?,1)", [h, `H${h}`, `H${h}`, h])
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch A', '2026-27'), (2, 'Batch B', '2026-27')")
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(1,1,'2099-11-02','FN',1,'pending'), (2,1,'2099-11-02','AN',2,'pending'), (3,2,'2099-12-01','FN',1,'pending')")
  for (const s of [1, 2]) { await getOrCreateAllocation(s, STAFF, HALLS); expect((await confirmAllocation(s)).success).toBe(true) }
  await getOrCreateAllocation(3, STAFF, HALLS); expect((await confirmAllocation(3)).success).toBe(true)
})

describe("Delete batch: what must be given", () => {
  const untouched = () => { expect(count("exam_cycles")).toBe(2); expect(count("allocations")).toBe(9); expect(count("deleted_batches")).toBe(0) }

  it("nothing is deleted without the confirmation details", async () => {
    expect(await deleteCycle(1)).toEqual({ success: false, error: "Type the batch name to confirm." })
    untouched()
  })
  it("the batch name must match what is shown (case and surrounding spaces do not matter)", async () => {
    const r: any = await deleteCycle(1, { ...ok, typedBatchName: "Batch B" })
    expect(r.success).toBe(false); expect(r.error).toMatch(/does not match/)
    untouched()
    // The other batch's name does not open this one either.
    expect((await deleteCycle(2, ok) as any).success).toBe(false); untouched()
  })
  it("only a registered person can delete: the Staff ID must exist and the name must be the one registered for it", async () => {
    // A made-up person, an unknown Staff ID, someone else's name with a real ID, and an inactive person are all refused.
    expect((await deleteCycle(1, { ...ok, personName: "Random Person", staffId: "ZZZ999" }) as any).error).toMatch(/No one with Staff ID "ZZZ999" is registered/)
    expect((await deleteCycle(1, { ...ok, personName: "Random Person" }) as any).error).toBe("The name does not match the registered name for Staff ID S101.")
    expect((await deleteCycle(1, { ...ok, personName: "Staff 102" }) as any).error).toMatch(/does not match/)
    expect((await deleteCycle(1, { ...ok, personName: "Retired Person", staffId: "S104" }) as any).error).toMatch(/no longer active/)
    untouched()
  })
  it("the person's name and Staff ID are required and checked", async () => {
    expect(await deleteCycle(1, { ...ok, personName: "" })).toEqual({ success: false, error: "Enter your name." })
    expect(await deleteCycle(1, { ...ok, staffId: "  " })).toEqual({ success: false, error: "Enter your Staff ID." })
    expect((await deleteCycle(1, { ...ok, personName: "1010" }) as any).error).toMatch(/Your name/)
    expect((await deleteCycle(1, { ...ok, staffId: "ST 1" }) as any).error).toMatch(/no spaces/)
    untouched()
  })
})

describe("Delete batch: the deletion and its record", () => {
  it("removes the batch with its sessions and allocations, and only those; the rotation history stays", async () => {
    expect(count("allocations")).toBe(9); expect(count("rotation_history")).toBe(9)
    const before = STAFF.map(id => hallHistory(id))
    const r = await deleteCycle(1, { typedBatchName: "  batch a ", personName: "  staff   101 ", staffId: " s101 " })
    expect(r).toEqual({ success: true })
    expect(count("exam_cycles", "id = 1")).toBe(0)
    expect(count("exam_sessions", "cycle_id = 1")).toBe(0)
    expect(count("allocations", "session_id IN (1,2)")).toBe(0)
    // Rotation records are kept; only their link to the deleted sessions is cleared.
    expect(count("rotation_history")).toBe(9)
    expect(count("rotation_history", "session_id IS NULL")).toBe(6)
    expect(STAFF.map(id => hallHistory(id))).toEqual(before)
    // Batch B is untouched, and so are staff and halls.
    expect(count("exam_cycles", "id = 2")).toBe(1)
    expect(count("exam_sessions", "cycle_id = 2 AND status = 'confirmed'")).toBe(1)
    expect(count("allocations", "session_id = 3")).toBe(3)
    expect(count("rotation_history", "session_id = 3")).toBe(3)
    expect(count("users", "role = 'staff'")).toBe(4); expect(count("halls")).toBe(3)
  })

  it("keeps a record: batch, year, size, when, and who deleted it (name and Staff ID)", () => {
    const rows = getDeletedBatches()
    expect(rows).toHaveLength(1)
    const d = rows[0]
    expect(d).toMatchObject({ batch_name: "Batch A", academic_year: "2026-27", session_count: 2, confirmed_session_count: 2, allocation_count: 6, deleted_by_name: "Staff 101", deleted_by_staff_id: "S101" })
    expect(Math.abs(Date.now() - new Date(d.deleted_at).getTime())).toBeLessThan(60_000)
    const log = db.queryOne<any>("SELECT description FROM audit_log WHERE action = 'CYCLE_DELETE'")!
    expect(log.description).toContain("Staff 101 (S101)") // as registered, not as typed
  })

  it("the record survives and the newest deletion is listed first", async () => {
    expect(await deleteCycle(2, { typedBatchName: "Batch B", personName: "Staff 102", staffId: "S102" })).toEqual({ success: true })
    expect(count("exam_cycles")).toBe(0)
    expect(getDeletedBatches().map((d: any) => `${d.batch_name} by ${d.deleted_by_name} (${d.deleted_by_staff_id})`)).toEqual(["Batch B by Staff 102 (S102)", "Batch A by Staff 101 (S101)"])
  })

  it("an unknown batch is refused with a message and nothing is recorded", async () => {
    expect(await deleteCycle(999, ok)).toEqual({ success: false, error: "Allocation batch not found." })
    expect(count("deleted_batches")).toBe(2)
  })
})

describe("Delete batch: the rotation memory outlives the batch", () => {
  it("a later allocation still avoids a hall the person had in a deleted batch, and says so", () => {
    db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(3, 'Batch C', '2026-27')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(4,3,'2099-12-09','FN',1,'pending')")
    // Two new staff; 201 last had hall 1 in a batch that has since been deleted (session link cleared).
    for (const id of [201, 202]) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
    // An older visit to the same hall in a batch that still exists must not be quoted instead of the newer, deleted one.
    db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order) VALUES(201, 4, 1, 1, (SELECT MAX(global_order) + 1 FROM rotation_history))")
    db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order) VALUES(201, NULL, 1, 2, (SELECT MAX(global_order) + 1 FROM rotation_history))")
    expect(hallHistory(201)).toEqual([1, 1])
    // Giving 201 hall 1 again, when hall 2 is free for them, is refused as a repeat, naming the deleted batch.
    const v = validateAllocation(4, [{ userId: 201, hallId: 1, sessionId: 4 }, { userId: 202, hallId: 2, sessionId: 4 }] as any, [1, 2], [201, 202])
    const r1 = v.blockingErrors.find((e: any) => e.rule === "R1")
    expect(r1?.message).toContain("Staff 201 was already assigned Hall H1 earlier (in a deleted batch)")
    // The other way round passes.
    expect(validateAllocation(4, [{ userId: 201, hallId: 2, sessionId: 4 }, { userId: 202, hallId: 1, sessionId: 4 }] as any, [1, 2], [201, 202]).blockingErrors.filter((e: any) => e.rule === "R1")).toEqual([])
    expect(getStaffHallHistory(201).some((h: any) => h.sessionId == null && h.hallId === 1)).toBe(true) // still listed, without a date
  })
})
