import { useEffect, useState } from "react"
import { History, Download } from "lucide-react"
import { api } from "../lib/api"
import { formatDate } from "../lib/utils"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

export default function AllocationHistoryPage() {
  const [cycles, setCycles] = useState<any[]>([])
  const [users, setUsers] = useState<any[]>([])
  const [halls, setHalls] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [filters, setFilters] = useState({ cycleId: "", userId: "", hallId: "", sessionId: "" })
  const [history, setHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getCycles().then(setCycles)
    api.getUsers({ role: "staff" }).then(setUsers)
    api.getHalls().then(setHalls)
  }, [])

  useEffect(() => {
    if (filters.cycleId)
      api.getSessions(Number(filters.cycleId)).then(s => setSessions(s.filter((x: any) => x.status !== "pending")))
    else setSessions([])
  }, [filters.cycleId])

  async function search() {
    setLoading(true)
    try {
      const f: any = {}
      if (filters.cycleId) f.cycleId = Number(filters.cycleId)
      if (filters.userId) f.userId = Number(filters.userId)
      if (filters.hallId) f.hallId = Number(filters.hallId)
      if (filters.sessionId) f.sessionId = Number(filters.sessionId)
      setHistory(await api.getAllocationHistory(f))
    } finally { setLoading(false) }
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape" })
    doc.setFontSize(13)
    doc.text("St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil", 14, 14)
    doc.setFontSize(10)
    doc.text("Allocation History Report", 14, 21)
    doc.setFontSize(8)
    doc.text(`Generated: ${new Date().toLocaleString()}  ·  Records: ${history.length}`, 14, 27)
    autoTable(doc, {
      startY: 32,
      head: [["Staff ID","Name","Dept","Date","Session","Hall","Batch","Edited"]],
      body: history.map(r => [r.staff_id, r.staffName, r.deptCode ?? "—", formatDate(r.exam_date), r.session_type, r.hall_code, r.cycleName, r.is_manually_edited ? "Yes" : "No"]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [18, 59, 42] }
    })
    doc.save("EIAS-allocation-history.pdf")
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-textmain">Allocation History</h1>
        <p className="text-brand-textsec mt-1">Browse all confirmed and published session allocations</p>
      </div>

      {/* Filter panel */}
      <div className="card mb-5">
        <h2 className="text-sm font-semibold text-brand-textmain mb-4">Filter Records</h2>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="label">By Allocation Batch</label>
            <select className="input-field" value={filters.cycleId}
              onChange={e => setFilters(f => ({ ...f, cycleId: e.target.value, sessionId: "" }))}>
              <option value="">— All Batches —</option>
              {cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">By Session</label>
            <select className="input-field" value={filters.sessionId}
              onChange={e => setFilters(f => ({ ...f, sessionId: e.target.value }))}
              disabled={!filters.cycleId}>
              <option value="">— All Sessions —</option>
              {sessions.map((s: any) => <option key={s.id} value={s.id}>{formatDate(s.exam_date)} {s.session_type}</option>)}
            </select>
          </div>
          <div>
            <label className="label">By Staff Member</label>
            <select className="input-field" value={filters.userId}
              onChange={e => setFilters(f => ({ ...f, userId: e.target.value }))}>
              <option value="">— All Staff —</option>
              {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.staff_id})</option>)}
            </select>
          </div>
          <div>
            <label className="label">By Hall</label>
            <select className="input-field" value={filters.hallId}
              onChange={e => setFilters(f => ({ ...f, hallId: e.target.value }))}>
              <option value="">— All Halls —</option>
              {halls.map((h: any) => <option key={h.id} value={h.id}>{h.hall_code} — {h.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={search} disabled={loading} className="btn-primary">
            {loading ? "Searching..." : "Search Records"}
          </button>
          <button onClick={() => { setFilters({ cycleId: "", userId: "", hallId: "", sessionId: "" }); setHistory([]) }}
            className="btn-secondary">Clear Filters</button>
          {history.length > 0 && (
            <button onClick={exportPDF} className="btn-secondary flex items-center gap-2 ml-auto">
              <Download className="w-4 h-4" /> Export PDF
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {history.length > 0 && (
        <div>
          <p className="text-sm text-brand-textsec mb-2">{history.length} records found · {history.filter(r => r.is_manually_edited).length} admin-edited</p>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-brand-border">
                <tr>{["Staff ID","Name","Dept","Date","Session","Hall","Batch","Type"].map(h =>
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border">
                {history.map((r: any, i: number) => (
                  <tr key={i} className={r.is_manually_edited ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50"}>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.staff_id}</td>
                    <td className="px-4 py-2.5 font-medium">{r.staffName}</td>
                    <td className="px-4 py-2.5 text-xs text-brand-textsec">{r.deptCode ?? "—"}</td>
                    <td className="px-4 py-2.5">{formatDate(r.exam_date)}</td>
                    <td className="px-4 py-2.5 font-semibold">{r.session_type}</td>
                    <td className="px-4 py-2.5 font-bold text-brand-primary">{r.hall_code}</td>
                    <td className="px-4 py-2.5 text-xs text-brand-textsec truncate max-w-[140px]">{r.cycleName}</td>
                    <td className="px-4 py-2.5">
                      {r.is_manually_edited
                        ? <span className="text-xs font-medium text-amber-600">Admin Edited</span>
                        : <span className="text-xs text-green-600">Auto</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history.length === 0 && (
        <div className="card text-center py-16 text-brand-textsec">
          <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Set filters above and click Search Records</p>
          <p className="text-sm mt-1">Filter by batch, session, staff member, or hall</p>
        </div>
      )}
    </div>
  )
}
