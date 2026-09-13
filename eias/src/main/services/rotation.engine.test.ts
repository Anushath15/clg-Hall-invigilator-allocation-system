import { describe, it, expect } from "vitest"

// ─── Pure rotation logic (no DB needed) ──────────────────────────────────────

function circularNext(hallIds: number[], lastHallId: number): number {
  const idx = hallIds.indexOf(lastHallId)
  if (idx === -1) return hallIds[0]
  return hallIds[(idx + 1) % hallIds.length]
}

function generateFirstAllocation(userIds: number[], hallIds: number[]) {
  return userIds.map((userId, i) => ({ userId, hallId: hallIds[i % hallIds.length] }))
}

function generateRotation(
  userIds: number[],
  hallIds: number[],
  lastAssignments: Map<number, number>
): Map<number, number> {
  const result = new Map<number, number>()
  const used = new Set<number>()
  for (const userId of userIds) {
    const last = lastAssignments.get(userId)
    let candidate: number
    if (last !== undefined) {
      const idx = hallIds.indexOf(last)
      let found = false
      for (let attempt = 1; attempt <= hallIds.length; attempt++) {
        const c = hallIds[(idx + attempt) % hallIds.length]
        if (!used.has(c)) { candidate = c; found = true; break }
      }
      if (!found) candidate = hallIds.find(h => !used.has(h)) ?? hallIds[0]
    } else {
      candidate = hallIds.find(h => !used.has(h)) ?? hallIds[userIds.indexOf(userId) % hallIds.length]
    }
    result.set(userId, candidate!)
    used.add(candidate!)
  }
  return result
}

// ─── Validation rule helpers (pure logic) ────────────────────────────────────

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

// ─── TESTS ───────────────────────────────────────────────────────────────────

const halls = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const staff = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]

describe("Rotation Engine — Core Algorithm", () => {
  describe("circularNext()", () => {
    it("returns next hall in sequence", () => {
      expect(circularNext(halls, 1)).toBe(2)
      expect(circularNext(halls, 5)).toBe(6)
      expect(circularNext(halls, 9)).toBe(10)
    })
    it("wraps around from last to first hall (H010 → H001)", () => {
      expect(circularNext(halls, 10)).toBe(1)
    })
    it("returns first hall if lastHall not in current pool", () => {
      expect(circularNext(halls, 99)).toBe(1)
    })
  })

  describe("generateFirstAllocation()", () => {
    it("assigns halls in positional order for first session", () => {
      const result = generateFirstAllocation([101, 102, 103], [1, 2, 3])
      expect(result[0]).toEqual({ userId: 101, hallId: 1 })
      expect(result[1]).toEqual({ userId: 102, hallId: 2 })
      expect(result[2]).toEqual({ userId: 103, hallId: 3 })
    })
    it("uses modulo wrapping when more staff than halls", () => {
      const result = generateFirstAllocation([101, 102, 103, 104], [1, 2, 3])
      expect(result[3].hallId).toBe(1)
    })
  })

  describe("Multi-session rotation", () => {
    it("Each staff moves +1 hall per session", () => {
      const last = new Map(staff.map((s, i) => [s, halls[i]]))
      const s2 = generateRotation(staff, halls, last)
      expect(s2.get(101)).toBe(2)
      expect(s2.get(102)).toBe(3)
      expect(s2.get(110)).toBe(1) // wraps
    })

    it("No two staff share the same hall in any session", () => {
      const last = new Map(staff.map((s, i) => [s, halls[i]]))
      const s2 = generateRotation(staff, halls, last)
      const assigned = [...s2.values()]
      expect(new Set(assigned).size).toBe(assigned.length)
    })

    it("After N sessions (= hall count), each staff visits all halls exactly once", () => {
      let lastMap = new Map(staff.map((s, i) => [s, halls[i]]))
      const allSessions: Map<number, number>[] = [new Map(staff.map((s, i) => [s, halls[i]]))]
      for (let i = 2; i <= 10; i++) {
        const next = generateRotation(staff, halls, lastMap)
        allSessions.push(next)
        lastMap = next
      }
      const hallsFor101 = allSessions.map(s => s.get(101)!)
      expect(new Set(hallsFor101).size).toBe(10)
      expect([...new Set(hallsFor101)].sort((a, b) => a - b)).toEqual([1,2,3,4,5,6,7,8,9,10])
    })

    it("Session 11 restarts cycle (H010 → H001)", () => {
      let lastMap = new Map(staff.map((s, i) => [s, halls[i]]))
      for (let i = 2; i <= 10; i++) lastMap = generateRotation(staff, halls, lastMap)
      expect(lastMap.get(101)).toBe(10)
      const s11 = generateRotation(staff, halls, lastMap)
      expect(s11.get(101)).toBe(1)
    })

    it("Handles staff whose last hall is no longer in pool", () => {
      const reducedHalls = [1, 2, 3, 4, 5] // hall 6 removed
      const lastMap = new Map([[101, 6]]) // staff 101 was in hall 6 (now gone)
      const result = generateRotation([101], reducedHalls, lastMap)
      // Should assign a valid hall from the current pool
      expect(reducedHalls).toContain(result.get(101))
    })
  })
})

describe("Validation Rules — Pure Logic", () => {
  describe("R1 — Duplicate hall in rotation cycle", () => {
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

  describe("R2 — Hall duplication in session", () => {
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

  describe("R3 — Staff duplication in session", () => {
    it("BLOCKS when same staff appears twice", () => {
      expect(checkR3([{ userId: 101, hallId: 1 }, { userId: 101, hallId: 2 }])).toBe(true)
    })
    it("PASSES when all staff IDs are unique", () => {
      expect(checkR3([{ userId: 101, hallId: 1 }, { userId: 102, hallId: 2 }])).toBe(false)
    })
  })

  describe("R5 — Staff availability", () => {
    it("BLOCKS inactive staff", () => {
      expect(checkR5(false)).toBe(true)
    })
    it("PASSES active staff", () => {
      expect(checkR5(true)).toBe(false)
    })
  })

  describe("R6 — Hall availability", () => {
    it("BLOCKS inactive hall", () => {
      expect(checkR6(false)).toBe(true)
    })
    it("PASSES active hall", () => {
      expect(checkR6(true)).toBe(false)
    })
  })

  describe("R7 — Count match (staff = halls)", () => {
    it("BLOCKS when staff count ≠ hall count", () => {
      expect(checkR7(8, 10)).toBe(true)
      expect(checkR7(12, 10)).toBe(true)
    })
    it("PASSES when counts are equal", () => {
      expect(checkR7(10, 10)).toBe(false)
      expect(checkR7(1, 1)).toBe(false)
    })
  })
})
