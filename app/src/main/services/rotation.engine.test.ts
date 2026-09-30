import { describe, it, expect, beforeAll, beforeEach } from "vitest"
import { initDatabase, db } from "../db/database"
import { generateAllocation, commitToHistory } from "./rotation.engine"
import { validateAllocation, getValidHallsForStaff, type ValidationEntry } from "./validation.engine"
import { assignHalls, minimumRepeats, visitedThisCycle, allocationSeed } from "../../shared/assignment"
import { getOrCreateAllocation, editAllocationEntry, confirmAllocation, hardDeleteUser, deleteSession, restartRotation, getNotifications, getUnreadCount, refreshCycleStatus } from "./allocation.service"

// ??? Validation rule helpers (pure logic) ????????????????????????????????????

function checkR2(entries: { userId: number; hallId: number }[]): boolean {
  const counts = new Map<number, number>()
  for (const e of entries) counts.set(e.hallId, (counts.get(e.hallId) ?? 0) + 1)
  return [...counts.values()].some(c => c > 1)
}

function checkR3(entries: { userId: number; hallId: number }[]): boolean {
  const counts = new Map<number, number>()
  for (const e of entries) counts.set(e.userId, (counts.get(e.userId) ?? 0) + 1)
  return [...counts.values()].some(c => c > 1)
}

function checkR7(staffCount: number, hallCount: number): boolean {
  return staffCount !== hallCount
}

function checkR1(userId: number, hallId: number, recentHalls: number[]): boolean {
  return recentHalls.includes(hallId)
}

function checkR5(isActive: boolean): boolean { return !isActive }
function checkR6(isActive: boolean): boolean { return !isActive }

// ??? TESTS ???????????????????????????????????????????????????????????????????

const halls = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const staff = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]

/** Run `sessions` sessions of the shared engine for a fixed team; returns each session's user -> hall map. */
function simulate(userIds: number[], hallIds: number[], sessions: number, seedPrefix = "s") {
  const history = new Map<number, number[]>(userIds.map(u => [u, []]))
  const out: Map<number, number>[] = []
  for (let s = 0; s < sessions; s++) {
    const { entries } = assignHalls(userIds, hallIds, u => history.get(u)!, `${seedPrefix}${s}`)
    for (const e of entries) history.get(e.userId)!.unshift(e.hallId)
    out.push(new Map(entries.map(e => [e.userId, e.hallId])))
  }
  return out
}

