/**
 * Student seating PDFs for one session. Pure functions like export-allocation-pdf.ts: they take
 * data already loaded and build the document in memory (no database writes, no network).
 *
 *  - Seating plan: one landscape page per hall, the bench grid as seen from the front, each bench
 *    showing its number and the roll numbers on its left and right seats.
 *  - Attendance sheet: one page per hall, a row per student in bench order, with a signature column.
 *  - Student seat list: every student by batch and roll number with hall, bench and seat, for the
 *    notice board.
 *  - Unallocated students: those the seating rules left without a seat, with the reason.
 */
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { INK, INK_NOTE, RULE, HEAD_GREEN } from "./pdf-ink"
import { formatDateWithDay, formatSession, formatTime12h, hallLocation } from "./utils"
import { hallLayout, benchKey, enabledBenches } from "../../../shared/hall-layout"

export interface SeatRow {
  studentId: number; roll_no: string; register_no: string; studentName: string; gender: "M" | "F"; batch: string
  deptCode?: string | null; hallId: number; hall_code: string; bench_row: number; bench_col: number; bench_no: number; seat: "L" | "R"
  /** Academic year ("Final Year") and category ("CSE – Final Year"), from the session's exam cycle. */
  year?: string; category?: string
}
/** A student left without a seat (shared/seating.ts UnallocatedStudent). */
export interface UnallocatedRow { roll_no: string; name?: string; gender: "M" | "F"; category: string; reason: string }
export interface SeatingHallInfo {
  id: number; hall_code: string; block?: string | null; floor?: string | null
  bench_rows?: number; bench_cols?: number; disabled_benches?: unknown
  invigilators: string[]
}
export interface SeatingExportArgs {
  cycle: { name?: string; academic_year?: string } | null
  session: { exam_date: string; session_type: "FN" | "AN"; reporting_time?: string | null; exam_start?: string | null; exam_end?: string | null }
  halls: SeatingHallInfo[]
  seats: SeatRow[]
  settings?: Record<string, string>
}

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
export const seatLabel = (seat: "L" | "R") => (seat === "L" ? "Left" : "Right")
export const groupLabel = (gender: "M" | "F" | null | undefined) => (gender === "M" ? "Boys" : gender === "F" ? "Girls" : "—")

/** College name, title and session line at the top of a page; returns the y below it. */
function header(doc: jsPDF, title: string, { cycle, session, settings = {} }: SeatingExportArgs): number {
  const w = doc.internal.pageSize.width
  doc.setTextColor(INK)
  doc.setFontSize(13); doc.setFont("helvetica", "bold")
  doc.text(settings["college.name"] ?? "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil", w / 2, 12, { align: "center" })
  doc.setFontSize(10.5); doc.setFont("helvetica", "normal")
  doc.text(`${title}${cycle?.name ? ` — ${cycle.name}` : ""}${cycle?.academic_year ? ` (${cycle.academic_year})` : ""}`, w / 2, 18, { align: "center" })
  doc.setFontSize(9)
  const times = session.exam_start && session.exam_end ? [`Exam: ${formatTime12h(session.exam_start)}–${formatTime12h(session.exam_end)}`] : []
  doc.text([formatDateWithDay(session.exam_date), formatSession(session.session_type), ...times].join(" · "), w / 2, 23.5, { align: "center" })
  return 28
}

function hallLine(doc: jsPDF, y: number, hall: SeatingHallInfo, seats: SeatRow[]) {
  const gender = seats[0]?.gender
  doc.setFontSize(11); doc.setFont("helvetica", "bold")
  const title = `Hall ${hall.hall_code}`
  doc.text(title, 14, y + 5)
  const titleWidth = doc.getTextWidth(title)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  const parts = [hallLocation(hall), groupLabel(gender), `${seats.length} students`, hall.invigilators.length ? `Invigilator: ${hall.invigilators.join(", ")}` : ""].filter(Boolean)
  doc.text(parts.join("  ·  "), 14 + titleWidth + 4, y + 5)
  return y + 9
}

/** Students per category in a hall: "CSE – Final Year: 10 · IT – Third Year: 10". */
function categorySummary(seats: SeatRow[]): string {
  const counts = new Map<string, number>()
  for (const s of seats) counts.set(s.category || s.batch, (counts.get(s.category || s.batch) ?? 0) + 1)
  return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([b, n]) => `${b}: ${n}`).join("   ·   ")
}

