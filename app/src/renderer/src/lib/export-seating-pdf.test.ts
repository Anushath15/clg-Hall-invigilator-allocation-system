/**
 * The seating PDFs: one page per hall that has students (plan and attendance), one list for all,
 * built in memory.
 */
import { describe, it, expect } from "vitest"
import { buildSeatingPlanPDF, buildAttendanceSheetPDF, buildStudentSeatListPDF, buildUnallocatedListPDF, type SeatRow, type SeatingExportArgs } from "./export-seating-pdf"

function seat(id: number, hallId: number, hall_code: string, benchNo: number, row: number, col: number, side: "L" | "R", gender: "M" | "F", batch: string): SeatRow {
  return { studentId: id, roll_no: `R${id}`, register_no: `REG${id}`, studentName: `Student ${id}`, gender, batch, deptCode: "CSE",
    hallId, hall_code, bench_row: row, bench_col: col, bench_no: benchNo, seat: side }
}

const args: SeatingExportArgs = {
  cycle: { name: "November 2026", academic_year: "2026-27" },
  session: { exam_date: "2026-11-02", session_type: "FN", exam_start: "10:00", exam_end: "13:00" },
  halls: [
    { id: 1, hall_code: "A101", block: "Main", floor: "1st", bench_rows: 2, bench_cols: 2, disabled_benches: '["2-2"]', invigilators: ["Anitha R"] },
    { id: 2, hall_code: "A102", bench_rows: 1, bench_cols: 2, disabled_benches: "[]", invigilators: ["Bala S"] },
    { id: 3, hall_code: "A103", bench_rows: 1, bench_cols: 1, disabled_benches: "[]", invigilators: ["Chitra"] } // no students
  ],
  seats: [
    seat(1, 1, "A101", 1, 1, 1, "L", "M", "2023-2027"), seat(2, 1, "A101", 1, 1, 1, "R", "M", "2024-2028"),
    seat(3, 1, "A101", 2, 2, 1, "L", "M", "2023-2027"),
    seat(4, 2, "A102", 1, 1, 1, "L", "F", "2023-2027"), seat(5, 2, "A102", 1, 1, 1, "R", "F", "2024-2028")
  ],
  settings: { "college.name": "Test College" }
}

describe("Seating PDFs", () => {
  it("the seating plan has a page per hall with students", () => {
    const doc = buildSeatingPlanPDF(args)
    expect(Buffer.from(doc.output("arraybuffer")).subarray(0, 5).toString()).toBe("%PDF-")
    expect(doc.getNumberOfPages()).toBe(2)
    const text = doc.output()
    // Laid out like the screen: column headings, row labels, bench cards with their roll numbers.
    for (const t of ["FRONT", "Column 1", "Column 2", "R1", "R2", "Bench 1", "Bench 2"]) expect(text).toContain(t)
  })

  it("attendance sheets: a page per hall; the seat list: every student", () => {
    expect(buildAttendanceSheetPDF(args).getNumberOfPages()).toBe(2)
    const list = buildStudentSeatListPDF(args).output()
    for (const r of ["R1", "R5", "A102"]) expect(list).toContain(r)
  })

  it("the unallocated list names every student left without a seat, with the reason", () => {
    const doc = buildUnallocatedListPDF(args, [
      { roll_no: "R9", name: "Student 9", gender: "M", category: "CSE – Final Year (2022-2026)", reason: "Insufficient hall capacity" }
    ])
    const text = doc.output()
    for (const r of ["Unallocated Students", "R9", "Insufficient hall capacity"]) expect(text).toContain(r)
  })
})
