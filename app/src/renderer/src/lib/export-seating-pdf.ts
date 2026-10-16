/**
 * Student seating PDFs for one session. Pure functions like export-allocation-pdf.ts: they take
 * data already loaded and build the document in memory (no database writes, no network).
 *
 *  - Seating plan: one landscape page per hall, the bench grid as seen from the front, each bench
 *    showing its number and the roll numbers on its left and right seats (each class in its own seat
 *    style and number), then a class table (key, class, roll number range, count, total).
 *  - Attendance sheet: one page per class in each hall, a row per student in bench order, with a
 *    signature column.
 *  - Student seat list: every student by batch and roll number with hall, bench and seat, for the
 *    notice board.
 *  - Unallocated students: those the seating rules left without a seat, with the reason.
 */
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { INK, INK_NOTE, RULE, HEAD_GREEN } from "./pdf-ink"
import { formatDateWithDay, formatSession, formatTime12h, hallLocation } from "./utils"
import { hallLayout, benchKey, enabledBenches, SEAT_KIND_LABEL, type Bench } from "../../../shared/hall-layout"

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
  bench_rows?: number; bench_cols?: number; disabled_benches?: unknown; seat_kinds?: unknown
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

/** Hall code, location, group and count; the invigilators too unless `invigilators` is false. */
function hallLine(doc: jsPDF, y: number, hall: SeatingHallInfo, seats: SeatRow[], invigilators = true) {
  doc.setFontSize(11); doc.setFont("helvetica", "bold")
  const title = `Hall ${hall.hall_code}`
  doc.text(title, 14, y + 5)
  const titleWidth = doc.getTextWidth(title)
  doc.setFont("helvetica", "normal"); doc.setFontSize(9)
  const parts = [hallLocation(hall), groupLabel(seatsGroup(seats)), `${seats.length} students`, invigilators && hall.invigilators.length ? `Invigilator: ${hall.invigilators.join(", ")}` : ""].filter(Boolean)
  doc.text(parts.join("  ·  "), 14 + titleWidth + 4, y + 5)
  return y + 9
}