describe("Rotation Engine ? Core Algorithm", () => {
  describe("visitedThisCycle()", () => {
    it("crosses off halls visited so far in the cycle (history is most recent first)", () => {
      expect([...visitedThisCycle([3, 1], [1, 2, 3, 4])].sort()).toEqual([1, 3])
    })
    it("resets once every hall of the pool has been visited", () => {
      expect(visitedThisCycle([3, 2, 1], [1, 2, 3]).size).toBe(0)
      expect([...visitedThisCycle([2, 3, 2, 1], [1, 2, 3])]).toEqual([2])
    })
    it("after more than two full cycles, only the current (most recent) cycle counts", () => {
      // Chronologically: 1,2,3,4 | 4,3,2,1 | 2,4 — passed most recent first.
      expect([...visitedThisCycle([4, 2, 1, 2, 3, 4, 4, 3, 2, 1], [1, 2, 3, 4])].sort()).toEqual([2, 4])
    })
    it("ignores halls outside the pool", () => {
      expect([...visitedThisCycle([9, 1, 8], [1, 2])]).toEqual([1])
    })
    it("new staff have visited nothing", () => {
      expect(visitedThisCycle([], halls).size).toBe(0)
    })
  })

  describe("Multi-session rotation (fixed team of 10)", () => {
    const sessions = simulate(staff, halls, 30)

    it("No two staff share the same hall in any session", () => {
      for (const s of sessions) expect(new Set(s.values()).size).toBe(staff.length)
    })

    it("No repeat until the cycle completes: every block of 10 sessions covers all 10 halls for everyone", () => {
      for (let c = 0; c < 3; c++) {
        for (const u of staff) {
          const cycle = sessions.slice(c * 10, c * 10 + 10).map(s => s.get(u)!)
          expect([...cycle].sort((a, b) => a - b)).toEqual(halls)
        }
      }
    })

    it("The order is a draw, not 'next hall in sequence'", () => {
      let plusOne = 0, moves = 0
      for (let i = 1; i < sessions.length; i++) {
        for (const u of staff) {
          moves++
          if (sessions[i].get(u) === (sessions[i - 1].get(u)! % 10) + 1) plusOne++
        }
      }
      expect(plusOne / moves).toBeLessThan(0.5)
      // Each cycle is a fresh draw: cycle 2 does not replay cycle 1.
      const order = (c: number, u: number) => sessions.slice(c * 10, c * 10 + 10).map(s => s.get(u))
      expect(staff.some(u => JSON.stringify(order(0, u)) !== JSON.stringify(order(1, u)))).toBe(true)
    })

    it("No one gets the same hall twice in a row across a cycle boundary", () => {
      for (const i of [10, 20]) for (const u of staff) expect(sessions[i].get(u)).not.toBe(sessions[i - 1].get(u))
    })

    it("Handles staff whose last hall is no longer in pool", () => {
      const reducedHalls = [1, 2, 3, 4, 5] // hall 6 removed
      const { entries, unavoidableRepeats } = assignHalls(staff.slice(0, 5), reducedHalls, u => (u === 101 ? [6] : []), "x")
      expect(reducedHalls).toContain(entries.find(e => e.userId === 101)!.hallId)
      expect(unavoidableRepeats).toBe(0)
    })
  })

  describe("Seeded draw", () => {
    it("The same seed gives the same result; the order of staff and halls does not matter", () => {
      const a = assignHalls(staff, halls, () => [], "seed-1").entries
      const b = assignHalls([...staff].reverse(), [...halls].reverse(), () => [], "seed-1").entries
      const byUser = (e: { userId: number; hallId: number }[]) => Object.fromEntries(e.map(x => [x.userId, x.hallId]))
      expect(byUser(b)).toEqual(byUser(a))
    })
    it("Different seeds give different draws", () => {
      const results = new Set(["a", "b", "c", "d", "e"].map(seed =>
        JSON.stringify(assignHalls(staff, halls, () => [], seed).entries.map(e => e.hallId))))
      expect(results.size).toBeGreaterThan(1)
    })
    it("allocationSeed ignores selection order but changes with the selection, session and batch", () => {
      const base = { cycleId: 1, sessionId: 5, createdAt: "t", userIds: [3, 1, 2], hallIds: [2, 1, 3] }
      expect(allocationSeed(base)).toBe(allocationSeed({ ...base, userIds: [1, 2, 3], hallIds: [1, 2, 3] }))
      expect(allocationSeed(base)).not.toBe(allocationSeed({ ...base, userIds: [1, 2, 4] }))
      expect(allocationSeed(base)).not.toBe(allocationSeed({ ...base, sessionId: 6 }))
      expect(allocationSeed(base)).not.toBe(allocationSeed({ ...base, cycleId: 2 }))
    })
  })

  describe("Unavoidable repeats", () => {
    it("A forced repeat is drawn from the cycle's used halls, never the person's last hall, and varies by seed", () => {
      // Pool 1-4. a and b have both had 1, 2, 3 (3 most recent): both can only take 4,
      // so one must repeat, with hall 1 or 2 (not 3, their last hall).
      const hist = (u: number) => (u === 1 || u === 2 ? [3, 2, 1] : [])
      const repeatHalls = new Set<number>()
      for (let s = 0; s < 40; s++) {
        const r = assignHalls([1, 2, 3, 4], [1, 2, 3, 4], hist, `r${s}`)
        expect(r.unavoidableRepeats).toBe(1)
        expect(minimumRepeats([1, 2, 3, 4], [1, 2, 3, 4], hist)).toBe(1)
        const repeater = r.entries.find(e => e.userId <= 2 && e.hallId !== 4)!
        expect(repeater.hallId).not.toBe(3)
        repeatHalls.add(repeater.hallId)
      }
      expect([...repeatHalls].sort()).toEqual([1, 2])
    })
  })
})

