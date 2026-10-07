/** Sundays are the only holiday, in every year; there is no public-holiday data. */
import { it, expect } from "vitest"
import { getHoliday, isSundayDate, getExamDateStatus, TN_HOLIDAYS } from "./holidays"

it("no public-holiday data is kept, so no date is labelled a holiday", () => {
  expect(Object.keys(TN_HOLIDAYS)).toEqual([])
  for (const d of ["2026-10-02", "2026-12-25", "2027-01-26", "2031-08-15"]) expect(getHoliday(d)).toBeNull()
})

it("every Sunday is a holiday and not an exam day, in any year", () => {
  for (const [iso, y, m, d] of [["2026-10-04", 2026, 9, 4], ["2031-03-02", 2031, 2, 2], ["2099-12-27", 2099, 11, 27], ["1999-01-03", 1999, 0, 3]] as const) {
    const day = new Date(y, m, d)
    expect(isSundayDate(day)).toBe(true)
    expect(getExamDateStatus(iso, day)).toMatchObject({ isSunday: true, isExamDay: false })
  }
})

it("every other day, including former public holidays, is an exam day", () => {
  for (const [iso, y, m, d] of [["2026-10-02", 2026, 9, 2], ["2026-12-25", 2026, 11, 25], ["2027-01-26", 2027, 0, 26], ["2031-03-03", 2031, 2, 3]] as const) {
    expect(getExamDateStatus(iso, new Date(y, m, d))).toMatchObject({ isSunday: false, isHoliday: false, isExamDay: true })
  }
})