/** A hall's classes in seating order: each with its roll number range, who they are, and how many. */
export function classSummary(seats: SeatRow[]): { label: string; range: string; count: number }[] {
  const groups = new Map<string, SeatRow[]>()
  for (const s of [...seats].sort((a, b) => a.bench_no - b.bench_no || a.seat.localeCompare(b.seat))) {
    const k = classOf(s)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  return [...groups].map(([label, g]) => {
    const rolls = g.map(s => s.roll_no).sort(rollOrder.compare)
    const range = rolls.length > 1 ? `${rolls[0]} - ${rolls[rolls.length - 1]}` : rolls[0]
    return { label, range: `${range} (${groupLabel(seatsGroup(g))})`, count: g.length }
  })
}

const hallsWithSeats = (args: SeatingExportArgs) => args.halls
  .map(h => ({ hall: h, seats: args.seats.filter(s => s.hallId === h.id) }))
  .filter(x => x.seats.length > 0)

type RGB = [number, number, number]
/**
 * Class seat styles for a black-and-white print: classes differ by grey shade and border (solid,
 * dashed, dotted, thick or none), never by colour, and the roll numbers are always black. Every seat
 * also carries its class number, so classes stay distinct even past the last style.
 */
interface SeatStyle { fill: number; border: "solid" | "dashed" | "dotted" | "thick" | "none" }
const CLASS_PDF_STYLES: SeatStyle[] = [
  { fill: 255, border: "solid" }, { fill: 200, border: "none" }, { fill: 255, border: "dashed" }, { fill: 225, border: "solid" },
  { fill: 170, border: "none" }, { fill: 255, border: "dotted" }, { fill: 225, border: "dashed" }, { fill: 200, border: "solid" },
  { fill: 255, border: "thick" }, { fill: 225, border: "dotted" }, { fill: 200, border: "dashed" }, { fill: 170, border: "solid" }
]
/** A seat's class: department and year ("CSE – Final Year"), else its batch. */
const classOf = (s: Pick<SeatRow, "category" | "year" | "batch">) => s.category || s.year || s.batch
const CARD_BORDER: RGB = [120, 120, 120], LABEL_INK: RGB = [40, 40, 40]

/** A seat box in a year's style. */
function seatBox(doc: jsPDF, x: number, y: number, w: number, h: number, st: SeatStyle) {
  doc.setFillColor(st.fill, st.fill, st.fill)
  doc.roundedRect(x, y, w, h, 1, 1, "F")
  if (st.border === "none") return
  doc.setDrawColor(0); doc.setLineWidth(0.35)
  if (st.border === "thick") doc.setLineWidth(0.8)
  if (st.border === "dashed") doc.setLineDashPattern([1, 0.7], 0)
  if (st.border === "dotted") doc.setLineDashPattern([0.25, 0.6], 0)
  doc.roundedRect(x, y, w, h, 1, 1, "S")
  doc.setLineDashPattern([], 0)
}

const TABLE_BOTTOM = 6
/**
 * The class table under a hall's benches: which classes sit there, their roll numbers, and how many.
 * Draws it at `startY` and returns its height.
 */
function classTable(doc: jsPDF, startY: number, classes: { label: string; range: string; count: number }[], total: number,
  styleOf: (c: string) => SeatStyle, classNo: (c: string) => number): number {
  const pageW = doc.internal.pageSize.width
  const tableW = Math.min(170, pageW - 28)
  autoTable(doc, {
    startY,
    margin: { left: (pageW - tableW) / 2, right: (pageW - tableW) / 2, bottom: TABLE_BOTTOM },
    showFoot: "lastPage",
    tableWidth: tableW,
    head: [["KEY", "CLASS", "ROLL NUMBERS SPACE", "TOTAL"]],
    body: classes.map(c => ["", c.label, c.range, String(c.count).padStart(2, "0")]),
    foot: [[{ content: "TOTAL", colSpan: 3, styles: { halign: "right" } }, String(total).padStart(2, "0")]],
    theme: "grid",
    tableLineColor: 0, tableLineWidth: 0.3,
    styles: { fontSize: 9, cellPadding: 1.2, textColor: 0, lineColor: 0, lineWidth: 0.3, halign: "center", valign: "middle" },
    headStyles: { fillColor: 255, textColor: 0, fontStyle: "bold" },
    footStyles: { fillColor: 255, textColor: 0, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: tableW * 0.1 }, 1: { cellWidth: tableW * 0.35 }, 2: { cellWidth: tableW * 0.4 }, 3: { cellWidth: tableW * 0.15 } },
    // KEY: a seat swatch in the class's style with its number, as on the benches.
    didDrawCell: d => {
      if (d.section !== "body" || d.column.index !== 0) return
      const c = classes[d.row.index].label
      const w = Math.min(14, d.cell.width - 3), h = Math.min(4.6, d.cell.height - 1.4)
      const bx = d.cell.x + (d.cell.width - w) / 2, by = d.cell.y + (d.cell.height - h) / 2
      seatBox(doc, bx, by, w, h, styleOf(c))
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0)
      doc.text(String(classNo(c)), bx + w / 2, by + h / 2 + 1, { align: "center" })
    }
  })
  return ((doc as any).lastAutoTable?.finalY ?? startY) - startY
}

/**
 * One landscape page per hall: the benches as seen from the front, laid out like the screen. Each
 * bench is a card with its number and its left and right seats; each seat shows the roll number in
 * black with its class number, its box styled by class (grey shades and borders, for a black-and-white print). Columns are headed "Column 1", "Column 2", …; rows "R1", "R2", ….
 */