const hallsWithSeats = (args: SeatingExportArgs) => args.halls
  .map(h => ({ hall: h, seats: args.seats.filter(s => s.hallId === h.id) }))
  .filter(x => x.seats.length > 0)

/** One landscape page per hall: the bench grid, front at the top. */
export function buildSeatingPlanPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageW = doc.internal.pageSize.width
  hallsWithSeats(args).forEach(({ hall, seats }, i) => {
    if (i > 0) doc.addPage()
    let y = hallLine(doc, header(doc, "Student Seating Plan", args), hall, seats)
    const layout = hallLayout(hall)
    const numbers = new Map(enabledBenches(layout).map(b => [benchKey(b.row, b.col), b.benchNo]))
    const at = new Map<string, { L?: SeatRow; R?: SeatRow }>()
    for (const s of seats) {
      const k = benchKey(s.bench_row, s.bench_col)
      at.set(k, { ...at.get(k), [s.seat]: s })
    }
    doc.setFillColor(70, 70, 70); doc.rect(14, y, pageW - 28, 5, "F")
    doc.setTextColor(255); doc.setFontSize(8); doc.setFont("helvetica", "bold")
    doc.text("FRONT  ·  BOARD", pageW / 2, y + 3.6, { align: "center" })
    doc.setTextColor(INK); doc.setFont("helvetica", "normal")
    y += 6

    const body = Array.from({ length: layout.rows }, (_, r) => [
      `Row ${r + 1}`,
      ...Array.from({ length: layout.cols }, (_, c) => {
        const k = benchKey(r + 1, c + 1)
        const n = numbers.get(k)
        if (n === undefined) return ""
        const b = at.get(k)
        return `B${n}\n${b?.L?.roll_no ?? "—"}\n${b?.R?.roll_no ?? "—"}`
      })
    ])
    const cellW = (pageW - 28 - 14) / Math.max(1, layout.cols)
    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      head: [["", ...Array.from({ length: layout.cols }, (_, c) => `Column ${c + 1}`)]],
      body,
      theme: "grid",
      tableLineColor: RULE, tableLineWidth: 0.25,
      styles: { fontSize: layout.cols > 7 ? 6.5 : 7.5, cellPadding: 1.2, textColor: INK, lineColor: RULE, lineWidth: 0.25, halign: "center", valign: "middle" },
      headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
      columnStyles: Object.fromEntries([[0, { cellWidth: 14, fontStyle: "bold" }], ...Array.from({ length: layout.cols }, (_, c) => [c + 1, { cellWidth: cellW }])]),
      didParseCell: d => {
        if (d.section === "body" && d.column.index > 0 && numbers.get(benchKey(d.row.index + 1, d.column.index)) === undefined) d.cell.styles.fillColor = [225, 225, 225]
      }
    })
    const finalY = (doc as any).lastAutoTable?.finalY ?? y
    doc.setFontSize(8); doc.setTextColor(INK_NOTE)
    doc.text(`Each bench: number, then the LEFT seat and the RIGHT seat (as seen from the front). Shaded: no bench.   ${categorySummary(seats)}`, 14, finalY + 6)
    doc.setTextColor(INK)
  })
  return doc
}

/** One page per hall: the students in bench order, with a column to sign. */
export function buildAttendanceSheetPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "portrait" })
  hallsWithSeats(args).forEach(({ hall, seats }, i) => {
    if (i > 0) doc.addPage()
    const y = hallLine(doc, header(doc, "Hall Attendance Sheet", args), hall, seats)
    const sorted = [...seats].sort((a, b) => a.bench_no - b.bench_no || a.seat.localeCompare(b.seat))
    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      head: [["#", "Bench", "Seat", "Roll No", "Register No", "Name", "Dept", "Year", "Signature"]],
      body: sorted.map((s, k) => [String(k + 1), String(s.bench_no), seatLabel(s.seat), s.roll_no, s.register_no, s.studentName, s.deptCode ?? "—", s.year || s.batch, ""]),
      theme: "grid",
      tableLineColor: RULE, tableLineWidth: 0.25,
      styles: { fontSize: 8, cellPadding: 1.6, textColor: INK, lineColor: RULE, lineWidth: 0.25, valign: "middle", minCellHeight: 8 },
      headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 12, halign: "center" }, 2: { cellWidth: 12 }, 3: { cellWidth: 20 }, 4: { cellWidth: 26 }, 5: { cellWidth: 40 }, 6: { cellWidth: 12 }, 7: { cellWidth: 20 }, 8: { cellWidth: 32 } }
    })
    const finalY = (doc as any).lastAutoTable?.finalY ?? y
    doc.setFontSize(8.5)
    doc.text(`Present: ________     Absent: ________     Invigilator's signature: ______________________`, 14, finalY + 12)
  })
  return doc
}

