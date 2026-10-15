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
export const groupLabel = (gender: "M" | "F" | "mixed" | null | undefined) => (gender === "M" ? "Boys" : gender === "F" ? "Girls" : gender === "mixed" ? "Boys & Girls" : "—")
/** Who sits in a hall, from its seated students: "M", "F", or "mixed" when its bench pattern seats both. */
export const seatsGroup = (seats: Pick<SeatRow, "gender">[]) => (new Set(seats.map(s => s.gender)).size > 1 ? "mixed" as const : seats[0]?.gender)

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
  doc.setFontSize(11); doc.setFont("helvetica", "bold")
  const title = `Hall ${hall.hall_code}`
  doc.text(title, 14, y + 5)
  const titleWidth = doc.getTextWidth(title)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  const parts = [hallLocation(hall), groupLabel(seatsGroup(seats)), `${seats.length} students`, hall.invigilators.length ? `Invigilator: ${hall.invigilators.join(", ")}` : ""].filter(Boolean)
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

type RGB = [number, number, number]
/**
 * Academic-year seat styles for a black-and-white print: years differ by grey shade and border
 * (solid, dashed or none), never by colour, and the roll numbers are always black.
 */
interface SeatStyle { fill: number; border: "solid" | "dashed" | "none" }
const YEAR_PDF_STYLES: SeatStyle[] = [
  { fill: 255, border: "solid" }, { fill: 205, border: "none" }, { fill: 255, border: "dashed" },
  { fill: 225, border: "solid" }, { fill: 180, border: "none" }, { fill: 235, border: "dashed" }
]
const CARD_BORDER: RGB = [120, 120, 120], LABEL_INK: RGB = [40, 40, 40]

/** A seat box in a year's style. */
function seatBox(doc: jsPDF, x: number, y: number, w: number, h: number, st: SeatStyle) {
  doc.setFillColor(st.fill, st.fill, st.fill)
  doc.roundedRect(x, y, w, h, 1, 1, "F")
  if (st.border === "none") return
  doc.setDrawColor(0); doc.setLineWidth(0.35)
  if (st.border === "dashed") doc.setLineDashPattern([1, 0.7], 0)
  doc.roundedRect(x, y, w, h, 1, 1, "S")
  doc.setLineDashPattern([], 0)
}

/**
 * One landscape page per hall: the benches as seen from the front, laid out like the screen. Each
 * bench is a card with its number and its left and right seats; each seat shows the roll number in
 * black, its box shaded by academic year (grey shades and borders, for a black-and-white print). Columns are headed "Column 1", "Column 2", …; rows "R1", "R2", ….
 */