describe("Validation Rules ? Pure Logic", () => {
  describe("R1 ? Duplicate hall in rotation cycle", () => {
    it("BLOCKS when hall was used in last N sessions (still in cycle)", () => {
      expect(checkR1(101, 3, [1, 2, 3, 4, 5])).toBe(true)
    })
    it("ALLOWS hall used in a previous cycle (beyond window)", () => {
      expect(checkR1(101, 7, [1, 2, 3, 4, 5])).toBe(false)
    })
    it("ALLOWS brand new hall never used before", () => {
      expect(checkR1(101, 9, [])).toBe(false)
    })
  })

  describe("R2 ? Hall duplication in session", () => {
    it("BLOCKS when two staff share same hall", () => {
      expect(checkR2([{ userId: 101, hallId: 5 }, { userId: 102, hallId: 5 }])).toBe(true)
    })
    it("PASSES when all halls are unique", () => {
      expect(checkR2([{ userId: 101, hallId: 5 }, { userId: 102, hallId: 6 }])).toBe(false)
    })
    it("BLOCKS when 3 staff share same hall", () => {
      expect(checkR2([
        { userId: 101, hallId: 1 }, { userId: 102, hallId: 1 }, { userId: 103, hallId: 1 }
      ])).toBe(true)
    })
  })

  describe("R3 ? Staff duplication in session", () => {
    it("BLOCKS when same staff appears twice", () => {
      expect(checkR3([{ userId: 101, hallId: 1 }, { userId: 101, hallId: 2 }])).toBe(true)
    })
    it("PASSES when all staff IDs are unique", () => {
      expect(checkR3([{ userId: 101, hallId: 1 }, { userId: 102, hallId: 2 }])).toBe(false)
    })
  })

  describe("R5 ? Staff availability", () => {
    it("BLOCKS inactive staff", () => {
      expect(checkR5(false)).toBe(true)
    })
    it("PASSES active staff", () => {
      expect(checkR5(true)).toBe(false)
    })
  })

  describe("R6 ? Hall availability", () => {
    it("BLOCKS inactive hall", () => {
      expect(checkR6(false)).toBe(true)
    })
    it("PASSES active hall", () => {
      expect(checkR6(true)).toBe(false)
    })
  })

  describe("R7 ? Count match (staff = halls)", () => {
    it("BLOCKS when staff count != hall count", () => {
      expect(checkR7(8, 10)).toBe(true)
      expect(checkR7(12, 10)).toBe(true)
    })
    it("PASSES when counts are equal", () => {
      expect(checkR7(10, 10)).toBe(false)
      expect(checkR7(1, 1)).toBe(false)
    })
  })
})

// ??? INTEGRATION TESTS ? DATABASE & SERVICE FLOW (T1?T12) ???????????????????

