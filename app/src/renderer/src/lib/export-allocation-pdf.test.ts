/**
 * The session allocation PDF is built locally: with every network API disabled it still
 * produces a complete PDF containing the allocation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import http from "http"
import https from "https"
import net from "net"
import { buildAllocationPDF } from "./export-allocation-pdf"

const attempts: string[] = []
const restores: (() => void)[] = []
function tripwire(obj: any, key: string, label: string) {
  if (!(key in obj)) return
  const original = obj[key]
  obj[key] = () => { attempts.push(label); throw new Error(`Network use is not allowed offline: ${label}`) }
  restores.push(() => { obj[key] = original })
}
beforeAll(() => {
  tripwire(http, "request", "http.request"); tripwire(http, "get", "http.get")
  tripwire(https, "request", "https.request"); tripwire(https, "get", "https.get")
  tripwire(net, "connect", "net.connect")
  for (const g of ["fetch", "XMLHttpRequest", "WebSocket"]) tripwire(globalThis, g, g)
})
afterAll(() => restores.forEach(r => r()))

describe("Session allocation PDF", () => {
  it("is generated without the network", () => {
    const doc = buildAllocationPDF({
      cycle: { name: "November 2026 End Semester Examinations", academic_year: "2026-27" },
      session: { exam_date: "2026-11-02", session_type: "FN", reporting_time: "09:30", exam_start: "10:00", exam_end: "13:00" },
      allocation: [
        { staff_id: "STF001", userName: "Anitha R", deptCode: "cse", hall_code: "H001", hallBlock: "Main Block", hallFloor: "1st" },
        { staff_id: "STF002", userName: "Bala S", deptCode: "ECE", hall_code: "H002", hallBlock: null, hallFloor: null },
      ],
      settings: { "college.name": "Test College", "college.short_name": "TC" },
    })
    const pdf = Buffer.from(doc.output("arraybuffer"))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(doc.getNumberOfPages()).toBe(1)
    const text = pdf.toString("latin1")
    for (const s of ["Test College", "Anitha R", "H002", "Total invigilators: 2"]) expect(text).toContain(s)
    expect(attempts).toEqual([])
  })

  const args = (rows: number) => ({
    cycle: { name: "internals", academic_year: "2026-2027" },
    session: { exam_date: "2026-10-01", session_type: "FN" as const, reporting_time: "09:30", exam_start: "10:00", exam_end: "13:00" },
    allocation: Array.from({ length: rows }, (_, i) => ({ staff_id: `STF${String(i + 1).padStart(3, "0")}`, userName: `Invigilator ${i + 1}`, deptCode: "CSE", hall_code: `H${100 + i}`, hallBlock: "Main Block", hallFloor: "1st" })),
  })
  const mediaBoxes = (doc: any) => [...Buffer.from(doc.output("arraybuffer")).toString("latin1").matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])])

  it("is portrait A4, and has Adjusted By and Staff Signature columns that are left blank for writing", () => {
    const doc = buildAllocationPDF(args(3))
    const pdf = Buffer.from(doc.output("arraybuffer")).toString("latin1")
    for (const [w, h] of mediaBoxes(doc)) { expect(h).toBeGreaterThan(w); expect(Math.round(w)).toBe(595); expect(Math.round(h)).toBe(842) } // A4 portrait, never landscape
    expect(mediaBoxes(doc).length).toBe(1)
    for (const header of ["Adjusted By", "Staff Signature", "Staff ID", "Location"]) expect(pdf).toContain(header)
    // The two writing columns hold nothing: no text is drawn for them in the body rows.
    const table = (doc as any).lastAutoTable
    expect(table.columns.length).toBe(8)
    for (const row of table.body) { expect(row.cells[6].text.join("")).toBe(""); expect(row.cells[7].text.join("")).toBe("") }
    // They are the widest columns: most of the page is left for writing.
    const w = table.columns.map((c: any) => c.width)
    expect(w[6] + w[7]).toBeGreaterThan(table.columns.slice(0, 6).reduce((a: number, c: any) => a + c.width, 0) * 0.7)
    expect(w[6]).toBeGreaterThanOrEqual(Math.max(...w.slice(0, 6)))
    expect(w[7]).toBeGreaterThanOrEqual(Math.max(...w.slice(0, 6)))
    // Each row is tall enough to write in (jsPDF measures in mm): at least 15 mm.
    for (const row of table.body) expect(row.height).toBeGreaterThanOrEqual(15)
    // The table stays inside the page margins.
    expect(w.reduce((a: number, c: number) => a + c, 0)).toBeLessThanOrEqual(doc.internal.pageSize.getWidth() - 28 + 0.01) // 14 mm margins
  })

  it("a long list runs onto further portrait pages with the headings repeated", () => {
    const doc = buildAllocationPDF(args(40))
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
    for (const [w, h] of mediaBoxes(doc)) expect(h).toBeGreaterThan(w)
    const pdf = Buffer.from(doc.output("arraybuffer")).toString("latin1")
    expect((pdf.match(/Staff Signature/g) ?? []).length).toBe(doc.getNumberOfPages())
    expect(pdf).toContain("Invigilator 40")
    expect(pdf).toContain("Total invigilators: 40")
  })

  it("prints dark: black text, dark table rules and dark header band (no pale greys that fade on a printer)", () => {
    const stream = Buffer.from(buildAllocationPDF(args(3)).output("arraybuffer")).toString("latin1")
    const greys = [...stream.matchAll(/(?:^|\s)([\d.]+) [gG](?=\s)/g)].map(m => Number(m[1]))
    expect(greys.length).toBeGreaterThan(0)
    for (const g of greys) expect(g <= 0.3 || g >= 0.99, `grey level ${g} is too pale to print well`).toBe(true)
    const bands = [...stream.matchAll(/(?:^|\s)([\d.]+) ([\d.]+) ([\d.]+) rg(?=\s)/g)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])])
    expect(bands.length).toBeGreaterThan(0)
    for (const [r, g, b] of bands) expect(0.2126 * r + 0.7152 * g + 0.0722 * b, `fill ${r} ${g} ${b}`).toBeLessThan(0.45) // dark enough for white lettering
  })

  it("prints the college name and short name saved in Settings, not the built-in default", () => {
    const text = Buffer.from(buildAllocationPDF({ ...args(2), settings: { "college.name": "abc school", "college.short_name": "abc" } }).output("arraybuffer")).toString("latin1")
    expect(text).toContain("abc school")
    expect(text).toContain("· abc")
    expect(text).not.toContain("Xavier")
  })
})
