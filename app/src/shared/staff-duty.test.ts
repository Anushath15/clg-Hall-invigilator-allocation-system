import { describe, it, expect } from "vitest"
import { splitStaffDuties, type StaffDutyRow } from "./staff-duty"

const duty = (exam_date: string, session_type: "FN" | "AN", status: "confirmed" | "published", hall_code: string): StaffDutyRow => ({
  exam_date, session_type, status, hall_code, reporting_time: "09:30", exam_start: "10:00", exam_end: "13:00",
  hallId: 1, hallName: null, hallBlock: null, hallFloor: null, cycleName: "Nov 2026", academic_year: "2026-27", is_manually_edited: 0
})

describe("Staff Duty page: which duties a staff member sees", () => {
  // Newest first, as getStaffDutyHistory returns them.
  const rows = [
    duty("2026-11-05", "FN", "published", "H5"),
    duty("2026-11-03", "AN", "confirmed", "H4"),
    duty("2026-11-03", "FN", "confirmed", "H3"),
    duty("2026-10-01", "FN", "confirmed", "H1"), // today
    duty("2026-09-20", "AN", "published", "P2"),
    duty("2026-09-10", "FN", "confirmed", "P1"),
  ]
  const { next, upcoming, past } = splitStaffDuties(rows, "2026-10-01")

  it("the next duty is the nearest one (today counts), not the furthest", () => {
    expect(next?.hall_code).toBe("H1")
  })
  it("upcoming duties are soonest first, FN before AN on the same day, confirmed and published alike", () => {
    expect(upcoming.map(d => d.hall_code)).toEqual(["H1", "H3", "H4", "H5"])
  })
  it("past duties are newest first", () => {
    expect(past.map(d => d.hall_code)).toEqual(["P2", "P1"])
  })
  it("with no duties there is no next duty", () => {
    expect(splitStaffDuties([], "2026-10-01").next).toBeUndefined()
  })
})