describe("Integration Tests ? Database & Service Flow (T1?T12)", () => {
  beforeAll(async () => {
    await initDatabase({ inMemory: true })
  })

  beforeEach(() => {
    db.run("DELETE FROM rotation_history")
    db.run("DELETE FROM allocations")
    db.run("DELETE FROM exam_sessions")
    db.run("DELETE FROM exam_cycles")
    db.run("DELETE FROM halls")
    db.run("DELETE FROM users WHERE role='staff'")
    db.run("DELETE FROM departments")

    // Seed test master data
    db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'Computer Science')")
    for (let i = 1; i <= 10; i++) {
      const code = `H${String(i).padStart(3, "0")}`
      db.run("INSERT INTO halls(id, hall_code, name, capacity, sort_order, is_active) VALUES(?,?,?,?,?,1)", [
        i, code, `Hall ${i}`, 40, i
      ])
      const staffCode = `ST${String(i).padStart(3, "0")}`
      db.run("INSERT INTO users(id, staff_id, name, designation, role, department_id, is_active) VALUES(?,?,?,?,?,?,1)", [
        i, staffCode, `Staff ${i}`, "Assistant Professor", "staff", 1
      ])
    }

    // Default test cycle and sessions
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(1, 'Cycle 1', '2026-27', 'draft')")
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(2, 'Cycle 2', '2026-27', 'draft')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(1, 1, '2026-11-01', 'FN', 1, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(2, 1, '2026-11-01', 'AN', 2, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(3, 1, '2026-11-02', 'FN', 3, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(4, 1, '2026-11-02', 'AN', 4, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(5, 1, '2026-11-03', 'FN', 5, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(6, 2, '2026-12-01', 'FN', 1, 'pending')")
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(7, 2, '2026-12-01', 'AN', 2, 'pending')")
  })

  /** R1-R7 all pass for these generated entries: no blocking errors and no repeat warnings. */
  function expectAllRulesPass(sessionId: number, entries: { userId: number; hallId: number }[], hallIds: number[], userIds: number[]) {
    const v = validateAllocation(sessionId, entries.map(e => ({ userId: e.userId, hallId: e.hallId, sessionId })), hallIds, userIds)
    expect(v.blockingErrors).toEqual([])
    expect(v.warnings).toEqual([])
  }
  const confirmSessions = (...ids: number[]) => ids.forEach(id => db.run("UPDATE exam_sessions SET status='confirmed' WHERE id=?", [id]))
  const history = (userId: number, sessionId: number, hallId: number, order: number, recordedAt = "2026-11-01 10:00:00", step = 1) =>
    db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(?,?,?,?,?,?)",
      [userId, sessionId, hallId, step, order, recordedAt])
  /** R1 as seen by the validators (not by the engine's cost, where the visits term could mask an ordering bug). */
  const r1BlockedHalls = (userId: number, sessionId: number, pool: number[]) =>
    getValidHallsForStaff(userId, sessionId, pool, []).filter(v => !v.isValid).map(v => v.hallId)

  it("T1 ? New staff after existing history: new staff is treated as first-time participant", async () => {
    // Staff 1 already had hall 1; staff 2 has no history. Session 2 uses halls [1, 2].
    history(1, 1, 1, 1)
    confirmSessions(1)
    const result = await generateAllocation(2, [1, 2], [1, 2])

    // Staff 1 may not repeat hall 1 before their cycle over [1, 2] completes; hall 2 is all that is left.
    expect(visitedThisCycle([1], [1, 2]).has(result.find(r => r.userId === 1)!.hallId)).toBe(false)
    expect(result.find(r => r.userId === 1)?.hallId).toBe(2)
    expectAllRulesPass(2, result, [1, 2], [1, 2])
  })

  it("T2 ? Session pool smaller than global hall count: cycleLength matches session pool size", async () => {
    // 10 active halls exist globally, but Session 1 uses 6 halls [1, 2, 3, 4, 5, 6]
    const sessionHalls = [1, 2, 3, 4, 5, 6]
    const sessionStaff = [1, 2, 3, 4, 5, 6]

    const result = await generateAllocation(1, sessionStaff, sessionHalls)
    expect(result.length).toBe(6)

    const entries = result.map(r => ({ ...r, sessionId: 1 }))
    const validation = validateAllocation(1, entries, sessionHalls, sessionStaff)
    expect(validation.isValid).toBe(true)
  })

  it("T3 ? Cycle reset ordering: history is replayed in global_order, not by recorded_at", async () => {
    // Staff 1 completed a cycle over [1, 2, 3] (halls 1, 2, 3) and then had hall 1 again,
    // recorded with an OLDER timestamp. In global_order the new cycle has only hall 1 crossed off.
    history(1, 2, 1, 1, "2026-11-01 10:00:00")
    history(1, 3, 2, 2, "2026-11-02 10:00:00")
    history(1, 4, 3, 3, "2026-11-03 10:00:00")
    history(1, 5, 1, 4, "2026-10-01 10:00:00")

    // Replayed by recorded_at the history would read 1, 1, 2, 3 (a complete cycle, nothing blocked).
    expect(r1BlockedHalls(1, 1, [1, 2, 3])).toEqual([1])
    const repeat = validateAllocation(1, [{ userId: 1, hallId: 1, sessionId: 1 }, { userId: 2, hallId: 2, sessionId: 1 }, { userId: 3, hallId: 3, sessionId: 1 }], [1, 2, 3], [1, 2, 3])
    expect(repeat.blockingErrors.filter(e => e.rule === "R1").map(e => [e.userId, e.hallId])).toEqual([[1, 1]])

    const result = await generateAllocation(1, [1, 2, 3], [1, 2, 3])
    expect(result.find(r => r.userId === 1)?.hallId).not.toBe(1)
    expectAllRulesPass(1, result, [1, 2, 3], [1, 2, 3])
  })

  it("T4 ? Cross-cycle latest history: Cycle 2 step 1 is newer than Cycle 1 step 5", async () => {
    // Cycle 1 steps 3-5: halls 1, 2, 3 (a full cycle over [1, 2, 3]); Cycle 2 step 1: hall 2.
    // Ordered by rotation_step instead of global_order, hall 2 would look oldest and be allowed.
    const at = "2026-11-01 10:00:00"
    history(1, 3, 1, 3, at, 3)
    history(1, 4, 2, 4, at, 4)
    history(1, 5, 3, 5, at, 5)
    history(1, 6, 2, 6, at, 1)

    // Replayed by rotation_step the history would read 2, 1, 2, 3 (a complete cycle, nothing blocked).
    expect(r1BlockedHalls(1, 1, [1, 2, 3])).toEqual([2])
    const repeat = validateAllocation(1, [{ userId: 1, hallId: 2, sessionId: 1 }, { userId: 2, hallId: 1, sessionId: 1 }, { userId: 3, hallId: 3, sessionId: 1 }], [1, 2, 3], [1, 2, 3])
    expect(repeat.blockingErrors.filter(e => e.rule === "R1").map(e => [e.userId, e.hallId])).toEqual([[1, 2]])

    const result = await generateAllocation(1, [1, 2, 3], [1, 2, 3])
    expect(result.find(r => r.userId === 1)?.hallId).not.toBe(2)
    expectAllRulesPass(1, result, [1, 2, 3], [1, 2, 3])
  })

  it("T5 ? R1 current-cycle window uses session pool length instead of global count", async () => {
    // Session pool has 3 halls [1, 2, 3]. Staff 1 was in Hall 1 in previous session
    db.run(
      "INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(1, 1, 1, 1, 1, '2026-11-01 10:00:00')"
    )

    const entries = [{ userId: 1, hallId: 1, sessionId: 2 }]
    const validation = validateAllocation(2, entries, [1, 2, 3], [1])
    // Repeating Hall 1 within 3-hall cycle must trigger R1
    expect(validation.isValid).toBe(false)
    expect(validation.blockingErrors.some(e => e.rule === "R1")).toBe(true)
  })

  it("T6 ? Edit outside session pool is rejected", async () => {
    // Session 1 has pool [1, 2], allocated to Staff [1, 2]
    await getOrCreateAllocation(1, [1, 2], [1, 2])

    // Try to edit Staff 1's allocation to Hall 9 (active hall, but outside Session 1's pool [1, 2])
    const res = editAllocationEntry(1, 1, 9)
    expect(res.success).toBe(false)
    expect(res.error?.rule).toBe("SESSION_POOL")
  })

it("T7 ? Edited hall becomes future baseline", async () => {
    // Session 1: staff [1, 2], halls [1, 2]
    await getOrCreateAllocation(1, [1, 2], [1, 2])

    // Admin swaps their halls: delete and re-insert to avoid transient UNIQUE collisions
    db.run("DELETE FROM allocations WHERE session_id = 1")
    db.run("INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, edit_reason, generated_hall_id) VALUES(1, 1, 2, 1, 'Swapped', 1)")
    db.run("INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, edit_reason, generated_hall_id) VALUES(1, 2, 1, 1, 'Swapped', 2)")

    // Confirm Session 1
    const confRes = await confirmAllocation(1)
    expect(confRes.success).toBe(true)

    // Verify history recorded the edited hall (Hall 2 for Staff 1)
    const hist1 = db.queryOne<any>("SELECT hall_id FROM rotation_history WHERE session_id = 1 AND user_id = 1")
    expect(hist1.hall_id).toBe(2)
    const hist2 = db.queryOne<any>("SELECT hall_id FROM rotation_history WHERE session_id = 1 AND user_id = 2")
    expect(hist2.hall_id).toBe(1)

    // Session 2: the edited halls are what count as visited, so neither may repeat theirs.
    const s2Res = await generateAllocation(2, [1, 2], [1, 2])
    expect(s2Res.find(r => r.userId === 1)?.hallId).not.toBe(2)
    expect(s2Res.find(r => r.userId === 2)?.hallId).not.toBe(1)
    expectAllRulesPass(2, s2Res, [1, 2], [1, 2])
  })

  it("T8 ? Draft does not advance history until confirmed", async () => {
    // Generate draft for Session 1
    await getOrCreateAllocation(1, [1, 2], [1, 2])

    // rotation_history must remain empty
    const histCountBefore = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(histCountBefore.c).toBe(0)

    // Confirm Session 1
    const confRes = await confirmAllocation(1)
    expect(confRes.success).toBe(true)

    // Now rotation_history has exactly 2 records
    const histCountAfter = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(histCountAfter.c).toBe(2)
  })

  it("T9 — Transaction rollback on failure leaves database untouched", async () => {
    await getOrCreateAllocation(1, [1, 2], [1, 2])

    // Verify state before transaction
    const sessionBefore = db.queryOne<any>("SELECT status FROM exam_sessions WHERE id=1")
    expect(sessionBefore.status).toBe("draft")
    const histBefore = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(histBefore.c).toBe(0)

    // Attempt a transaction that writes to rotation_history, updates session, and modifies allocations, then throws
    let threw = false
    try {
      await db.runTransaction(async () => {
        db.run("INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order) VALUES(1, 1, 1, 1, 999)")
        db.run("UPDATE exam_sessions SET status='confirmed' WHERE id=1")
        db.run("UPDATE allocations SET is_manually_edited=1 WHERE session_id=1 AND user_id=1")
        throw new Error("Controlled test failure")
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)

    // Verify all changes were rolled back atomically
    const alloc = db.queryOne<any>("SELECT is_manually_edited FROM allocations WHERE session_id=1 AND user_id=1")
    expect(alloc.is_manually_edited).toBe(0)
    const sessionAfter = db.queryOne<any>("SELECT status FROM exam_sessions WHERE id=1")
    expect(sessionAfter.status).toBe("draft")
    const histAfter = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(histAfter.c).toBe(0)
  })

  it("T10 ? Same-session uniqueness: duplicate staff or hall assignments cannot be confirmed", async () => {
    // Direct validation of duplicate assignment
    const dupHallEntries = [
      { userId: 1, hallId: 1, sessionId: 1 },
      { userId: 2, hallId: 1, sessionId: 1 }
    ]
    const valResult = validateAllocation(1, dupHallEntries, [1, 2], [1, 2])
    expect(valResult.isValid).toBe(false)
    expect(valResult.blockingErrors.some(e => e.rule === "R2")).toBe(true)

    // Duplicate staff validation
    const dupStaffEntries = [
      { userId: 1, hallId: 1, sessionId: 1 },
      { userId: 1, hallId: 2, sessionId: 1 }
    ]
    const valStaffResult = validateAllocation(1, dupStaffEntries, [1, 2], [1, 2])
    expect(valStaffResult.isValid).toBe(false)
    expect(valStaffResult.blockingErrors.some(e => e.rule === "R3")).toBe(true)
  })

  it("T11 ? After a full cycle every hall is available again (no hall back-to-back)", async () => {
    // Staff 1 has been through the whole 5-hall pool, ending in hall 5.
    for (let h = 1; h <= 5; h++) history(1, h, h, h)

    // The cycle is complete: no hall is blocked by R1.
    expect(getValidHallsForStaff(1, 6, [1, 2, 3, 4, 5], []).every(v => v.isValid)).toBe(true)
    const result = await generateAllocation(6, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
    expect(result.find(r => r.userId === 1)?.hallId).not.toBe(5) // soft preference: not their last hall
    expectAllRulesPass(6, result, [1, 2, 3, 4, 5], [1, 2, 3, 4, 5])
  })

  it("T12 ? Staff-specific rotation: staff advances only when selected", async () => {
    const pool = [1, 2, 3]
    const hallOf = (entries: { userId: number; hallId: number }[], u: number) => entries.find(r => r.userId === u)!.hallId

    // Session 1: Staff [1, 2, 3]
    const s1 = await generateAllocation(1, [1, 2, 3], pool)
    expectAllRulesPass(1, s1, pool, [1, 2, 3])
    await commitToHistory(1, 1, s1); confirmSessions(1)

    // Session 2: Staff [1, 3, 4] (Staff 2 is absent)
    const s2 = await generateAllocation(2, [1, 3, 4], pool)
    expectAllRulesPass(2, s2, pool, [1, 3, 4])
    await commitToHistory(2, 2, s2); confirmSessions(2)

    // Session 3: Staff [2, 3, 4] (Staff 2 returns)
    const s3 = await generateAllocation(3, [2, 3, 4], pool)
    expectAllRulesPass(3, s3, pool, [2, 3, 4])
    // Staff 2's cycle did not advance while absent: their Session 1 hall is still crossed off.
    expect(hallOf(s3, 2)).not.toBe(hallOf(s1, 2))
    // Staff 3 was on duty all three times: one full cycle, every hall once.
    expect([hallOf(s1, 3), hallOf(s2, 3), hallOf(s3, 3)].sort()).toEqual(pool)
  })

  it("T13 — Regression: 2 staff, 2 halls full-cycle restart: Session 3 starts a new cycle with ZERO validation errors", async () => {
    const userIds = [1, 2]
    const hallIds = [1, 2]
    const hallOf = (d: any, u: number) => d.entries.find((e: any) => e.userId === u)?.hallId

    const s1Draft = await getOrCreateAllocation(1, userIds, hallIds)
    expect((await confirmAllocation(1)).success).toBe(true)
    const s2Draft = await getOrCreateAllocation(2, userIds, hallIds)
    expect((await confirmAllocation(2)).success).toBe(true)
    // Sessions 1-2 are one full cycle: each person has had both halls.
    for (const u of userIds) expect([hallOf(s1Draft, u), hallOf(s2Draft, u)].sort()).toEqual(hallIds)

    // Session 3 starts the next cycle, and nobody keeps the hall they just had.
    const s3Draft = await getOrCreateAllocation(3, userIds, hallIds)
    for (const u of userIds) expect(hallOf(s3Draft, u)).not.toBe(hallOf(s2Draft, u))

    // Validate Session 3: must have ZERO validation errors (R1 was previously blocking full-cycle restart)
    const valResult = validateAllocation(3, s3Draft.entries as ValidationEntry[], hallIds, userIds)
    expect(valResult.isValid).toBe(true)
    expect(valResult.blockingErrors).toHaveLength(0)
    expect(valResult.warnings).toHaveLength(0)

    // Confirm Session 3 succeeds cleanly with zero errors
    const conf3 = await confirmAllocation(3)
    expect(conf3.success).toBe(true)
  })

  it("T14 — hardDeleteUser: refuses when history exists and succeeds when it doesn't", async () => {
    // 1. Staff 1 has rotation history -> deletion refused
    db.run(
      "INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(1, 1, 1, 1, 1, '2026-11-01 10:00:00')"
    )
    const historyCheck = db.queryOne<any>("SELECT id FROM rotation_history WHERE user_id = 1")
    expect(historyCheck).toBeDefined()

    const failRes = hardDeleteUser(1)
    expect(failRes.success).toBe(false)
    expect(failRes.error).toBe("Cannot permanently delete: this staff member has allocation history.")

    // Confirm staff 1 still exists
    const user1StillExists = db.queryOne<any>("SELECT id FROM users WHERE id = 1")
    expect(user1StillExists).toBeDefined()

    // 2. Create a new inactive staff member without any history or allocations
    const { lastInsertRowid: newUserId } = db.run(
      "INSERT INTO users (staff_id, name, role, is_active) VALUES ('TEMP999', 'Temporary Inactive Staff', 'staff', 0)"
    )
    const newUserBefore = db.queryOne<any>("SELECT id FROM users WHERE id = ?", [newUserId])
    expect(newUserBefore).toBeDefined()

    // Deletion must succeed
    const okRes = hardDeleteUser(newUserId)
    expect(okRes.success).toBe(true)

    // Confirm user is completely deleted
    const newUserAfter = db.queryOne<any>("SELECT id FROM users WHERE id = ?", [newUserId])
    expect(newUserAfter).toBeUndefined()
  })

  it("T15 — deleteSession: succeeds on a draft with existing allocations", async () => {
    // Create a new session in cycle 1
    const { lastInsertRowid: testSessionId } = db.run(
      "INSERT INTO exam_sessions (cycle_id, exam_date, session_type, rotation_step, status) VALUES (1, '2026-10-10', 'FN', 99, 'draft')"
    )

    // Insert dummy draft allocations for this session
    db.run("INSERT INTO allocations (session_id, user_id, hall_id) VALUES (?, 1, 1)", [testSessionId])
    db.run("INSERT INTO allocations (session_id, user_id, hall_id) VALUES (?, 2, 2)", [testSessionId])

    const allocCountBefore = db.queryOne<any>("SELECT COUNT(*) as c FROM allocations WHERE session_id = ?", [testSessionId])
    expect(allocCountBefore.c).toBe(2)

    // Call deleteSession
    const res = deleteSession(testSessionId)
    expect(res.success).toBe(true)

    // Session must be deleted
    const sessionAfter = db.queryOne<any>("SELECT id FROM exam_sessions WHERE id = ?", [testSessionId])
    expect(sessionAfter).toBeUndefined()

    // Allocations must be deleted
    const allocCountAfter = db.queryOne<any>("SELECT COUNT(*) as c FROM allocations WHERE session_id = ?", [testSessionId])
    expect(allocCountAfter.c).toBe(0)
  })

  it("T16 — restartRotation: empties rotation_history and creates one notification per active staff member", async () => {
    // Insert history rows before restart
    db.run(
      "INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(1, 1, 1, 1, 1, '2026-11-01 10:00:00')"
    )
    db.run(
      "INSERT INTO rotation_history(user_id, session_id, hall_id, rotation_step, global_order, recorded_at) VALUES(2, 1, 2, 1, 2, '2026-11-01 10:00:00')"
    )

    // Confirm rotation_history is non-empty before restart
    const historyBefore = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(historyBefore.c).toBeGreaterThan(0)

    const activeStaff = db.query<any>("SELECT id FROM users WHERE role = 'staff' AND is_active = 1")
    expect(activeStaff.length).toBeGreaterThan(0)

    // Execute restartRotation
    const res = restartRotation()
    expect(res.success).toBe(true)

    // rotation_history must now be completely empty
    const historyAfter = db.queryOne<any>("SELECT COUNT(*) as c FROM rotation_history")
    expect(historyAfter.c).toBe(0)

    // Each active staff member must have received a notification
    for (const staff of activeStaff) {
      const notifs = getNotifications(staff.id)
      const restartNotif = notifs.find((n: any) => n.title === "Rotation Restarted")
      expect(restartNotif).toBeDefined()
      expect(restartNotif!.message).toBe(
        "Your entire hall rotation history has been restarted by the admin. Your rotation cycle has been reset, so every hall is open to you again from your next duty."
      )
      expect(getUnreadCount(staff.id)).toBeGreaterThan(0)
    }
  })

  it("T17 — Batch status follows its sessions: draft until every session is confirmed", async () => {
    const cycleStatus = () => db.queryOne<any>("SELECT status FROM exam_cycles WHERE id=2")?.status

    // Cycle 2 has sessions 6 and 7. Confirming only one keeps the batch in draft.
    await getOrCreateAllocation(6, [1, 2], [1, 2])
    expect((await confirmAllocation(6)).success).toBe(true)
    expect(cycleStatus()).toBe("draft")

    // Confirming the last session marks the whole batch confirmed.
    await getOrCreateAllocation(7, [1, 2], [1, 2])
    expect((await confirmAllocation(7)).success).toBe(true)
    expect(cycleStatus()).toBe("confirmed")

    // Adding a new pending session reopens the batch.
    db.run("INSERT INTO exam_sessions(cycle_id, exam_date, session_type, rotation_step, status) VALUES(2, '2026-12-02', 'FN', 3, 'pending')")
    refreshCycleStatus(2)
    expect(cycleStatus()).toBe("draft")
  })

  it("T18 — Same staff and halls in two different sessions get independent draws; both pass R1-R7", async () => {
    const userIds = halls, hallIds = halls // 10 staff (ids 1-10), 10 halls
    const byUser = (entries: any[]) => Object.fromEntries(entries.map(e => [e.userId, e.hallId]))

    // Session 1 (batch 1, step 1) and session 6 (batch 2, step 1): identical selection, identical (empty) history.
    const a = await getOrCreateAllocation(1, userIds, hallIds)
    const b = await getOrCreateAllocation(6, userIds, hallIds)
    expect(byUser(a.entries)).not.toEqual(byUser(b.entries))
    for (const [sid, gen] of [[1, a], [6, b]] as const) {
      expect(gen.validation.blockingErrors).toEqual([])
      expect(gen.validation.warnings).toEqual([])
      expectAllRulesPass(sid, gen.entries as any[], hallIds, userIds)
    }

    // Regenerating either one reproduces its own draft exactly.
    expect(byUser((await getOrCreateAllocation(1, [...userIds].reverse(), hallIds)).entries)).toEqual(byUser(a.entries))
  })

  it("T19 — History longer than two full cycles: exactly the most recent cycle's halls are blocked", async () => {
    // Pool [1-4]. In global_order: cycle 1 = 1,2,3,4; cycle 2 = 4,3,2,1; current cycle so far = 2,4.
    // The current cycle's halls {2, 4} differ from the start of either earlier cycle ({1, 2}, {4, 3}),
    // and the same rows replayed in the wrong direction end on a complete cycle (nothing blocked).
    db.run("INSERT INTO exam_cycles(id, name, academic_year, status) VALUES(3, 'Old batch', '2025-26', 'confirmed')")
    const chronological = [1, 2, 3, 4, 4, 3, 2, 1, 2, 4]
    chronological.forEach((hall, i) => {
      db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(?, 3, '2025-11-01', 'FN', ?, 'confirmed')", [101 + i, i + 1])
      history(1, 101 + i, hall, i + 1)
    })
    const pool = [1, 2, 3, 4]

    expect(r1BlockedHalls(1, 1, pool)).toEqual([2, 4])
    const repeat = validateAllocation(1, [{ userId: 1, hallId: 4, sessionId: 1 }, { userId: 2, hallId: 1, sessionId: 1 },
      { userId: 3, hallId: 2, sessionId: 1 }, { userId: 4, hallId: 3, sessionId: 1 }], pool, [1, 2, 3, 4])
    expect(repeat.blockingErrors.filter(e => e.rule === "R1").map(e => [e.userId, e.hallId])).toEqual([[1, 4]])

    const result = await generateAllocation(1, [1, 2, 3, 4], pool)
    expect([1, 3]).toContain(result.find(r => r.userId === 1)!.hallId)
    expectAllRulesPass(1, result, pool, [1, 2, 3, 4])
  })
})