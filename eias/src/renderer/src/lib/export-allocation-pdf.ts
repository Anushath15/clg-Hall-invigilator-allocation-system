/**
 * Session allocation PDF export.
 *
 * Deliberately a PURE function: it takes data the caller has already loaded and
 * produces a downloadable PDF. It performs no database writes, no API calls and
 * no state mutation, so it cannot influence hall rotation, rotation_history or
 * allocation validation in any way. Rotation state is only ever written by
 * confirmAllocation() -> commitToHistory() in the main process.
 */
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { formatDateWithDay, formatSession, formatTime12h } from "./utils"

export interface AllocationExportRow {
  staff_id: string
  userName: string
  deptCode?: string | null
  hall_code: string
}

export interface AllocationExportArgs {
  cycle: { name?: string; academic_year?: string } | null
  session: {
    exam_date: string
    session_type: "FN" | "AN"
    reporting_time?: string | null
    exam_start?: string | null
    exam_end?: string | null
  }
  allocation: AllocationExportRow[]
  settings?: Record<string, string>
}

export function exportAllocationPDF({ cycle, session, allocation, settings = {} }: AllocationExportArgs): void {
  const collegeName =
    settings["college.name"] ?? "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil"
  const shortName = settings["college.short_name"] ?? "SXCCE"

  const doc = new jsPDF({ orientation: "portrait" })
  const pageWidth = doc.internal.pageSize.width

  doc.setFontSize(14)
  doc.setFont("helvetica", "bold")
  doc.text(collegeName, pageWidth / 2, 14, { align: "center" })

  doc.setFontSize(11)
  doc.setFont("helvetica", "normal")
  doc.text(
    `Invigilator Hall Allocation${cycle?.name ? ` — ${cycle.name}` : ""}${cycle?.academic_year ? ` (${cycle.academic_year})` : ""}`,
    pageWidth / 2,
    21,
    { align: "center" }
  )

  doc.setFontSize(9)
  const times: string[] = []
  if (session.reporting_time) times.push(`Report: ${formatTime12h(session.reporting_time)}`)
  if (session.exam_start && session.exam_end) {
    times.push(`Exam: ${formatTime12h(session.exam_start)}–${formatTime12h(session.exam_end)}`)
  }
  const subtitle = [
    formatDateWithDay(session.exam_date),
    formatSession(session.session_type),
    ...times
  ].join(" · ")
  doc.text(subtitle, pageWidth / 2, 27, { align: "center" })

  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(`Generated: ${new Date().toLocaleString()} · ${shortName}`, 14, 34)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 39,
    head: [["#", "Staff ID", "Name", "Department", "Assigned Hall"]],
    body: allocation.map((a, idx) => [
      String(idx + 1),
      a.staff_id ?? "—",
      a.userName ?? "—",
      a.deptCode ?? "—",
      a.hall_code ?? "—"
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [22, 163, 74] }
  })

  const finalY = (doc as any).lastAutoTable?.finalY ?? 39
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text(`Total invigilators: ${allocation.length}`, 14, finalY + 8)
  doc.setTextColor(0)

  doc.save(`EIAS-Allocation-${session.exam_date ?? "session"}-${session.session_type}.pdf`)
}
