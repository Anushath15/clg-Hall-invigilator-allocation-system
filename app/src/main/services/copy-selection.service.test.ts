/**
 * Copying a session's selection never carries over its hall ASSIGNMENT. After a copy, Generate
 * runs the rotation engine afresh, exactly as for staff and halls ticked by hand, and the
 * rotation cycle is computed over the global history, also when the copy comes from another batch.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getOrCreateAllocation, confirmAllocation, getSessionAllocationFull, getSessionSelections } from "./allocation.service"
import { generateAllocation, hallsVisitedThisCycle } from "./rotation.engine"
import { previousSelectionSource, selectionSourceGroups, selectionFromAllocation, type SelectionSource } from "../../shared/copy-selection"

const STAFF = [101, 102, 103, 104], HALLS = [1, 2, 3, 4]
const S1 = 1, S2 = 2, S3 = 3, S4 = 4, S5 = 5 // S1, S2 in batch 1; S3, S4, S5 in batch 2

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'CSE')")
  for (const id of [...STAFF, 105]) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
  for (const h of [...HALLS, 5]) db.run("INSERT INTO halls(id, hall_code, name, sort_order, is_active) VALUES(?,?,?,?,1)", [h, `H${h}`, `H${h}`, h])
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch 1', '2026-27'), (2, 'Batch 2', '2026-27')")
  const sessions = [[S1, 1, "2099-11-02", "FN", 1], [S2, 1, "2099-11-02", "AN", 2], [S3, 2, "2099-12-01", "FN", 1], [S4, 2, "2099-12-01", "AN", 2], [S5, 2, "2099-12-02", "FN", 3]]
  for (const [id, cycle, date, type, step] of sessions) {
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status, created_at) VALUES(?,?,?,?,?,'pending','2026-01-01 00:00:00')", [id, cycle, date, type, step])
  }
})

const sessionRef = (id: number) => db.queryOne<any>("SELECT id, cycle_id, exam_date, session_type, status FROM exam_sessions WHERE id=?", [id])
const mapping = (sid: number) => Object.fromEntries((getSessionAllocationFull(sid) as any[]).map(r => [r.userId, r.hallId]))
const active = () => [db.query<any>("SELECT id FROM users WHERE role='staff' AND is_active=1").map(r => r.id), db.query<any>("SELECT id FROM halls WHERE is_active=1").map(r => r.id)] as const
/** What the dialog does: find the source, then tick its staff and halls. */
function copyInto(target: number, source?: SelectionSource) {
  const from = source ?? previousSelectionSource(getSessionSelections() as SelectionSource[], sessionRef(target))!
  const [users, halls] = active()
  return { from, ...selectionFromAllocation(getSessionAllocationFull(from.id) as any[], users, halls) }
}
/** Generate from a copied selection, and check it equals a fresh engine run on the same staff and halls ticked by hand. */
async function generateFromCopy(target: number, sel: { userIds: number[]; hallIds: number[] }) {
  const byHand = await generateAllocation(target, [...sel.userIds].reverse(), [...sel.hallIds].reverse()) // other tick order
  const gen = await getOrCreateAllocation(target, sel.userIds, sel.hallIds)
  expect(gen.validation.isValid).toBe(true)
  expect(mapping(target)).toEqual(Object.fromEntries(byHand.map(e => [e.userId, e.hallId])))
  return mapping(target)
}

describe("Copying a selection never replays the source session's assignment", () => {
  let first: Record<number, number>, second: Record<number, number>

  it("same batch: S2 copied from S1 is a fresh draw, and nobody keeps their S1 hall", async () => {
    await getOrCreateAllocation(S1, STAFF, HALLS)
    expect((await confirmAllocation(S1)).success).toBe(true)
    first = mapping(S1)
    const sel = copyInto(S2)
    expect(sel.from.id).toBe(S1)
    expect([sel.userIds, sel.hallIds]).toEqual([STAFF, HALLS])
    second = await generateFromCopy(S2, sel)
    for (const u of STAFF) expect(second[u], `staff ${u} kept their S1 hall`).not.toBe(first[u]) // a replay would keep all four
    expect((await confirmAllocation(S2)).success).toBe(true)
  })

  it("cross batch: S3 (batch 2) copied from S2 (batch 1) continues each person's cycle over the global history", async () => {
    // Before generating, each person's current cycle already holds their batch-1 halls.
    for (const u of STAFF) expect([...hallsVisitedThisCycle(u, HALLS)].sort()).toEqual([first[u], second[u]].sort())
    const sel = copyInto(S3) // first session of batch 2: falls back to the latest earlier session, in batch 1
    expect(sel.from.id).toBe(S2)
    expect(sel.from.cycleId).not.toBe(sessionRef(S3).cycle_id)
    const third = await generateFromCopy(S3, sel)
    for (const u of STAFF) expect([first[u], second[u]], `staff ${u} repeated a hall across batches`).not.toContain(third[u])
    expect((await confirmAllocation(S3)).success).toBe(true)
    // S4 (same batch again) gets everyone their one remaining hall: each has had all four halls exactly once.
    const s4 = copyInto(S4)
    expect(s4.from.id).toBe(S3)
    const fourth = await generateFromCopy(S4, s4)
    expect((await confirmAllocation(S4)).success).toBe(true)
    for (const u of STAFF) expect([first[u], second[u], third[u], fourth[u]].sort()).toEqual(HALLS)
  })

  it("this session's current draft as the source: the same ticks, and regenerating gives the same draft", async () => {
    await getOrCreateAllocation(S5, STAFF, HALLS)
    const draft = mapping(S5)
    const sources = getSessionSelections() as SelectionSource[]
    const own = selectionSourceGroups(sources, sessionRef(S5)).draft
    expect(own?.id).toBe(S5)
    const sel = copyInto(S5, own!)
    expect([sel.userIds, sel.hallIds]).toEqual([STAFF, HALLS])
    expect(await generateFromCopy(S5, sel)).toEqual(draft)
  })

  it("staff and halls deactivated since the source session are not copied", () => {
    db.run("UPDATE users SET is_active=0 WHERE id=104"); db.run("UPDATE halls SET is_active=0 WHERE id=4")
    const sel = copyInto(S2, (getSessionSelections() as SelectionSource[]).find(s => s.id === S1)!)
    expect(sel).toMatchObject({ userIds: [101, 102, 103], hallIds: [1, 2, 3], inactiveStaff: 1, inactiveHalls: 1 })
    db.run("UPDATE users SET is_active=1 WHERE id=104"); db.run("UPDATE halls SET is_active=1 WHERE id=4")
  })

  it("lists only sessions that have a selection, with their staff counts", () => {
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(6, 2, '2099-12-02', 'AN', 4, 'pending')")
    const listed = getSessionSelections() as SelectionSource[]
    expect(listed.map(s => s.id)).toEqual([S5, S4, S3, S2, S1]) // newest first; pending session 6 has nothing to copy
    expect(listed.every(s => s.staffCount === 4)).toBe(true)
  })
})
