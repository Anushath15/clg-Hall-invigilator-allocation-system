/**
 * The seating PDFs: one page per hall that has students (plan), one per class in each hall
 * (attendance), one list for all,
 * built in memory.
 */
import { describe, it, expect } from "vitest"
import { buildSeatingPlanPDF, classSummary, buildAttendanceSheetPDF, buildStudentSeatListPDF, buildUnallocatedListPDF, type SeatRow, type SeatingExportArgs } from "./export-seating-pdf"

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

  it("a hall's benches, legend and class table always fit on one sheet", () => {
    // Big halls, many classes, and class names long enough to wrap in the table.
    for (const [rows, cols, nClasses, name] of [[5, 4, 3, "CSE"], [12, 6, 8, "CSE"], [20, 6, 6, "CSE"], [8, 8, 12, "Computer Science and Engineering (Artificial Intelligence and Machine Learning)"]] as const) {
      const seats: SeatRow[] = []
      for (let r = 1, id = 0; r <= rows; r++) for (let c = 1; c <= cols; c++) for (const side of ["L", "R"] as const) {
        id++
        seats.push({ ...seat(id, 1, "A101", (r - 1) * cols + c, r, c, side, "M", "2023-2027"), category: `${name} ${id % nClasses} – Final Year` })
      }
      const doc = buildSeatingPlanPDF({ ...args, halls: [{ id: 1, hall_code: "A101", bench_rows: rows, bench_cols: cols, disabled_benches: "[]", invigilators: [] }], seats })
      expect(doc.getNumberOfPages(), `${rows}x${cols}, ${nClasses} classes`).toBe(1)
      expect((doc as any).lastAutoTable.finalY).toBeLessThanOrEqual(doc.internal.pageSize.height - 6)
    }
  })

  it("each hall page has a class table: roll number range, who, how many, and a total", () => {
    const hall1 = args.seats.filter(s => s.hallId === 1)
    expect(classSummary(hall1)).toEqual([
      { label: "2023-2027", range: "R1 - R3 (Boys)", count: 2 },
      { label: "2024-2028", range: "R2 (Boys)", count: 1 }
    ])
    const text = buildSeatingPlanPDF(args).output()
    for (const t of ["CLASS", "ROLL NUMBERS SPACE", "TOTAL", "R1 - R3", "Boys"]) expect(text).toContain(t)
    // Every class has its own key; the invigilators are on the attendance sheet, not the plan.
    expect(text).toContain("KEY")
    expect(text).not.toContain("Anitha R")
    expect(buildAttendanceSheetPDF(args).output()).toContain("Anitha R")
  })

  it("attendance sheets: a page per class in each hall; the seat list: every student", () => {
    // A101 and A102 each seat two classes (2023-2027 and 2024-2028): four sheets.
    const sheets = buildAttendanceSheetPDF(args)
    expect(sheets.getNumberOfPages()).toBe(4)
    for (const t of ["Class: 2023-2027", "Class: 2024-2028"]) expect(sheets.output()).toContain(t)
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
