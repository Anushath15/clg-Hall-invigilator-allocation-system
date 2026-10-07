/**
 * The Dashboard's "Upcoming Sessions" follows the computer's real date AND time: a session
 * counts until its exam end time has passed, so a morning session is no longer upcoming in the
 * afternoon, and the count rolls over correctly at midnight, month ends and leap days.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getDashboardStats } from "./master.service"

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
const upcoming = (now: Date) => getDashboardStats(now).upcomingSessions

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch', '2027-28')")
  const sessions: [string, string, string | null][] = [
    ["2026-10-07", "FN", "12:30"], ["2026-10-07", "AN", "17:00"],   // today in the first cases
    ["2026-10-08", "FN", "12:30"], ["2026-10-08", "AN", "17:00"],
    ["2026-10-09", "AN", "17:00"], ["2026-10-06", "AN", "17:00"],   // yesterday
    ["2028-02-29", "FN", "12:30"], ["2028-03-01", "FN", null],      // leap day, and a session with no end time
  ]
  sessions.forEach(([date, type, end], i) => db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, exam_end, status) VALUES(?,1,?,?,?,?,'pending')", [i + 1, date, type, i + 1, end]))
})

describe("Upcoming sessions follow the real clock", () => {
  it("counts a session today until its exam end time, then drops it", () => {
    // 7 Oct 2026: FN ends 12:30, AN ends 17:00; later sessions: 8 Oct x2, 9 Oct, plus the 2028 ones (2).
    const later = 3 + 2
    expect(upcoming(at(2026, 10, 7, 8, 0))).toBe(2 + later)    // early morning: both of today's sessions
    expect(upcoming(at(2026, 10, 7, 12, 29))).toBe(2 + later)
    expect(upcoming(at(2026, 10, 7, 12, 30))).toBe(1 + later)   // FN has just ended (the count is for sessions not yet finished)
    expect(upcoming(at(2026, 10, 7, 15, 53))).toBe(1 + later)   // the time in your screenshot: only AN is left today
    expect(upcoming(at(2026, 10, 7, 16, 59))).toBe(1 + later)
    expect(upcoming(at(2026, 10, 7, 17, 0))).toBe(later)        // AN has ended
    expect(upcoming(at(2026, 10, 7, 23, 59))).toBe(later)
  })

  it("rolls over at midnight and never counts a day that has passed", () => {
    expect(upcoming(at(2026, 10, 8, 0, 0))).toBe(2 + 1 + 2)     // 8 Oct x2, 9 Oct, 2028 x2
    expect(upcoming(at(2026, 10, 9, 17, 0))).toBe(2)            // 9 Oct's AN has ended; only the 2028 sessions remain
    expect(upcoming(at(2026, 10, 10, 0, 0))).toBe(2)
    expect(upcoming(at(2026, 10, 6, 6, 0))).toBe(1 + 2 + 3 + 2) // the day before: 6 Oct's AN too
  })

  it("leap day 2028 and a session with no end time (counted for the whole day)", () => {
    expect(upcoming(at(2028, 2, 29, 9, 0))).toBe(2)             // FN 29 Feb (ends 12:30) + 1 Mar (no end time)
    expect(upcoming(at(2028, 2, 29, 12, 30))).toBe(1)
    expect(upcoming(at(2028, 2, 29, 23, 59))).toBe(1)
    expect(upcoming(at(2028, 3, 1, 0, 0))).toBe(1)
    expect(upcoming(at(2028, 3, 1, 23, 59))).toBe(1)            // no end time: still upcoming until the day is over
    expect(upcoming(at(2028, 3, 2, 0, 0))).toBe(0)
  })

  it("the other Dashboard numbers are unchanged by the clock", () => {
    const a = getDashboardStats(at(2026, 10, 7, 8, 0)), b = getDashboardStats(at(2030, 1, 1, 0, 0))
    expect({ ...a, upcomingSessions: 0 }).toEqual({ ...b, upcomingSessions: 0 })
    expect(a.totalCycles).toBe(1)
    expect(a.pendingAllocations).toBe(8)
  })
})
