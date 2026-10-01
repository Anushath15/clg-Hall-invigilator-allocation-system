/**
 * QA-15: the duty slip is rendered with React, so values are HTML-escaped. A staff name with
 * an apostrophe, an ampersand or markup is shown exactly as typed and never becomes HTML.
 */
import { it, expect } from "vitest"
import { dutySlipHtml } from "./duty-slip"
import type { StaffDutyRow } from "../../../shared/staff-duty"

const NAME = `O'Brien <img src=x onerror="alert(1)"> & Sons`
const duty: StaffDutyRow = {
  exam_date: "2099-11-02", session_type: "FN", status: "confirmed",
  reporting_time: "09:15", exam_start: "09:30", exam_end: "12:30",
  hallId: 1, hall_code: "H<1>", hallName: "H1", hallBlock: "Main & Annexe", hallFloor: "1st",
  cycleName: `Nov "Final" <b>Batch</b>`, academic_year: "2026-27", is_manually_edited: 0,
}
const html = dutySlipHtml({
  collegeName: "St. Xavier's College & <i>Co</i>", shortName: "SX<C>", staffName: NAME, staffId: "S&1<2>", duty, generatedAt: "now",
})
// What a browser shows for escaped text.
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
const cell = (label: string) => decode(html.match(new RegExp(`<td>${label}</td><td>(.*?)</td>`))![1])

it("a name with an apostrophe, an ampersand and markup is escaped, not turned into HTML", () => {
  expect(html).toContain("O&#x27;Brien &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Sons")
  // Only the slip's own elements exist; nothing from the data became a tag or an attribute.
  const tags = new Set([...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map(m => m[1].toLowerCase()))
  expect([...tags].sort()).toEqual(["body", "div", "h1", "head", "html", "meta", "p", "style", "table", "tbody", "td", "title", "tr"])
  expect(html).not.toMatch(/<[^>]*onerror/i)
})

it("every value is shown exactly as typed", () => {
  expect(cell("Staff Name")).toBe(NAME)
  expect(cell("Staff ID")).toBe("S&1<2>")
  expect(cell("Allocation Batch")).toBe(`Nov "Final" <b>Batch</b>`)
  expect(decode(html.match(/<div class="hall-box">(.*?)<\/div>/)![1])).toBe("H<1>")
  expect(decode(html.match(/<p class="location">(.*?)<\/p>/)![1])).toBe("Main & Annexe · 1st floor")
  expect(decode(html.match(/<h1>(.*?)<\/h1>/)![1])).toBe("St. Xavier's College & <i>Co</i>")
  expect(decode(html.match(/<title>(.*?)<\/title>/)![1])).toBe("Duty Slip — HIAS SX<C>")
  expect(cell("Exam Time")).toBe("09:30 AM – 12:30 PM")
})

it("without an upcoming duty the slip says so", () => {
  const empty = dutySlipHtml({ collegeName: "College", shortName: "C", staffName: NAME, staffId: "S1", duty: null, generatedAt: "now" })
  expect(empty).toContain("No upcoming duty assigned.")
  expect(empty).not.toContain("<img")
})
