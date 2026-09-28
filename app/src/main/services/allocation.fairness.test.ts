/**
 * FAIRNESS SUITE
 * Drives the real engine, validator and database through realistic multi-session
 * scenarios (fixed teams, staff taking turns, random duty lists, people joining and
 * leaving, halls closing, manual edits, several batches, rotation restart, a large
 * college) and checks that every session can be confirmed and that halls are shared
 * fairly. Prints a metrics table at the end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getOrCreateAllocation, confirmAllocation, restartRotation } from "./allocation.service"

// ─── Harness ──────────────────────────────────────────────────────────────────

const staffIds = (n: number, from = 1) => Array.from({ length: n }, (_, i) => 100 + from + i)
const hallIdList = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

function reset(staff: number, halls: number) {
  for (const t of ["rotation_history", "allocations", "exam_sessions", "exam_cycles", "halls", "notifications"]) db.run(`DELETE FROM ${t}`)
  db.run("DELETE FROM users WHERE role='staff'")
  db.run("DELETE FROM departments")
  db.run("INSERT INTO departments(id, code, name) VALUES(1,'CSE','CSE')")
  for (let i = 1; i <= halls; i++) db.run("INSERT INTO halls(id, hall_code, name, capacity, sort_order, is_active) VALUES(?,?,?,30,?,1)", [i, `H${i}`, `Hall ${i}`, i])
  addStaff(staffIds(staff))
  db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(1,'Batch 1','2026-27','draft')")
  step = 0; sessionId = 0; stats = { sessions: 0, confirmed: 0, repeats: 0, backToBack: 0 }
}
function addStaff(ids: number[]) {
  for (const id of ids) db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, `S${id}`, `Staff ${id}`])
}

let step = 0, sessionId = 0
let stats = { sessions: 0, confirmed: 0, repeats: 0, backToBack: 0 }

function lastHall(userId: number): number | undefined {
  return db.queryOne<any>("SELECT hall_id FROM rotation_history WHERE user_id=? ORDER BY global_order DESC LIMIT 1", [userId])?.hall_id
}

/** Create a session, generate its allocation and confirm it, recording metrics. */
async function session(userIds: number[], hallIds: number[], cycleId = 1, edit?: (sid: number) => void) {
  step++; sessionId++
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(?,?,?,?,?,'pending')",
    [sessionId, cycleId, `2026-${String(11 + Math.floor(sessionId / 60)).padStart(2, "0")}-01`, sessionId % 2 ? "FN" : "AN", step])
  const before = new Map(userIds.map(u => [u, lastHall(u)]))
  const gen = await getOrCreateAllocation(sessionId, userIds, hallIds)
  edit?.(sessionId)
  const conf = await confirmAllocation(sessionId)
  stats.sessions++
  if (conf.success) stats.confirmed++
  stats.repeats += conf.validation?.warnings?.length ?? 0
  const rows = db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id=?", [sessionId])
  for (const r of rows) if (before.get(r.user_id) === r.hall_id) stats.backToBack++
  // Invariants that must hold for every generated allocation.
  expect(new Set(rows.map(r => r.hall_id)).size, "one invigilator per hall").toBe(rows.length)
  expect(new Set(rows.map(r => r.user_id)).size, "one hall per invigilator").toBe(rows.length)
  expect(rows.length).toBe(userIds.length)
  expect(conf.success, `session ${sessionId} confirm: ${JSON.stringify(conf.validation?.blockingErrors ?? conf.error)}`).toBe(true)
  return { gen, conf }
}

/** visits[user][hall] over the whole rotation history. */
function visitMatrix(userIds: number[], hallIds: number[]) {
  return userIds.map(u => hallIds.map(h =>
    db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history WHERE user_id=? AND hall_id=?", [u, h])?.c ?? 0))
}
/** Largest (most visits - fewest visits) of any hall, over staff with at least `minDuties` duties. */
function worstSpread(userIds: number[], hallIds: number[], minDuties = 0) {
  return Math.max(0, ...visitMatrix(userIds, hallIds)
    .filter(row => row.reduce((a, b) => a + b, 0) >= minDuties)
    .map(row => Math.max(...row) - Math.min(...row)))
}
/** Duties per person differ only by the caller's choice of who is on duty; returned for the report. */
function dutyRange(userIds: number[]) {
  const d = userIds.map(u => db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history WHERE user_id=?", [u])?.c ?? 0)
  return `${Math.min(...d)}-${Math.max(...d)}`
}

function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 } }
function pick<T>(arr: T[], k: number, r: () => number) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, k)
}

