/**
 * MANUAL EDIT = SWAP (QA-5). Every hall of a session is taken, so an edit exchanges two
 * people's halls, and R1 must hold for BOTH of them: a swap that is legal for the person being
 * edited can hand the other person a hall they already had in their current cycle.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { initDatabase, db } from "../db/database"
import { editAllocationEntry, getValidHallsFor, confirmAllocation } from "./allocation.service"

const A = 101, B = 102, C = 103, D = 104
const SESSION = 2

beforeAll(async () => { await initDatabase({ inMemory: true }) })

// Halls 1-4 form the session's pool. In confirmed session 1, A had hall 3, B hall 1 and C
// hall 2 (D is new). Draft session 2 has A=1, B=2, C=3, D=4, which R1 allows for everyone.
beforeEach(() => {
  for (const t of ["rotation_history", "allocations", "exam_sessions", "exam_cycles", "halls", "audit_log"]) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM users WHERE role='staff'")
  db.run("DELETE FROM departments")
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'CSE')")
  for (const [id, name] of [[A, "Staff A"], [B, "Staff B"], [C, "Staff C"], [D, "Staff D"]] as const) {
    db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, name])
  }
  for (let h = 1; h <= 4; h++) db.run("INSERT INTO halls(id, hall_code, name, sort_order, is_active) VALUES(?,?,?,?,1)", [h, `H${h}`, `H${h}`, h])
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch', '2026-27')")
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(1, 1, '2099-11-02', 'FN', 1, 'confirmed')")
  db.run(`INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(${SESSION}, 1, '2099-11-02', 'AN', 2, 'draft')`)
  let order = 1
  for (const [user, hall] of [[A, 3], [B, 1], [C, 2]]) {
    db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order) VALUES(?,1,?,1,?)", [user, hall, order++])
  }
  for (const [user, hall] of [[A, 1], [B, 2], [C, 3], [D, 4]]) {
    db.run("INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, generated_hall_id) VALUES(?,?,?,0,?)", [SESSION, user, hall, hall])
  }
})

const rows = () => new Map(db.query<any>("SELECT user_id, hall_id, is_manually_edited, generated_hall_id, edit_reason FROM allocations WHERE session_id=?", [SESSION])
  .map(r => [r.user_id, { hall: r.hall_id, edited: r.is_manually_edited, generated: r.generated_hall_id, reason: r.edit_reason }]))
const halls = () => Object.fromEntries([...rows()].map(([u, r]) => [u, r.hall]))
const GENERATED: Record<number, number> = { [A]: 1, [B]: 2, [C]: 3, [D]: 4 }

describe("Manual edit is a swap, with R1 checked for both people", () => {
  it("refuses a swap that is legal for the person edited but not for the other person", async () => {
    // A taking hall 2 is fine for A (A only had hall 3), but B would get hall 1, which B already had.
    const r = await editAllocationEntry(SESSION, A, 2)
    expect(r.success).toBe(false)
    expect(r.error).toMatchObject({ rule: "R1", userId: B, hallId: 1 })
    expect(r.error?.message).toMatch(/^Swap refused: Staff B would get Hall H1, which Staff B already had/)
    expect(halls()).toEqual(GENERATED)
  })

  it("refuses a swap that is legal for the other person but not for the person edited", async () => {
    // C would be fine with A's hall 1, but A already had hall 3.
    const r = await editAllocationEntry(SESSION, A, 3)
    expect(r.error).toMatchObject({ rule: "R1", userId: A, hallId: 3 })
    // And the same in the other direction for another pair: B -> hall 3 is fine for B, C would repeat hall 2.
    expect((await editAllocationEntry(SESSION, B, 3)).error).toMatchObject({ rule: "R1", userId: C, hallId: 2 })
    expect(halls()).toEqual(GENERATED)
  })

  it("a swap legal for both exchanges both halls together and marks both rows", async () => {
    const r = await editAllocationEntry(SESSION, A, 4, "A asked to swap")
    expect(r).toEqual({ success: true, swappedWithUserId: D })
    const after = rows()
    expect(after.get(A)).toEqual({ hall: 4, edited: 1, generated: 1, reason: "A asked to swap" })
    expect(after.get(D)).toEqual({ hall: 1, edited: 1, generated: 4, reason: "A asked to swap" })
    expect(after.get(B)).toEqual({ hall: 2, edited: 0, generated: 2, reason: null })
    expect(after.get(C)).toEqual({ hall: 3, edited: 0, generated: 3, reason: null })
    expect(db.queryOne<any>("SELECT payload FROM audit_log WHERE action='SWAP_ALLOCATION'")?.payload).toContain(`"partnerUserId":${D}`)
    // The swapped allocation passes every rule and is what the rotation history records.
    expect((await confirmAllocation(SESSION)).success).toBe(true)
    expect(db.query<any>("SELECT user_id, hall_id FROM rotation_history WHERE session_id=? ORDER BY user_id", [SESSION]).map(r => [r.user_id, r.hall_id]))
      .toEqual([[A, 4], [B, 2], [C, 3], [D, 1]])
  })

  it("swapping back restores the generated halls and clears the Admin Edited mark", async () => {
    expect((await editAllocationEntry(SESSION, A, 4)).success).toBe(true)
    expect(await editAllocationEntry(SESSION, D, 4)).toEqual({ success: true, swappedWithUserId: A })
    expect(halls()).toEqual(GENERATED)
    expect([...rows().values()].every(r => r.edited === 0 && r.reason === null)).toBe(true)
  })

  it("the edit dialog offers exactly the swaps that are legal for both people", async () => {
    const offer = (u: number) => Object.fromEntries(getValidHallsFor(u, SESSION).map(v => [v.hallId, v.isValid ? `swap:${v.swapWithUserId}` : v.reason]))
    expect(offer(A)).toEqual({
      1: "Current hall",
      2: "Swap blocked: Staff B already had Hall H1 in this rotation cycle",
      3: "Already visited in cycle",
      4: `swap:${D}`,
    })
    // For every person and hall, the dialog and the actual edit agree.
    for (const u of [A, B, C, D]) {
      for (const v of getValidHallsFor(u, SESSION).filter(v => v.reason !== "Current hall")) {
        const r = await editAllocationEntry(SESSION, u, v.hallId)
        expect(r.success, `user ${u} -> hall ${v.hallId}: dialog says ${v.isValid ? "valid" : v.reason}`).toBe(v.isValid)
        if (r.success) await editAllocationEntry(SESSION, u, GENERATED[u]) // swap back
        expect(halls()).toEqual(GENERATED)
      }
    }
  })

  it("an inactive holder cannot be swapped", async () => {
    db.run("UPDATE users SET is_active=0 WHERE id=?", [D])
    expect((await editAllocationEntry(SESSION, A, 4)).error).toMatchObject({ rule: "R5", userId: D })
    expect(halls()).toEqual(GENERATED)
  })
})
