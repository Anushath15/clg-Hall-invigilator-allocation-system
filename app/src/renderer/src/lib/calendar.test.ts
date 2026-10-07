/**
 * The calendar must be right for every year and on every computer: leap years, century years,
 * week layout and "today", whatever time zone Windows is set to (including daylight saving).
 * Each month from 1900 to 2400 is checked against date arithmetic done independently, in UTC.
 */
import { describe, it, expect, afterAll } from "vitest"
import { monthGrid } from "../../../shared/calendar"
import { todayLocal, timeNowLocal, isPastDate } from "../../../shared/session-dates"
import { isSundayDate } from "./holidays"

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const daysIn = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]
const utcDay = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) // calendar day number, independent of the zone
const ZONES = ["Asia/Kolkata", "UTC", "America/Los_Angeles", "Europe/London", "Pacific/Auckland"] // IST, UTC, and zones with daylight saving
const originalTz = process.env.TZ
afterAll(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz })

describe.each(ZONES)("calendar in %s", zone => {
  it("every month of 1900-2400: whole Sunday-to-Saturday weeks, every day once, leap years right", () => {
    process.env.TZ = zone
    for (let y = 1900; y <= 2400; y++) {
      for (let m = 0; m < 12; m++) {
        const grid = monthGrid(new Date(y, m, 15))
        expect(grid.length % 7).toBe(0)
        expect(grid[0].getDay()).toBe(0)                    // starts on a Sunday
        expect(grid[grid.length - 1].getDay()).toBe(6)      // ends on a Saturday
        for (let i = 1; i < grid.length; i++) if (utcDay(grid[i]) - utcDay(grid[i - 1]) !== 1) throw new Error(`${y}-${m + 1}: day ${i} is not the day after the previous one`)
        const inMonth = grid.filter(d => d.getMonth() === m && d.getFullYear() === y)
        if (inMonth.length !== daysIn(y, m)) throw new Error(`${y}-${m + 1} shows ${inMonth.length} days, expected ${daysIn(y, m)}`)
        expect(inMonth[0].getDate()).toBe(1)
        const col = grid.indexOf(inMonth[0]) % 7            // the 1st sits under the right weekday
        if (col !== new Date(Date.UTC(y, m, 1)).getUTCDay()) throw new Error(`${y}-${m + 1}: the 1st is under the wrong weekday`)
      }
    }
  })

  it("Sundays are exactly the Sundays of the real calendar in every year", () => {
    process.env.TZ = zone
    for (let y = 1900; y <= 2400; y += 1) {
      let sundays = 0, expected = 0
      for (let d = new Date(y, 0, 1); d.getFullYear() === y; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        if (isSundayDate(d)) sundays++
        if (new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).getUTCDay() === 0) expected++
      }
      if (sundays !== expected) throw new Error(`${y}: ${sundays} Sundays, expected ${expected}`)
      expect(sundays === 52 || sundays === 53).toBe(true)
    }
  })

  it("today's date and time are the computer's local ones, also late at night and on leap days", () => {
    process.env.TZ = zone
    expect(todayLocal(new Date(2028, 1, 29, 23, 59))).toBe("2028-02-29")
    expect(todayLocal(new Date(2028, 2, 1, 0, 0))).toBe("2028-03-01")
    expect(todayLocal(new Date(2100, 1, 28, 23, 59))).toBe("2100-02-28")  // 2100 is not a leap year
    expect(todayLocal(new Date(2100, 2, 1, 0, 0))).toBe("2100-03-01")
    expect(todayLocal(new Date(2400, 1, 29, 12, 0))).toBe("2400-02-29")   // 2400 is
    expect(todayLocal(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31")
    expect(todayLocal(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01")
    expect(timeNowLocal(new Date(2026, 9, 7, 15, 53))).toBe("15:53")
    expect(timeNowLocal(new Date(2026, 9, 7, 0, 5))).toBe("00:05")
    expect(timeNowLocal(new Date(2026, 9, 7, 23, 59))).toBe("23:59")
    // Days on which clocks change (US spring forward / autumn back, NZ, UK): the date is still the local date.
    for (const [y, m, d] of [[2026, 2, 8], [2026, 10, 1], [2026, 2, 29], [2026, 9, 25], [2026, 8, 27], [2026, 3, 5]]) {
      for (const h of [0, 1, 2, 3, 12, 23]) expect(todayLocal(new Date(y, m, d, h, 30)).endsWith(String(d).padStart(2, "0")), `${y}-${m + 1}-${d} ${h}:30`).toBe(true)
    }
  })
})

describe("known dates", () => {
  it("weekdays and the past/present rule", () => {
    expect(new Date(2000, 0, 1).getDay()).toBe(6)   // 1 Jan 2000 was a Saturday
    expect(new Date(2028, 1, 29).getDay()).toBe(2)  // 29 Feb 2028 is a Tuesday
    expect(new Date(2026, 9, 2).getDay()).toBe(5)   // 2 Oct 2026 is a Friday
    expect(new Date(2026, 9, 4).getDay()).toBe(0)   // 4 Oct 2026 is a Sunday
    expect(isPastDate("2028-02-28", "2028-02-29")).toBe(true)
    expect(isPastDate("2028-02-29", "2028-02-29")).toBe(false)
    expect(isPastDate("2028-03-01", "2028-02-29")).toBe(false)
    expect(isPastDate("2026-12-31", "2027-01-01")).toBe(true)
  })
})