const report: Record<string, any>[] = []
function record(name: string, spread: number, extra: Record<string, any> = {}) {
  report.push({ scenario: name, sessions: stats.sessions, confirmed: stats.confirmed, unavoidableRepeats: stats.repeats,
    sameHallTwiceInARow: stats.backToBack, worstHallSpread: spread, ...extra })
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

describe("Allocation fairness across many sessions", () => {
  beforeAll(async () => { await initDatabase({ inMemory: true }) })
  afterAll(() => { console.log("\nFAIRNESS REPORT"); console.table(report) })

  it("F1 fixed team (6 staff, 6 halls, 36 sessions): perfect rotation, every hall exactly 6 times", async () => {
    reset(6, 6)
    const u = staffIds(6), h = hallIdList(6)
    for (let i = 0; i < 36; i++) await session(u, h)
    const m = visitMatrix(u, h)
    expect(m.every(row => row.every(c => c === 6))).toBe(true)
    // Within each block of 6 sessions nobody repeats a hall (a Latin square).
    expect(stats.repeats).toBe(0)
    expect(stats.backToBack).toBe(0)
    record("F1 fixed team 6x6", worstSpread(u, h))
  })

  it("F2 fixed teams of other sizes (2, 3, 5 and 9 halls)", async () => {
    for (const n of [2, 3, 5, 9]) {
      reset(n, n)
      const u = staffIds(n), h = hallIdList(n)
      for (let i = 0; i < n * 3; i++) await session(u, h)
      expect(visitMatrix(u, h).every(row => row.every(c => c === 3))).toBe(true)
      expect(stats.repeats + stats.backToBack).toBe(0)
      record(`F2 fixed team ${n}x${n}`, worstSpread(u, h))
    }
  })

  it("F3 staff take turns (10 staff, 6 halls, round-robin duty list, 60 sessions)", async () => {
    reset(10, 6)
    const all = staffIds(10), h = hallIdList(6)
    for (let i = 0; i < 60; i++) await session(Array.from({ length: 6 }, (_, k) => all[(i * 6 + k) % 10]), h)
    expect(stats.repeats).toBe(0)
    expect(stats.backToBack).toBe(0)
    const spread = worstSpread(all, h)
    expect(spread).toBeLessThanOrEqual(1)
    record("F3 turns 10 staff/6 halls", spread, { dutiesPerPerson: dutyRange(all) })
  })

  it("F4 random duty lists (12 staff, 6 halls, random 6 each session, 120 sessions)", async () => {
    reset(12, 6)
    const all = staffIds(12), h = hallIdList(6), r = rng(7)
    for (let i = 0; i < 120; i++) await session(pick(all, 6, r), h)
    const spread = worstSpread(all, h)
    // Repeats (and, rarely, the same hall twice in a row) only happen when no valid
    // assignment exists for that duty list; the validator enforces that. Keep them rare.
    expect(stats.backToBack / (stats.sessions * 6)).toBeLessThan(0.01)
    expect(spread).toBeLessThanOrEqual(3)
    record("F4 random 12 staff/6 halls", spread, { dutiesPerPerson: dutyRange(all) })
  })

  it("F5 random duty lists, several seeds (15 staff, 8 halls, 80 sessions each)", async () => {
    for (const seed of [1, 42, 2026]) {
      reset(15, 8)
      const all = staffIds(15), h = hallIdList(8), r = rng(seed)
      for (let i = 0; i < 80; i++) await session(pick(all, 8, r), h)
      const spread = worstSpread(all, h)
      expect(stats.backToBack / (stats.sessions * 8)).toBeLessThan(0.01)
      expect(spread).toBeLessThanOrEqual(3)
      record(`F5 random 15/8 seed ${seed}`, spread, { dutiesPerPerson: dutyRange(all) })
    }
  })

  it("F6 new staff join half-way and are slotted in fairly", async () => {
    reset(6, 6)
    const h = hallIdList(6)
    let team = staffIds(6)
    for (let i = 0; i < 12; i++) await session(team, h)
    addStaff([201, 202])
    team = [...team.slice(0, 4), 201, 202] // two people replaced by newcomers
    for (let i = 0; i < 12; i++) await session(team, h)
    expect(stats.backToBack).toBe(0)
    // Newcomers have been through every hall exactly twice after 12 sessions.
    for (const row of visitMatrix([201, 202], h)) expect(row.every(c => c === 2)).toBe(true)
    record("F6 newcomers join", worstSpread(team, h))
  })

  it("F7 a hall closes for a while and reopens", async () => {
    reset(6, 6)
    const u = staffIds(6)
    for (let i = 0; i < 6; i++) await session(u, hallIdList(6))
    db.run("UPDATE halls SET is_active=0 WHERE id=6")
    for (let i = 0; i < 10; i++) await session(u.slice(0, 5), hallIdList(5)) // 5 halls, 5 staff on duty
    db.run("UPDATE halls SET is_active=1 WHERE id=6")
    for (let i = 0; i < 12; i++) await session(u, hallIdList(6))
    expect(stats.backToBack).toBe(0)
    record("F7 hall closed then reopened", worstSpread(u, hallIdList(6)))
  })

  it("F8 admin swaps two people by hand in the first session; the rotation continues from the edited halls", async () => {
    reset(6, 6)
    const u = staffIds(6), h = hallIdList(6)
    await session(u, h, 1, sid => {
      // Swap the halls of the first two people, as an admin edit would.
      const [a, b] = db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id=? ORDER BY user_id", [sid])
      db.run("DELETE FROM allocations WHERE session_id=? AND user_id IN (?,?)", [sid, a.user_id, b.user_id])
      for (const [user, hall] of [[a.user_id, b.hall_id], [b.user_id, a.hall_id]]) {
        db.run("INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, generated_hall_id, edit_reason) VALUES(?,?,?,1,?,'swap')",
          [sid, user, hall, hall])
      }
    })
    for (let i = 0; i < 11; i++) await session(u, h)
    // 12 sessions = 2 full rotations, starting from the swapped halls.
    expect(visitMatrix(u, h).every(row => row.every(c => c === 2))).toBe(true)
    expect(stats.backToBack).toBe(0)
    record("F8 manual swap", worstSpread(u, h))
  })

  it("F9 rotation carries over from one batch to the next", async () => {
    reset(6, 6)
    const u = staffIds(6), h = hallIdList(6)
    for (let i = 0; i < 4; i++) await session(u, h, 1)
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(2,'Batch 2','2026-27','draft')")
    step = 0
    for (let i = 0; i < 8; i++) await session(u, h, 2)
    // 12 sessions over two batches = exactly 2 full rotations.
    expect(visitMatrix(u, h).every(row => row.every(c => c === 2))).toBe(true)
    record("F9 two batches", worstSpread(u, h))
  })

  it("F10 restart rotation: everyone starts again, no repeats blocked by old history", async () => {
    reset(6, 6)
    const u = staffIds(6), h = hallIdList(6)
    for (let i = 0; i < 4; i++) await session(u, h)
    restartRotation()
    const r = await session(u, h)
    expect(r.gen.validation.isValid).toBe(true)
    for (let i = 0; i < 11; i++) await session(u, h)
    expect(visitMatrix(u, h).every(row => row.every(c => c === 2))).toBe(true)
    record("F10 restart rotation", worstSpread(u, h))
  })

  it("F11 same people morning and afternoon (FN + AN every day)", async () => {
    reset(4, 4)
    const u = staffIds(4), h = hallIdList(4)
    for (let day = 0; day < 10; day++) { await session(u, h); await session(u, h) }
    expect(visitMatrix(u, h).every(row => row.every(c => c === 5))).toBe(true)
    expect(stats.backToBack).toBe(0)
    record("F11 FN+AN daily", worstSpread(u, h))
  })

  it("F12 large college (60 staff, 30 halls, random 30 on duty, 60 sessions)", async () => {
    reset(60, 30)
    const all = staffIds(60), h = hallIdList(30), r = rng(99)
    const t0 = Date.now()
    for (let i = 0; i < 60; i++) await session(pick(all, 30, r), h)
    const ms = (Date.now() - t0) / 60
    expect(stats.repeats / (stats.sessions * 30)).toBeLessThan(0.05)
    expect(stats.backToBack / (stats.sessions * 30)).toBeLessThan(0.01)
    expect(ms).toBeLessThan(2000)
    record("F12 large 60 staff/30 halls", worstSpread(all, h), { msPerSession: Math.round(ms), dutiesPerPerson: dutyRange(all) })
  }, 120_000)
})