export function buildSeatingPlanPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" })
  const pageW = doc.internal.pageSize.width, pageH = doc.internal.pageSize.height
  // Class styles and numbers are fixed for the whole session, so a class looks the same in every hall.
  const classList = [...new Set(args.seats.map(classOf))].sort()
  const classNo = (c: string) => Math.max(0, classList.indexOf(c)) + 1
  const styleOf = (c: string) => CLASS_PDF_STYLES[(classNo(c) - 1) % CLASS_PDF_STYLES.length]

  hallsWithSeats(args).forEach(({ hall, seats }, i) => {
    if (i > 0) doc.addPage()
    let y = hallLine(doc, header(doc, "Student Seating Plan", args), hall, seats, false)
    const layout = hallLayout(hall)
    const numbers = new Map<string, Bench>(enabledBenches(layout).map(b => [benchKey(b.row, b.col), b]))
    const at = new Map<string, { L?: SeatRow; R?: SeatRow }>()
    for (const s of seats) {
      const k = benchKey(s.bench_row, s.bench_col)
      at.set(k, { ...at.get(k), [s.seat]: s })
    }
    const mixed = seatsGroup(seats) === "mixed"
    const hasChairs = [...numbers.values()].some(b => b.seats === 1)
    const classes = classSummary(seats).sort((a, b) => classNo(a.label) - classNo(b.label))

    doc.setFillColor(70, 70, 70); doc.roundedRect(14, y, pageW - 28, 5.5, 1, 1, "F")
    doc.setTextColor(255); doc.setFontSize(8); doc.setFont("helvetica", "bold")
    doc.text("FRONT  ·  BOARD", pageW / 2, y + 3.8, { align: "center" })
    y += 8

    // Card size: as large as fits the page (at most 52 x 17 mm), then everything scales with it.
    // The footer holds the legend line and the class table, measured by drawing it on a scratch page,
    // so the grid, legend and table always share one sheet.
    const scratch = new jsPDF({ orientation: "landscape" })
    const tableH = classTable(scratch, 0, classes, seats.length, styleOf, classNo)
    const labelW = 10, gapX = 3, gapY = 2.5, headH = 6, footH = 6 + 3 + tableH + TABLE_BOTTOM + 1
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
        const bench = numbers.get(benchKey(r + 1, c + 1))
        if (bench === undefined) {
          doc.setFillColor(235, 235, 235); doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "F")
          continue
        }
        doc.setDrawColor(...CARD_BORDER); doc.setLineWidth(0.3); doc.setFillColor(255, 255, 255)
        doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, "FD")
        doc.setFont("helvetica", "normal"); doc.setFontSize(7.5 * k); doc.setTextColor(...LABEL_INK)
        doc.text(`${SEAT_KIND_LABEL[bench.kind]} ${bench.benchNo}`, cx + pad, cy + pad + 2.4 * k)
        const py = cy + cardH - pad - pillH
        const b = at.get(benchKey(r + 1, c + 1))
        // A bench has a left and a right seat; a chair one seat, drawn in the middle.
        ;(bench.seats === 2 ? [b?.L, b?.R] : [b?.L]).forEach((s, side) => {
          const px = bench.seats === 2 ? cx + pad + side * (pillW + pillGap) : cx + (cardW - pillW) / 2
          if (!s) {
            doc.setDrawColor(150); doc.setLineWidth(0.25); doc.setLineDashPattern([0.3, 0.9], 0)
            doc.roundedRect(px, py, pillW, pillH, 1, 1, "S"); doc.setLineDashPattern([], 0)
            doc.setFont("helvetica", "italic"); doc.setFontSize(7 * k); doc.setTextColor(110)
            doc.text("empty", px + pillW / 2, py + pillH / 2 + 1 * k, { align: "center" })
            return
          }
          seatBox(doc, px, py, pillW, pillH, styleOf(classOf(s)))
          // At the right: the class number, and in a hall of boys and girls a "B" or "G".
          const tag = `${classNo(classOf(s))}${mixed ? (s.gender === "F" ? "G" : "B") : ""}`
          doc.setFont("helvetica", "bold"); doc.setFontSize(7 * k)
          const tagW = doc.getTextWidth(tag) + 1.2 * k
          doc.setTextColor(0); doc.text(tag, px + pillW - 1.4 * k, py + pillH / 2 + 7 * k * 0.12, { align: "right" })
          doc.setFont("courier", "bold"); doc.setTextColor(0)
          let size = 10.5 * k
          doc.setFontSize(size)
          while (size > 4 && doc.getTextWidth(s.roll_no) > pillW - 3 * k - tagW) doc.setFontSize(size -= 0.5)
          doc.text(s.roll_no, px + 1.6 * k, py + pillH / 2 + size * 0.12)
        })
      }
    }

    // Legend line; the class table below is the key to the seat styles and numbers.
    let ly = y + rows * cardH + (rows - 1) * gapY + 6
    let lx = x0 - labelW
    doc.setFont("helvetica", "normal"); doc.setFontSize(8)
    if (mixed) { doc.setTextColor(0); doc.text("B = Boy    G = Girl", lx, ly); lx += doc.getTextWidth("B = Boy    G = Girl") + 7 }
    doc.setTextColor(INK)
    doc.text(`Each bench: left seat, right seat (as seen from the front)${hasChairs ? "; each chair: one seat" : ""}.   The number in a seat is its class (see KEY below).`, lx, ly)

    classTable(doc, ly + 3, classes, seats.length, styleOf, classNo)
    doc.setTextColor(INK); doc.setDrawColor(0); doc.setLineWidth(0.2)
  })
  return doc
}