/** Every student by batch, department and roll number, with hall, bench and seat. */
export function buildStudentSeatListPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "portrait" })
  const y = header(doc, "Student Seat List", args)
  const sorted = [...args.seats].sort((a, b) => a.batch.localeCompare(b.batch) || String(a.deptCode ?? "").localeCompare(String(b.deptCode ?? "")) || rollOrder.compare(a.roll_no, b.roll_no))
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    head: [["Roll No", "Register No", "Name", "Dept", "Year", "Batch", "Hall", "Bench", "Seat"]],
    body: sorted.map(s => [s.roll_no, s.register_no, s.studentName, s.deptCode ?? "—", s.year ?? "", s.batch, s.hall_code, String(s.bench_no), seatLabel(s.seat)]),
    theme: "grid",
    tableLineColor: RULE, tableLineWidth: 0.25,
    styles: { fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: RULE, lineWidth: 0.25 },
    headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
    columnStyles: { 6: { fontStyle: "bold" }, 7: { halign: "center" } }
  })
  const finalY = (doc as any).lastAutoTable?.finalY ?? y
  doc.setFontSize(8); doc.setTextColor(INK_NOTE)
  doc.text(`Total students: ${args.seats.length}`, 14, finalY + 6)
  return doc
}

/** The students the seating rules left without a seat, by roll number, with each reason. */
export function buildUnallocatedListPDF(args: SeatingExportArgs, unallocated: UnallocatedRow[]): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" })
  const y = header(doc, "Unallocated Students", args)
  const sorted = [...unallocated].sort((a, b) => rollOrder.compare(a.roll_no, b.roll_no))
  autoTable(doc, {
    startY: y + 2,
    margin: { left: 14, right: 14 },
    head: [["#", "Roll No", "Name", "Category", "Gender", "Reason"]],
    body: sorted.map((u, k) => [String(k + 1), u.roll_no, u.name ?? "", u.category, u.gender === "M" ? "Male" : "Female", u.reason]),
    theme: "grid",
    tableLineColor: RULE, tableLineWidth: 0.25,
    styles: { fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: RULE, lineWidth: 0.25, valign: "middle" },
    headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 24 }, 2: { cellWidth: 40 }, 3: { cellWidth: 52 }, 4: { cellWidth: 16 } }
  })
  const finalY = (doc as any).lastAutoTable?.finalY ?? y
  doc.setFontSize(8); doc.setTextColor(INK_NOTE)
  doc.text(`Total unallocated: ${unallocated.length}. These students have no seat in this session's seating plan.`, 14, finalY + 6)
  return doc
}

const fileTag = (args: SeatingExportArgs) => `${args.session.exam_date ?? "session"}-${args.session.session_type}`
export const exportSeatingPlanPDF = (args: SeatingExportArgs) => buildSeatingPlanPDF(args).save(`HIAS-Seating-Plan-${fileTag(args)}.pdf`)
export const exportAttendanceSheetPDF = (args: SeatingExportArgs) => buildAttendanceSheetPDF(args).save(`HIAS-Attendance-${fileTag(args)}.pdf`)
export const exportStudentSeatListPDF = (args: SeatingExportArgs) => buildStudentSeatListPDF(args).save(`HIAS-Student-Seats-${fileTag(args)}.pdf`)
export const exportUnallocatedListPDF = (args: SeatingExportArgs, unallocated: UnallocatedRow[]) => buildUnallocatedListPDF(args, unallocated).save(`HIAS-Unallocated-${fileTag(args)}.pdf`)
