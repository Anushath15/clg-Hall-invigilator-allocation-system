/**
 * Deleting a whole batch (Settings → Delete Batch) removes that batch's sessions, allocations and
 * rotation records, confirmed ones included, and nothing of any other batch.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getOrCreateAllocation, confirmAllocation, deleteCycle } from "./allocation.service"

const STAFF = [101, 102, 103], HALLS = [1, 2, 3]
const count = (table: string, where = "1=1", params: any[] = []) => db.queryOne<any>(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`, params)!.c

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'CSE')")
  for (const id of STAFF) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
  for (const h of HALLS) db.run("INSERT INTO halls(id, hall_code, name, sort_order, is_active) VALUES(?,?,?,?,1)", [h, `H${h}`, `H${h}`, h])
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch A', '2026-27'), (2, 'Batch B', '2026-27')")
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(1,1,'2099-11-02','FN',1,'pending'), (2,1,'2099-11-02','AN',2,'pending'), (3,2,'2099-12-01','FN',1,'pending')")
  for (const s of [1, 2, 3]) { await getOrCreateAllocation(s, STAFF, HALLS); expect((await confirmAllocation(s)).success).toBe(true) }
})

describe("Delete batch", () => {
  it("removes the confirmed batch with its sessions, allocations and rotation history, and only those", async () => {
    expect(count("allocations")).toBe(9); expect(count("rotation_history")).toBe(9)
    const r = await deleteCycle(1)
    expect(r).toEqual({ success: true })
    expect(count("exam_cycles", "id = 1")).toBe(0)
    expect(count("exam_sessions", "cycle_id = 1")).toBe(0)
    expect(count("allocations", "session_id IN (1,2)")).toBe(0)
    expect(count("rotation_history", "session_id IN (1,2)")).toBe(0)
    // Batch B is untouched, and so are staff and halls.
    expect(count("exam_cycles", "id = 2")).toBe(1)
    expect(count("exam_sessions", "cycle_id = 2 AND status = 'confirmed'")).toBe(1)
    expect(count("allocations", "session_id = 3")).toBe(3)
    expect(count("rotation_history", "session_id = 3")).toBe(3)
    expect(count("users", "role = 'staff'")).toBe(3); expect(count("halls")).toBe(3)
    expect(count("audit_log", "action = 'CYCLE_DELETE'")).toBe(1)
  })

  it("an unknown batch is refused with a message and nothing changes", async () => {
    expect(await deleteCycle(999)).toEqual({ success: false, error: "Allocation batch not found." })
    expect(count("exam_cycles")).toBe(1)
  })

  it("after the delete a later session in the other batch can still be generated from a fresh history", async () => {
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(4,2,'2099-12-01','AN',2,'pending')")
    const gen = await getOrCreateAllocation(4, STAFF, HALLS)
    expect(gen.validation.isValid).toBe(true)
  })
})
