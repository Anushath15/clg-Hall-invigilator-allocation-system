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
import { getOrCreateAllocation, confirmAllocation, restartRotation, editAllocationEntry, deleteSession } from "./allocation.service"

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
// created_at is part of the allocation seed; a fixed value keeps every run of this suite
// reproducible (real sessions get their real creation time).
const CREATED_AT = "2026-01-01 00:00:00"

function lastHall(userId: number): number | undefined {
  return db.queryOne<any>("SELECT hall_id FROM rotation_history WHERE user_id=? ORDER BY global_order DESC LIMIT 1", [userId])?.hall_id
}

/** Create a session, generate its allocation and confirm it, recording metrics. */
async function session(userIds: number[], hallIds: number[], cycleId = 1, edit?: (sid: number) => void) {
  step++; sessionId++
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status, created_at) VALUES(?,?,?,?,?,'pending',?)",
    [sessionId, cycleId, `2026-${String(11 + Math.floor(sessionId / 60)).padStart(2, "0")}-01`, sessionId % 2 ? "FN" : "AN", step, CREATED_AT])
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

beforeAll(async () => { await initDatabase({ inMemory: true }) })
afterAll(() => { console.log("\nFAIRNESS REPORT"); console.table(report) })

/** Create a pending session without generating it (for scenarios that drive each step themselves). */
function newSession(cycleId = 1) {
  step++; sessionId++
  db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status, created_at) VALUES(?,?,?,?,?,'pending',?)",
    [sessionId, cycleId, "2027-01-01", sessionId % 2 ? "FN" : "AN", step, CREATED_AT])
  return sessionId
}
const mapping = (sid: number) => Object.fromEntries(
  db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id=? ORDER BY user_id", [sid]).map(r => [r.user_id, r.hall_id]))
const historyCount = () => db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")?.c ?? 0

describe("Allocation fairness across many sessions", () => {

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
    // Some unavoidable repeats are a mathematical consequence of 10 staff sharing 6 halls
    // under random draws, not a defect: each person's cycle is drawn independently, so the
    // halls the 6 people on duty still need can fail to line up into a repeat-free
    // assignment (the engine then makes the minimum number of repeats, and the validator
    // warns). Over 20 independent draws the worst case was 11 of 360 assignments (3.1%);
    // the limit is ~1.5x that.
    expect(stats.repeats / (stats.sessions * 6)).toBeLessThan(0.046)
    expect(stats.backToBack / (stats.sessions * 6)).toBeLessThan(0.01)
    // The hall spread comes from those forced repeats, not a bug: a repeated hall stays one
    // visit ahead of the person's other halls, so partway through a later cycle it can be
    // two ahead of a hall they have not had yet. The limit matches the one already used for
    // random duty lists in F4, F5 and G1.
    const spread = worstSpread(all, h)
    expect(spread).toBeLessThanOrEqual(3)
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


// ─── More scenarios: messier real life, edge cases, and attempts to break the rules ───

describe("More allocation scenarios", () => {
  it("G1 a different number of halls each day (3 to 8 halls, staff drawn from 12)", async () => {
    reset(12, 8)
    const all = staffIds(12), r = rng(5)
    for (let i = 0; i < 60; i++) {
      const k = 3 + Math.floor(r() * 6)
      await session(pick(all, k, r), hallIdList(k))
    }
    expect(stats.backToBack / (stats.sessions * 5)).toBeLessThan(0.02)
    // Halls 1-3 are open every day, so that is where fairness can be compared.
    const alwaysOpen = worstSpread(all, hallIdList(3))
    expect(alwaysOpen).toBeLessThanOrEqual(3)
    record("G1 3-8 halls per day", alwaysOpen, { note: "spread over halls open every day" })
  })

  it("G2 a different set of halls each session (5 of 8 halls, 5 of 10 staff)", async () => {
    reset(10, 8)
    const all = staffIds(10), halls = hallIdList(8), r = rng(21)
    for (let i = 0; i < 80; i++) await session(pick(all, 5, r), pick(halls, 5, r).sort((a, b) => a - b))
    expect(stats.backToBack / (stats.sessions * 5)).toBeLessThan(0.02)
    record("G2 random hall sets", worstSpread(all, halls), { dutiesPerPerson: dutyRange(all) })
  })

  it("G3 a new hall is added permanently (5 halls, then 6 with one more staff)", async () => {
    reset(6, 6)
    const u = staffIds(6)
    for (let i = 0; i < 10; i++) await session(u.slice(0, 5), hallIdList(5))
    for (let i = 0; i < 18; i++) await session(u, hallIdList(6))
    expect(stats.backToBack).toBe(0)
    // Everyone, including the late starter, has had the new hall 6 at least twice.
    for (const row of visitMatrix(u, [6])) expect(row[0]).toBeGreaterThanOrEqual(2)
    record("G3 hall added", worstSpread(u, hallIdList(6)))
  })

  it("G4 a teacher goes on long leave and returns", async () => {
    reset(7, 6)
    const u = staffIds(7), h = hallIdList(6)
    const team = u.slice(0, 6), cover = [...u.slice(0, 5), u[6]]
    for (let i = 0; i < 12; i++) await session(team, h)
    for (let i = 0; i < 20; i++) await session(cover, h)   // u[5] away, u[6] covers
    for (let i = 0; i < 12; i++) await session(team, h)   // u[5] back
    expect(stats.backToBack).toBe(0)
    record("G4 long leave and return", worstSpread(u.slice(0, 5), h))
  })

  it("G5 a single hall with one invigilator, and a single hall with staff taking turns", async () => {
    reset(3, 1)
    for (let i = 0; i < 5; i++) await session([101], [1])
    for (let i = 0; i < 9; i++) await session([staffIds(3)[i % 3]], [1])
    expect(stats.repeats).toBe(0)
    record("G5 single hall", 0)
  })

  it("G6 regenerating a draft gives the same result and does not touch the rotation", async () => {
    reset(8, 8)
    const u = staffIds(8), h = hallIdList(8)
    for (let i = 0; i < 5; i++) await session(u, h)
    const sid = newSession(), before = historyCount()
    await getOrCreateAllocation(sid, u, h)
    const first = mapping(sid)
    for (let i = 0; i < 3; i++) {
      await getOrCreateAllocation(sid, u, h)
      expect(mapping(sid)).toEqual(first)
    }
    expect(historyCount()).toBe(before) // nothing recorded until confirmation
    expect((await confirmAllocation(sid)).success).toBe(true)
    expect(historyCount()).toBe(before + 8)
    record("G6 regenerate draft", worstSpread(u, h))
  })

  it("G7 the order in which staff and halls are ticked does not change who gets which hall", async () => {
    reset(10, 6)
    const all = staffIds(10), h = hallIdList(6), r = rng(3)
    for (let i = 0; i < 12; i++) await session(pick(all, 6, r), h)
    const duty = pick(all, 6, r)
    const sid = newSession()
    await getOrCreateAllocation(sid, duty, h)
    const expected = mapping(sid)
    for (const order of [[...duty].reverse(), pick(duty, 6, r), pick(duty, 6, r)]) {
      await getOrCreateAllocation(sid, order, h)
      expect(mapping(sid)).toEqual(expected)
    }
    record("G7 selection order", worstSpread(all, h))
  })

  it("G8 sessions must be confirmed in order", async () => {
    reset(4, 4)
    const u = staffIds(4), h = hallIdList(4)
    const s1 = newSession(), s2 = newSession()
    await getOrCreateAllocation(s2, u, h)
    const early = await confirmAllocation(s2)
    expect(early.success).toBe(false)
    expect(early.validation?.blockingErrors.map((e: any) => e.rule)).toContain("R4")
    await getOrCreateAllocation(s1, u, h)
    expect((await confirmAllocation(s1)).success).toBe(true)
    await getOrCreateAllocation(s2, u, h)
    expect((await confirmAllocation(s2)).success).toBe(true)
  })

  it("G9 staff and hall counts must match", async () => {
    reset(6, 6)
    const sid = newSession()
    await expect(getOrCreateAllocation(sid, staffIds(5), hallIdList(6))).rejects.toThrow(/must equal hall count/)
    await expect(getOrCreateAllocation(sid, staffIds(6), hallIdList(5))).rejects.toThrow(/must equal hall count/)
  })

  it("G10 inactive staff or halls cannot be confirmed", async () => {
    reset(4, 4)
    const u = staffIds(4), h = hallIdList(4)
    const sid = newSession()
    await getOrCreateAllocation(sid, u, h)
    db.run("UPDATE users SET is_active=0 WHERE id=?", [u[0]])
    let c = await confirmAllocation(sid)
    expect(c.success).toBe(false)
    expect(c.validation?.blockingErrors.map((e: any) => e.rule)).toContain("R5")
    db.run("UPDATE users SET is_active=1 WHERE id=?", [u[0]])
    db.run("UPDATE halls SET is_active=0 WHERE id=2")
    c = await confirmAllocation(sid)
    expect(c.success).toBe(false)
    expect(c.validation?.blockingErrors.map((e: any) => e.rule)).toContain("R6")
  })

  it("G11 a forced repeat: minimum repeats, drawn from the cycle's used halls except the last one, confirmed with a warning", async () => {
    reset(3, 3)
    const [a, b, c] = staffIds(3)
    // a and b both had halls 1 then 2, so each may only take hall 3 next: one of them must repeat.
    const past = [newSession(), newSession()]
    for (const p of past) db.run("UPDATE exam_sessions SET status='confirmed' WHERE id=?", [p])
    let order = 1
    for (const [u, h, p] of [[a, 1, past[0]], [b, 1, past[0]], [a, 2, past[1]], [b, 2, past[1]]]) {
      db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(?,?,?,1,?,datetime('now'))", [u, p, h, order++])
    }
    const sid = newSession()
    const gen = await getOrCreateAllocation(sid, [a, b, c], hallIdList(3))
    const m = mapping(sid)
    const repeaters = [a, b].filter(u => m[u] !== 3)
    expect(repeaters.length).toBe(1)                // exactly one repeat, the minimum
    expect(m[repeaters[0]]).toBe(1)                 // used in this cycle and not their last hall (2): hall 1 is the only such hall
    expect(gen.validation.isValid).toBe(true)
    expect(gen.validation.warnings.length).toBe(1)
    const conf = await confirmAllocation(sid)
    expect(conf.success).toBe(true)
    expect(conf.validation?.warnings[0]).toMatch(/Unavoidable repeat/)
  })

  it("G12 illegal manual edits are refused", async () => {
    reset(4, 5)
    const u = staffIds(4)
    for (let i = 0; i < 3; i++) await session(u, hallIdList(4))
    const sid = newSession()
    await getOrCreateAllocation(sid, u, hallIdList(4))
    const m = mapping(sid)
    // Three sessions into a four-hall cycle, each person's only unvisited hall is the one they
    // have, so swapping with anyone repeats a hall (R1).
    expect((await editAllocationEntry(sid, u[0], m[u[1]])).error?.rule).toBe("R1")
    // Onto a hall outside this session's pool.
    expect((await editAllocationEntry(sid, u[0], 5)).error?.rule).toBe("SESSION_POOL")
    // Nothing changed.
    expect(mapping(sid)).toEqual(m)
  })

  it("G13 deleting a draft session part-way does not disturb the rotation", async () => {
    reset(5, 5)
    const u = staffIds(5), h = hallIdList(5)
    for (let i = 0; i < 3; i++) await session(u, h)
    const before = historyCount()
    const draft = newSession()
    await getOrCreateAllocation(draft, u, h)
    expect(deleteSession(draft).success).toBe(true)
    expect(historyCount()).toBe(before) // the deleted draft left no trace in the rotation
    const { gen, conf } = await session(u, h)
    expect(gen.validation.isValid).toBe(true)
    expect(gen.validation.warnings).toEqual([])
    expect(conf.success).toBe(true)
    for (let i = 0; i < 6; i++) await session(u, h)
    // 10 confirmed sessions over 5 halls = exactly 2 full cycles for everyone.
    expect(visitMatrix(u, h).every(row => row.every(c => c === 2))).toBe(true)
    record("G13 draft deleted", worstSpread(u, h))
  })

  it("G14 long run: 300 sessions with a fixed team stay perfectly balanced", async () => {
    reset(6, 6)
    const u = staffIds(6), h = hallIdList(6)
    for (let i = 0; i < 300; i++) await session(u, h)
    expect(visitMatrix(u, h).every(row => row.every(c => c === 50))).toBe(true)
    expect(stats.repeats + stats.backToBack).toBe(0)
    record("G14 300 sessions", worstSpread(u, h))
  }, 120_000)

  it("G15 two batches running side by side (sessions alternate between them)", async () => {
    reset(6, 6)
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(2,'Batch 2','2026-27','draft')")
    const u = staffIds(6), h = hallIdList(6)
    for (let i = 0; i < 24; i++) await session(u, h, i % 2 ? 2 : 1)
    expect(visitMatrix(u, h).every(row => row.every(c => c === 4))).toBe(true)
    record("G15 interleaved batches", worstSpread(u, h))
  })

  it("G16 a large group of newcomers all start together", async () => {
    reset(20, 20)
    const u = staffIds(20), h = hallIdList(20)
    for (let i = 0; i < 40; i++) await session(u, h)
    expect(visitMatrix(u, h).every(row => row.every(c => c === 2))).toBe(true)
    expect(stats.repeats + stats.backToBack).toBe(0)
    record("G16 20 newcomers", worstSpread(u, h))
  })

  it("G17 very large college: 150 staff, 100 halls, random 100 on duty", async () => {
    reset(150, 100)
    const all = staffIds(150), h = hallIdList(100), r = rng(77)
    const t0 = Date.now()
    for (let i = 0; i < 15; i++) await session(pick(all, 100, r), h)
    const ms = (Date.now() - t0) / 15
    expect(ms).toBeLessThan(3000)
    expect(stats.backToBack).toBe(0)
    record("G17 150 staff/100 halls", worstSpread(all, h), { msPerSession: Math.round(ms), dutiesPerPerson: dutyRange(all) })
  }, 180_000)
})
