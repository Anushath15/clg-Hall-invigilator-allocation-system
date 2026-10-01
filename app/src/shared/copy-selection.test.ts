/**
 * Copy selection from a previous session (shared/copy-selection.ts): which session "previous"
 * means, how the picker is grouped, and that a copy is staff and hall IDs only, limited to
 * active staff and halls.
 */
import { describe, it, expect } from "vitest"
import { previousSelectionSource, selectionSourceGroups, selectionFromAllocation, type SelectionSource } from "./copy-selection"

const src = (id: number, cycleId: number, exam_date: string, session_type: string, status = "confirmed"): SelectionSource =>
  ({ id, cycleId, cycleName: `Batch ${cycleId}`, exam_date, session_type, status, staffCount: 4 })
const sources = [
  src(1, 1, "2099-11-02", "FN"), src(2, 1, "2099-11-02", "AN"), src(3, 1, "2099-11-03", "FN"),
  src(10, 2, "2099-12-01", "FN"), src(11, 2, "2099-12-01", "AN", "draft"),
]
const at = (id: number, cycle_id: number, exam_date: string, session_type: string, status = "pending") => ({ id, cycle_id, exam_date, session_type, status })

describe("Copy from previous session: which session", () => {
  it("the nearest earlier session of the same batch, Forenoon before Afternoon on the same day", () => {
    expect(previousSelectionSource(sources, at(4, 1, "2099-11-04", "FN"))?.id).toBe(3)
    expect(previousSelectionSource(sources, at(5, 1, "2099-11-03", "AN"))?.id).toBe(3)
    expect(previousSelectionSource(sources, at(3, 1, "2099-11-03", "FN"))?.id).toBe(2) // not itself
    expect(previousSelectionSource(sources, at(2, 1, "2099-11-02", "AN"))?.id).toBe(1) // same day, FN is earlier
  })
  it("falls back to the latest earlier session of any batch when the batch has none (cross-batch)", () => {
    expect(previousSelectionSource(sources, at(10, 2, "2099-12-01", "FN"))?.id).toBe(3)
    // Interleaved batches: batch 1's own previous session (3 Nov) wins over batch 2's later ones (1 Dec).
    expect(previousSelectionSource(sources, at(6, 1, "2099-12-05", "FN"))?.id).toBe(3)
    expect(previousSelectionSource(sources, at(12, 2, "2099-12-02", "FN"))?.id).toBe(11)
  })
  it("never a later session; nothing when no session is earlier", () => {
    expect(previousSelectionSource(sources, at(9, 1, "2099-11-01", "AN"))).toBeNull()
  })
})

describe("Copy from a session: the picker", () => {
  it("this session's own draft first, then this batch, then other batches, newest first", () => {
    const g = selectionSourceGroups(sources, at(11, 2, "2099-12-01", "AN", "draft"))
    expect(g.draft?.id).toBe(11)
    expect(g.batches.map(b => [b.cycleId, b.sessions.map(s => s.id)])).toEqual([[2, [10]], [1, [3, 2, 1]]])
  })
  it("offers no current draft for a pending session", () => {
    expect(selectionSourceGroups(sources, at(4, 1, "2099-11-04", "FN", "pending")).draft).toBeNull()
  })
})

describe("Copy from a session: what is copied", () => {
  const rows = [{ userId: 104, hallId: 1 }, { userId: 101, hallId: 3 }, { userId: 103, hallId: 4 }, { userId: 102, hallId: 2 }]
  it("staff IDs and hall IDs only, as two independent sorted lists (no pairings)", () => {
    const sel = selectionFromAllocation(rows, [101, 102, 103, 104], [1, 2, 3, 4])
    expect(sel).toEqual({ userIds: [101, 102, 103, 104], hallIds: [1, 2, 3, 4], inactiveStaff: 0, inactiveHalls: 0 })
  })
  it("leaves out staff and halls that are no longer active, and counts them", () => {
    const sel = selectionFromAllocation(rows, [101, 102, 103], [1, 2, 3])
    expect(sel).toEqual({ userIds: [101, 102, 103], hallIds: [1, 2, 3], inactiveStaff: 1, inactiveHalls: 1 })
  })
})