export function buildSeatingPlanPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageW = doc.internal.pageSize.width, pageH = doc.internal.pageSize.height
  // Year colours are fixed for the whole session, so a year has the same colour in every hall.
  const years = [...new Set(args.seats.map(s => s.year || s.batch))].sort()
  const styleOf = (year: string) => YEAR_PDF_STYLES[Math.max(0, years.indexOf(year)) % YEAR_PDF_STYLES.length]

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
    const mixed = seatsGroup(seats) === "mixed"

    doc.setFillColor(70, 70, 70); doc.roundedRect(14, y, pageW - 28, 5.5, 1, 1, "F")
    doc.setTextColor(255); doc.setFontSize(8); doc.setFont("helvetica", "bold")
    doc.text("FRONT  ·  BOARD", pageW / 2, y + 3.8, { align: "center" })
    y += 8

    // Card size: as large as fits the page (at most 52 x 17 mm), then everything scales with it.
    const labelW = 10, gapX = 3, gapY = 2.5, headH = 6, footH = 16
    const cols = Math.max(1, layout.cols), rows = Math.max(1, layout.rows)
    const cardW = Math.min(52, (pageW - 28 - labelW - gapX * (cols - 1)) / cols)
    const cardH = Math.min(17, cardW * 0.34, (pageH - y - headH - footH - gapY * (rows - 1)) / rows)
    const k = Math.min(cardW / 52, cardH / 17)
    const gridW = labelW + cols * cardW + (cols - 1) * gapX
    const x0 = (pageW - gridW) / 2 + labelW

    doc.setFontSize(9 * Math.max(k, 0.75)); doc.setFont("helvetica", "bold"); doc.setTextColor(...LABEL_INK)
    for (let c = 0; c < cols; c++) doc.text(`Column ${c + 1}`, x0 + c * (cardW + gapX) + cardW / 2, y + 4, { align: "center" })
    y += headH

    const pad = 2 * k, pillGap = 1.6 * k, pillH = 7.5 * k
    const pillW = (cardW - 2 * pad - pillGap) / 2
    for (let r = 0; r < rows; r++) {
      const cy = y + r * (cardH + gapY)
      doc.setFontSize(9 * Math.max(k, 0.75)); doc.setFont("helvetica", "bold"); doc.setTextColor(...LABEL_INK)
      doc.text(`R${r + 1}`, x0 - labelW / 2 - 1, cy + cardH / 2 + 1.2, { align: "center" })
      for (let c = 0; c < cols; c++) {
        const cx = x0 + c * (cardW + gapX)
        const n = numbers.get(benchKey(r + 1, c + 1))
        if (n === undefined) {
          doc.setFillColor(235, 235, 235); doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "F")
          continue
        }
        doc.setDrawColor(...CARD_BORDER); doc.setLineWidth(0.3); doc.setFillColor(255, 255, 255)
        doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "FD")
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5 * k); doc.setTextColor(...LABEL_INK)
        doc.text(`Bench ${n}`, cx + pad, cy + pad + 2.4 * k)
        const py = cy + cardH - pad - pillH
        const b = at.get(benchKey(r + 1, c + 1))
        ;[b?.L, b?.R].forEach((s, side) => {
          const px = cx + pad + side * (pillW + pillGap)
          if (!s) {
            doc.setDrawColor(150); doc.setLineWidth(0.25); doc.setLineDashPattern([0.3, 0.9], 0)
            doc.roundedRect(px, py, pillW, pillH, 1, 1, "S"); doc.setLineDashPattern([], 0)
            doc.setFont("helvetica", "italic"); doc.setFontSize(7 * k); doc.setTextColor(110)
            doc.text("empty", px + pillW / 2, py + pillH / 2 + 1 * k, { align: "center" })
            return
          }
          seatBox(doc, px, py, pillW, pillH, styleOf(s.year || s.batch))
          // In a hall of boys and girls, a "B" or "G" at the right shows whose seat it is.
          const tag = mixed ? (s.gender === "F" ? "G" : "B") : ""
          doc.setFont("helvetica", "bold"); doc.setFontSize(7 * k)
          const tagW = tag ? doc.getTextWidth(tag) + 1.2 * k : 0
          if (tag) { doc.setTextColor(0); doc.text(tag, px + pillW - 1.4 * k, py + pillH / 2 + 7 * k * 0.12, { align: "right" }) }
          doc.setFont("courier", "bold"); doc.setTextColor(0)
          let size = 10.5 * k
          doc.setFontSize(size)
          while (size > 4 && doc.getTextWidth(s.roll_no) > pillW - 3 * k - tagW) doc.setFontSize(size -= 0.5)
          doc.text(s.roll_no, px + 1.6 * k, py + pillH / 2 + size * 0.12)
        })
      }
    }

    // Legend: what the colours mean, and how many of each class sit here.
    let ly = y + rows * cardH + (rows - 1) * gapY + 6
    let lx = x0 - labelW
    doc.setFont("helvetica", "normal"); doc.setFontSize(8)
    const hallYears = years.filter(yr => seats.some(s => (s.year || s.batch) === yr))
    for (const yr of hallYears) {
      seatBox(doc, lx, ly - 3.2, 7, 4.4, styleOf(yr))
      doc.setTextColor(0); doc.text(yr, lx + 8.5, ly)
      lx += 8.5 + doc.getTextWidth(yr) + 7
    }
    if (mixed) { doc.setTextColor(0); doc.text("B = Boy    G = Girl", lx, ly) }
    ly += 5
    doc.setTextColor(INK)
    doc.text(`Each bench: left seat, right seat (as seen from the front).   ${categorySummary(seats)}`, x0 - labelW, ly, { maxWidth: pageW - 28 })
    doc.setTextColor(INK); doc.setDrawColor(0); doc.setLineWidth(0.2)
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
