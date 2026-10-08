import { useEffect, useState } from "react"
import { FileText, Download, BarChart3, Users, Calendar, AlertCircle, Grid } from "lucide-react"
import { api } from "../lib/api"
import { INK, INK_NOTE, HEAD_DARK, HEAD_RED, HEAD_GREEN_STYLE } from "../lib/pdf-ink"
import { formatDate, formatDateWithDay, formatSession, formatTime12h, hallLocation } from "../lib/utils"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import toast from "react-hot-toast"

const REPORTS = [
  { id: "staffwise", label: "Staff-Wise Duty Report", icon: Users, desc: "All sessions per staff member" },
  { id: "datewise", label: "Date-Wise Allocation Sheet", icon: Calendar, desc: "Hall-by-hall seating for posting" },
  { id: "timetable", label: "Complete Timetable Grid", icon: Grid, desc: "Full Staff × Session matrix" },
  { id: "audit", label: "Rotation Audit Report", icon: AlertCircle, desc: "Auto vs admin-edited assignments" }
]

// Report cells: short department code (fits the PDF columns) and 12-hour times.
const dept = (r: any) => r.deptCode ?? r.deptName ?? "—"
const where = (r: any) => hallLocation({ block: r.hallBlock, floor: r.hallFloor }) || "—"
const time = (t?: string | null) => (t ? formatTime12h(t) : "—")
const examTime = (r: any) => (r.exam_start && r.exam_end ? `${formatTime12h(r.exam_start)}–${formatTime12h(r.exam_end)}` : "—")

