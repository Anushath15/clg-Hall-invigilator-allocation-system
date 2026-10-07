/**
 * Sessions cannot be created on, or moved to, a day that has passed (today is allowed). Changing
 * only the times of a session that keeps its date still works, so an older record can be fixed.
 * Dates are computed from today so these tests never go stale.
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { createSessions, addSession, updateSession } from "./allocation.service"
import { isPastDate, todayLocal, PAST_DATE_MESSAGE } from "../../shared/session-dates"

const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return todayLocal(d) }
const t = { reporting_time: "09:15", exam_start: "09:30", exam_end: "12:30" }
const sessionDate = (id: number) => db.queryOne<any>("SELECT exam_date FROM exam_sessions WHERE id=?", [id])?.exam_date
const count = () => db.queryOne<any>("SELECT COUNT(*) as c FROM exam_sessions")?.c

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'Batch', '2026-27')")
})

describe("Past dates", () => {
  it("the rule: before today is past; today and later are not", () => {
    expect(isPastDate("2023-07-05", "2026-10-07")).toBe(true)
    expect(isPastDate("2026-10-06", "2026-10-07")).toBe(true)
    expect(isPastDate("2026-10-07", "2026-10-07")).toBe(false)
    expect(isPastDate("2026-10-08", "2026-10-07")).toBe(false)
    expect(todayLocal(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07") // local date, not UTC
  })

  it("Add Session refuses a past date, accepts today and later", () => {
    expect(() => addSession(1, { exam_date: day(-1), session_type: "FN", ...t })).toThrow(PAST_DATE_MESSAGE)
    expect(() => addSession(1, { exam_date: "2023-07-05", session_type: "AN", ...t })).toThrow(PAST_DATE_MESSAGE)
    expect(count()).toBe(0)
    expect(addSession(1, { exam_date: day(0), session_type: "FN", ...t })).toMatchObject({ exam_date: day(0) })
    expect(addSession(1, { exam_date: day(3), session_type: "FN", ...t })).toMatchObject({ exam_date: day(3) })
  })

  it("the batch wizard refuses a list that contains a past date, and saves nothing", async () => {
    const before = count()
    await expect(createSessions(1, [{ exam_date: day(5), session_type: "FN", ...t }, { exam_date: day(-2), session_type: "AN", ...t }])).rejects.toThrow(PAST_DATE_MESSAGE)
    expect(count()).toBe(before)
    await expect(createSessions(1, [{ exam_date: day(5), session_type: "FN", ...t }])).resolves.toBeTruthy()
  })

  it("Reschedule refuses a move to a past date; a time-only change of an older session still works", () => {
    const future = addSession(1, { exam_date: day(9), session_type: "AN", ...t })!.id // (the wizard step above replaced the earlier ones)
    expect(() => updateSession(future, { exam_date: day(-1) })).toThrow(PAST_DATE_MESSAGE)
    expect(sessionDate(future)).toBe(day(9))
    expect(updateSession(future, { exam_date: day(10) })).toMatchObject({ exam_date: day(10) })
    // An older record (created before this rule, here inserted directly) keeps its date and can have its times corrected.
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(90, 1, '2023-07-05', 'AN', 90, 'confirmed')")
    expect(updateSession(90, { reporting_time: "13:45", exam_start: "14:05", exam_end: "17:05" })).toMatchObject({ exam_date: "2023-07-05", exam_start: "14:05" })
    expect(updateSession(90, { exam_end: "17:10" })).toMatchObject({ exam_end: "17:10" })
    expect(() => updateSession(90, { exam_date: "2023-07-06" })).toThrow(PAST_DATE_MESSAGE) // a different past day is still refused
  })
})
