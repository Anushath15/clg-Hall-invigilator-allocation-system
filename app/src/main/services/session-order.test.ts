/**
 * ROTATION ORDER OF SESSIONS (QA-6). Pending and draft sessions are kept in date order
 * (Forenoon before Afternoon) after the confirmed ones, however they are added, rescheduled or
 * deleted. Confirmed sessions are never renumbered, and their rotation history (global_order,
 * rotation_step) is never touched.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { createSessions, addSession, updateSession, deleteSession, getOrCreateAllocation, confirmAllocation } from "./allocation.service"
import { unconfirmedStepChanges } from "../../shared/session-order"

const CYCLE = 1
const staff = [101, 102], halls = [1, 2]
const t = { reporting_time: "09:15", exam_start: "09:30", exam_end: "12:30" }

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'CSE')")
  for (const id of staff) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
  for (const h of halls) db.run("INSERT INTO halls(id, hall_code, name, sort_order, is_active) VALUES(?,?,?,?,1)", [h, `H${h}`, `H${h}`, h])
  db.run(`INSERT INTO exam_cycles(id, name, academic_year) VALUES(${CYCLE}, 'Batch', '2026-27')`)
})

/** "date slot:step:status" for every session, in step order. */
const order = () => db.query<any>("SELECT exam_date, session_type, rotation_step, status FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [CYCLE])
  .map(s => `${s.exam_date.slice(5)} ${s.session_type}:${s.rotation_step}:${s.status}`)
const idOf = (date: string, type: string) => db.queryOne<any>("SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=?", [CYCLE, date, type])!.id
const history = () => db.query<any>("SELECT user_id, session_id, hall_id, rotation_step, global_order, recorded_at FROM rotation_history ORDER BY id")

describe("Unconfirmed sessions are renumbered into date order; confirmed ones never", () => {
  let confirmedHistory: any[] = []

  it("the batch wizard's sessions are numbered in date order, Forenoon before Afternoon", async () => {
    await createSessions(CYCLE, [
      { exam_date: "2099-11-05", session_type: "FN", ...t }, { exam_date: "2099-11-03", session_type: "AN", ...t },
      { exam_date: "2099-11-03", session_type: "FN", ...t }, { exam_date: "2099-11-06", session_type: "FN", ...t },
    ])
    expect(order()).toEqual(["11-03 FN:1:pending", "11-03 AN:2:pending", "11-05 FN:3:pending", "11-06 FN:4:pending"])
  })

  it("confirming the first two sessions records their rotation history", async () => {
    for (const s of [idOf("2099-11-03", "FN"), idOf("2099-11-03", "AN")]) {
      await getOrCreateAllocation(s, staff, halls)
      expect((await confirmAllocation(s)).success).toBe(true)
    }
    confirmedHistory = history()
    expect(confirmedHistory.map(h => [h.rotation_step, h.global_order])).toEqual([[1, 1], [1, 2], [2, 3], [2, 4]])
  })

  it("a session added later takes its date-order place among the unconfirmed ones", () => {
    addSession(CYCLE, { exam_date: "2099-11-04", session_type: "FN", ...t })
    expect(order()).toEqual(["11-03 FN:1:confirmed", "11-03 AN:2:confirmed", "11-04 FN:3:pending", "11-05 FN:4:pending", "11-06 FN:5:pending"])
  })

  it("a session dated before the confirmed ones still follows them: confirmed steps never move", () => {
    addSession(CYCLE, { exam_date: "2099-11-01", session_type: "FN", ...t })
    expect(order()).toEqual(["11-03 FN:1:confirmed", "11-03 AN:2:confirmed", "11-01 FN:3:pending", "11-04 FN:4:pending", "11-05 FN:5:pending", "11-06 FN:6:pending"])
    expect(history()).toEqual(confirmedHistory)
  })

  it("draft sessions are renumbered too, keeping their allocation", async () => {
    const draft = idOf("2099-11-05", "FN")
    await getOrCreateAllocation(draft, staff, halls)
    const draftRows = db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id=? ORDER BY user_id", [draft])
    updateSession(idOf("2099-11-06", "FN"), { exam_date: "2099-11-02" }) // reschedule a pending session earlier
    expect(order()).toEqual(["11-03 FN:1:confirmed", "11-03 AN:2:confirmed", "11-01 FN:3:pending", "11-02 FN:4:pending", "11-04 FN:5:pending", "11-05 FN:6:draft"])
    expect(db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id=? ORDER BY user_id", [draft])).toEqual(draftRows)
  })

  it("rescheduling a confirmed session changes its date and times only, never its step or status", () => {
    const s = idOf("2099-11-03", "AN")
    updateSession(s, { exam_date: "2099-12-01", exam_start: "14:05", rotation_step: 99, status: "pending" })
    const row = db.queryOne<any>("SELECT exam_date, exam_start, rotation_step, status FROM exam_sessions WHERE id=?", [s])
    expect(row).toEqual({ exam_date: "2099-12-01", exam_start: "14:05", rotation_step: 2, status: "confirmed" })
    expect(order().slice(2)).toEqual(["11-01 FN:3:pending", "11-02 FN:4:pending", "11-04 FN:5:pending", "11-05 FN:6:draft"])
    expect(history()).toEqual(confirmedHistory)
  })

  it("deleting an unconfirmed session closes the gap without touching confirmed sessions", () => {
    expect(deleteSession(idOf("2099-11-01", "FN")).success).toBe(true)
    expect(order()).toEqual(["11-03 FN:1:confirmed", "12-01 AN:2:confirmed", "11-02 FN:3:pending", "11-04 FN:4:pending", "11-05 FN:5:draft"])
    expect(history()).toEqual(confirmedHistory)
  })

  it("the rule itself: only unconfirmed sessions change, placed after the highest confirmed step", () => {
    const s = (id: number, exam_date: string, session_type: string, rotation_step: number, status: string) => ({ id, exam_date, session_type, rotation_step, status })
    // Already in order: nothing to change.
    expect(unconfirmedStepChanges([s(1, "2099-01-01", "FN", 1, "confirmed"), s(2, "2099-01-01", "AN", 2, "pending")])).toEqual([])
    // Robustness, not normal operation: R4 requires every earlier session to be confirmed first
    // (QA-16), so confirmed steps run 1, 2, 3, ... without gaps. A database from before that fix
    // could still hold confirmed steps 1 and 3 with a pending session between them; the rule
    // copes: that pending session moves after them, and the earlier-dated draft comes first
    // among the unconfirmed (it is already at step 4).
    const rows = [
      s(1, "2099-01-01", "FN", 1, "confirmed"), s(2, "2099-01-02", "FN", 2, "pending"),
      s(3, "2099-01-03", "FN", 3, "published"), s(4, "2099-01-01", "AN", 4, "draft"),
    ]
    const changes = unconfirmedStepChanges(rows)
    expect(changes).toEqual([{ id: 2, rotation_step: 5 }])
    const after = rows.map(r => ({ ...r, rotation_step: changes.find(c => c.id === r.id)?.rotation_step ?? r.rotation_step }))
    expect(after.sort((a, b) => a.rotation_step - b.rotation_step).map(r => `${r.id}:${r.rotation_step}`)).toEqual(["1:1", "3:3", "4:4", "2:5"])
  })
})