export default function ReportsPage() {
  const [active, setActive] = useState("staffwise")
  const [cycles, setCycles] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [selectedCycle, setSelectedCycle] = useState<number | null>(null)
  const [selectedUser, setSelectedUser] = useState<number | null>(null)
  const [selectedSession, setSelectedSession] = useState<number | null>(null)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    api.getCycles().then(setCycles)
    api.getUsers({ role: "staff" }).then(setUsers)
    api.getSettings().then(setSettings)
  }, [])

  useEffect(() => {
    if (selectedCycle) api.getSessions(selectedCycle).then(s => setSessions(s.filter((x: any) => ["confirmed","published"].includes(x.status))))
    else setSessions([])
  }, [selectedCycle])

  async function generate() {
    setLoading(true)
    setData(null)
    try {
      if (active === "staffwise") setData(await api.getStaffWiseReport(selectedUser ?? undefined))
      else if (active === "datewise" && selectedSession) setData(await api.getDateWiseReport(selectedSession))
      else if (active === "timetable" && selectedCycle) setData(await api.getCompleteTimetable(selectedCycle))
      else if (active === "audit" && selectedCycle) setData(await api.getAuditReport(selectedCycle))
      else { toast.error(active === "datewise" ? "Please select a batch and a session." : "Please select a batch."); return }
    } finally { setLoading(false) }
  }

  function exportPDF() {
    const collegeName = settings["college.name"] ?? "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil"
    const shortName = settings["college.short_name"] ?? "SXCCE"
    const doc = new jsPDF({ orientation: active === "staffwise" ? "portrait" : "landscape" })

    doc.setFontSize(14); doc.setFont("helvetica", "bold")
    doc.text(collegeName, doc.internal.pageSize.width / 2, 14, { align: "center" })
    doc.setFontSize(10); doc.setFont("helvetica", "normal")
    const titles: Record<string, string> = {
      staffwise: "Staff-Wise Invigilation Duty Report",
      datewise: "Date-Wise Hall Allocation Sheet",
      timetable: "Complete Invigilation Timetable",
      audit: "Rotation Audit Report"
    }
    // The date-wise sheet is posted per session, so its title must say which one.
    const first = active === "datewise" && Array.isArray(data) ? data[0] : null
    const title = first
      ? `${titles[active]} — ${formatDateWithDay(first.exam_date)} (${formatSession(first.session_type)})`
      : titles[active]
    doc.text(title, doc.internal.pageSize.width / 2, 21, { align: "center" })
    doc.setFontSize(8); doc.setTextColor(INK_NOTE)
    doc.text(`Generated: ${new Date().toLocaleString()} · ${shortName}`, 14, 28)
    doc.setTextColor(INK)

    if (active === "staffwise" && Array.isArray(data)) {
      autoTable(doc, {
        startY: 33,
        head: [["Staff ID","Name","Dept","Date","Session","Hall","Report Time","Exam","Batch"]],
        body: data.map((r: any) => [r.staff_id, r.staffName, dept(r), formatDate(r.exam_date), r.session_type, r.hall_code, time(r.reporting_time), examTime(r), r.cycleName]),
        styles: { fontSize: 8, textColor: INK }, headStyles: HEAD_GREEN_STYLE
      })
    } else if (active === "datewise" && Array.isArray(data)) {
      autoTable(doc, {
        startY: 33,
        head: [["Hall","Location","Capacity","Staff ID","Name","Dept","Designation","Report Time","Exam"]],
        body: data.map((r: any) => [r.hall_code, where(r), r.capacity, r.staff_id, r.staffName, dept(r), r.designation ?? "—", time(r.reporting_time), examTime(r)]),
        styles: { fontSize: 8, textColor: INK }, headStyles: HEAD_GREEN_STYLE
      })
    } else if (active === "timetable" && data?.sessions && data?.users) {
      // Build matrix table
      const confirmedSessions = data.sessions.filter((s: any) => ["confirmed","published"].includes(s.status))
      const lookup: Record<string, string> = {}
      for (const a of data.allocations) {
        const h = data.halls.find((h: any) => h.id === a.hall_id)
        lookup[`${a.user_id}_${a.session_id}`] = h?.hall_code ?? "?"
      }
      const headers = ["Staff ID","Name","Dept",...confirmedSessions.map((s: any) => `${formatDate(s.exam_date)}\n${s.session_type}`)]
      const rows = data.users.map((u: any) => [
        u.staff_id, u.name, dept(u),
        ...confirmedSessions.map((s: any) => lookup[`${u.id}_${s.id}`] ?? "—")
      ])
      autoTable(doc, {
        startY: 33,
        head: [headers],
        body: rows,
        styles: { fontSize: 7, cellPadding: 2, textColor: INK },
        headStyles: { fillColor: HEAD_DARK, textColor: 255, fontStyle: "bold", fontSize: 7 },
        columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 30 }, 2: { cellWidth: 12 } }
      })
    } else if (active === "audit" && Array.isArray(data)) {
      autoTable(doc, {
        startY: 33,
        head: [["Staff ID","Name","Dept","Date","Session","Assigned Hall","Generated Hall","Edited","Reason"]],
        body: data.map((r: any) => [r.staff_id, r.staffName, r.deptCode ?? "—", formatDate(r.exam_date), r.session_type, r.assignedHall, r.generatedHall ?? "—", r.is_manually_edited ? "YES" : "No", r.edit_reason ?? "—"]),
        styles: { fontSize: 8, textColor: INK }, headStyles: { fillColor: HEAD_RED, textColor: 255, fontStyle: "bold" }
      })
    }
    doc.save(`HIAS-${active}-report.pdf`)
  }

  const showCycleFilter = ["datewise","timetable","audit"].includes(active)
  const showUserFilter = active === "staffwise"
  const showSessionFilter = active === "datewise"

  const rows = active === "timetable"
    ? [] // rendered differently below
    : Array.isArray(data) ? data : []

  const COLS: Record<string, string[]> = {
    staffwise: ["Staff ID","Name","Dept","Date","Session","Hall","Report","Exam","Batch"],
    datewise: ["Hall","Location","Cap","Staff ID","Name","Dept","Designation","Report","Exam"],
    audit: ["Staff ID","Name","Dept","Date","Session","Assigned Hall","Generated Hall","Edited","Reason"]
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-textmain mb-2">Reports</h1>
      <p className="text-brand-textsec mb-6">Generate and export allocation reports with your college letterhead</p>

      {/* Report type selector */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => { setActive(r.id); setData(null) }}
            className={`card flex items-start gap-3 text-left transition-all p-4 ${active === r.id ? "border-brand-primary ring-2 ring-brand-light" : "hover:border-brand-primary"}`}>
            <r.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${active === r.id ? "text-brand-primary" : "text-brand-textsec"}`} />
            <div>
              <p className={`text-sm font-semibold ${active === r.id ? "text-brand-primary" : "text-brand-textmain"}`}>{r.label}</p>
              <p className="text-xs text-brand-textsec mt-0.5">{r.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          {showCycleFilter && (
            <div><label className="label">Allocation Batch *</label>
              <select className="input-field w-60" value={selectedCycle ?? ""} onChange={e => setSelectedCycle(Number(e.target.value) || null)}>
                <option value="">— Select Batch —</option>
                {cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          )}
          {showSessionFilter && (
            <div><label className="label">Session *</label>
              <select className="input-field w-56" value={selectedSession ?? ""} onChange={e => setSelectedSession(Number(e.target.value) || null)}>
                <option value="">— Select Session —</option>
                {sessions.map((s: any) => <option key={s.id} value={s.id}>{formatDate(s.exam_date)} {s.session_type}</option>)}
              </select></div>
          )}
          {showUserFilter && (
            <div><label className="label">Staff Member (optional)</label>
              <select className="input-field w-60" value={selectedUser ?? ""} onChange={e => setSelectedUser(Number(e.target.value) || null)}>
                <option value="">— All Staff —</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.staff_id})</option>)}
              </select></div>
          )}
          <div className="flex gap-2">
            <button onClick={generate} disabled={loading} className="btn-primary flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> {loading ? "Generating..." : "Generate"}
            </button>
            {data && (active !== "timetable" || (data?.sessions?.length)) && (
              <button onClick={exportPDF} className="btn-secondary flex items-center gap-2">
                <Download className="w-4 h-4" /> Export PDF
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {active === "timetable" && data?.sessions?.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 bg-brand-sidebar text-white text-sm font-semibold">
            Complete Timetable Matrix — {cycles.find(c => c.id === selectedCycle)?.name}
          </div>
          <div className="overflow-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="bg-gray-100 px-3 py-2 text-left sticky left-0 z-10 border border-gray-200">Staff</th>
                  {data.sessions.filter((s: any) => ["confirmed","published"].includes(s.status)).map((s: any) => (
                    <th key={s.id} className="bg-gray-100 px-2 py-2 text-center whitespace-nowrap border border-gray-200 min-w-[65px]">
                      <div>{formatDate(s.exam_date).split(" ").slice(0,2).join(" ")}</div>
                      <div className="text-gray-500">{s.exam_date.slice(0, 4)} · {s.session_type}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.users.map((u: any, idx: number) => {
                  const lookup: Record<string, any> = {}
                  for (const a of data.allocations) {
                    const h = data.halls.find((h: any) => h.id === a.hall_id)
                    lookup[`${a.user_id}_${a.session_id}`] = { code: h?.hall_code, edited: a.is_manually_edited }
                  }
                  return (
                    <tr key={u.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="sticky left-0 z-10 px-3 py-1.5 bg-inherit border border-gray-200">
                        <div className="font-medium truncate max-w-[160px]">{u.name}</div>
                        <div className="text-[10px] text-gray-400">{u.staff_id}</div>
                      </td>
                      {data.sessions.filter((s: any) => ["confirmed","published"].includes(s.status)).map((s: any) => {
                        const cell = lookup[`${u.id}_${s.id}`]
                        return (
                          <td key={s.id} className="px-1 py-1 text-center border border-gray-100">
                            {cell ? (
                              <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${cell.edited ? "bg-amber-100 text-amber-700" : "bg-green-50 text-green-700"}`}>
                                {cell.code}
                              </span>
                            ) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length > 0 && active !== "timetable" && (
        <div className="card p-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-brand-sidebar text-white">
              <tr>{(COLS[active] ?? []).map(h =>
                <th key={h} className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wider font-semibold border-r border-white/10">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {rows.map((r: any, i: number) => (
                <tr key={i} className={`hover:bg-gray-50 ${r.is_manually_edited ? "bg-amber-50" : ""}`}>
                  {active === "staffwise" && [r.staff_id,r.staffName,dept(r),formatDate(r.exam_date),r.session_type,r.hall_code,time(r.reporting_time),examTime(r),r.cycleName].map((v,j) => <td key={j} className="px-3 py-2">{v}</td>)}
                  {active === "datewise" && [r.hall_code,where(r),r.capacity,r.staff_id,r.staffName,dept(r),r.designation??'—',time(r.reporting_time),examTime(r)].map((v,j) => <td key={j} className="px-3 py-2">{v}</td>)}
                  {active === "audit" && [r.staff_id,r.staffName,r.deptCode??'—',formatDate(r.exam_date),r.session_type,<b className="text-brand-primary">{r.assignedHall}</b>,r.generatedHall??'—',r.is_manually_edited?<span className="text-amber-600 font-bold">YES</span>:"No",r.edit_reason??'—'].map((v,j) => <td key={j} className="px-3 py-2">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-gray-50 border-t text-xs text-brand-textsec">
            {rows.length} records
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="card text-center py-12 text-brand-textsec">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>Select a report type and filters, then click Generate.</p>
        </div>
      )}
    </div>
  )
}
