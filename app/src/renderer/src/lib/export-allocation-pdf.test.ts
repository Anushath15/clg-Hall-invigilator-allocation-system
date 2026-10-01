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
})