/** The seat in a table cell: the bench as two seats side by side (as seen from the front), the student's one shaded. */
function seatIcon(doc: jsPDF, cell: { x: number; y: number; width: number; height: number }, side: "L" | "R") {
  const w = 5, h = 4, gap = 1, bx = cell.x + (cell.width - 2 * w - gap) / 2, by = cell.y + (cell.height - h) / 2
  doc.setDrawColor(0); doc.setLineWidth(0.3)
  ;(["L", "R"] as const).forEach((seat, i) => {
    const g = seat === side ? 110 : 255
    doc.setFillColor(g, g, g)
    doc.roundedRect(bx + i * (w + gap), by, w, h, 0.6, 0.6, "FD")
  })
}

/**
 * One page per class in each hall (D01 CSE – Final Year, then D01 AI – Final Year on its own sheet,
 * …): the class's students in bench order, with a column to sign.
 */
export function buildAttendanceSheetPDF(args: SeatingExportArgs): jsPDF {
  const doc = new jsPDF({ orientation: "portrait" })
  let page = 0
  for (const { hall, seats: hallSeats } of hallsWithSeats(args)) {
    const classes = [...new Set(hallSeats.map(classOf))].sort()
    for (const cls of classes) {
      if (page++ > 0) doc.addPage()
      const seats = hallSeats.filter(s => classOf(s) === cls)
      let y = hallLine(doc, header(doc, "Hall Attendance Sheet", args), hall, seats)
      doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.setTextColor(INK)
      doc.text(`Class: ${cls}`, 14, y + 2)
      y += 5
      const sorted = [...seats].sort((a, b) => a.bench_no - b.bench_no || a.seat.localeCompare(b.seat))
      autoTable(doc, {
        startY: y,
        margin: { left: 14, right: 14 },
        head: [["#", "Bench", "Seat", "Roll No", "Register No", "Name", "Signature"]],
        body: sorted.map((s, k) => [String(k + 1), String(s.bench_no), "", s.roll_no, s.register_no, s.studentName, ""]),
        theme: "grid",
        tableLineColor: RULE, tableLineWidth: 0.25,
        styles: { fontSize: 8, cellPadding: 1.6, textColor: INK, lineColor: RULE, lineWidth: 0.25, valign: "middle", minCellHeight: 8 },
        headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 8, halign: "center" }, 1: { cellWidth: 14, halign: "center" }, 2: { cellWidth: 16 }, 3: { cellWidth: 22 }, 4: { cellWidth: 30 }, 5: { cellWidth: 54 }, 6: { cellWidth: 38 } },
        didDrawCell: d => { if (d.section === "body" && d.column.index === 2) seatIcon(doc, d.cell, sorted[d.row.index].seat) }
      })
      const finalY = (doc as any).lastAutoTable?.finalY ?? y
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal")
      doc.text(`Present: ________     Absent: ________     Invigilator's signature: ______________________`, 14, finalY + 12)
    }
  }
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
    body: sorted.map(s => [s.roll_no, s.register_no, s.studentName, s.deptCode ?? "—", s.year ?? "", s.batch, s.hall_code, String(s.bench_no), ""]),
    theme: "grid",
    tableLineColor: RULE, tableLineWidth: 0.25,
    headStyles: { fillColor: HEAD_GREEN, textColor: 255, fontStyle: "bold" },
    columnStyles: { 6: { fontStyle: "bold" }, 7: { halign: "center" }, 8: { cellWidth: 15 } },
    styles: { fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: RULE, lineWidth: 0.25, valign: "middle", minCellHeight: 6 },
    didDrawCell: d => { if (d.section === "body" && d.column.index === 8) seatIcon(doc, d.cell, sorted[d.row.index].seat) }
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
