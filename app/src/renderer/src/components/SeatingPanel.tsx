import { useEffect, useMemo, useState } from "react"
import { Users, RefreshCw, Trash2, FileText, AlertTriangle, Settings2, Search, LayoutGrid, UserX, X } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { currentSettings } from "../lib/college-settings"
import { cn, hallLocation } from "../lib/utils"
import { hallLayout, enabledBenches } from "../../../shared/hall-layout"
import {
  exportSeatingPlanPDF, exportAttendanceSheetPDF, exportStudentSeatListPDF, exportUnallocatedListPDF, seatLabel, groupLabel,
  type SeatRow, type SeatingHallInfo, type UnallocatedRow
} from "../lib/export-seating-pdf"
import StudentSelector from "./StudentSelector"
import SeatingConfigEditor from "./SeatingConfigEditor"
import HallBenchGrid, { colorKey, yearColors } from "./HallBenchGrid"
import UnallocatedTable from "./UnallocatedTable"

interface Props {
  cycle: any
  session: any
  /** The session's invigilator allocation (getSessionAllocation rows): its halls are the seating halls. */
  allocation: any[]
}

/**
 * Student seating for one session: students sit in the halls of the session's invigilator
 * allocation. The administrator selects the students, then configures each hall (boys or girls,
 * permitted categories, category limit, quantities) and reviews a preview before saving
 * (SeatingConfigEditor, shared/seating.ts). Shows each hall's bench grid, the students left
 * unallocated, and exports the seating PDFs.
 */
export default function SeatingPanel({ cycle, session, allocation }: Props) {
  const [seats, setSeats] = useState<SeatRow[]>([])
  const [halls, setHalls] = useState<any[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<null | "select" | "configure">(null)
  const [chosenIds, setChosenIds] = useState<number[]>([])
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof api.getSeatingConfig>>>(null)
  const [showUnallocated, setShowUnallocated] = useState(false)
  const [viewHallId, setViewHallId] = useState<number | null>(null)
  const [find, setFind] = useState("")

  const load = async () => {
    const [s, h, c] = await Promise.all([api.getSessionSeating(session.id), api.getHalls(), api.getSeatingConfig(session.id)])
    setSeats(s); setHalls(h); setSaved(c)
  }
  useEffect(() => { setWarnings([]); setViewHallId(null); setFind(""); setStep(null); setChosenIds([]); load() }, [session.id, allocation.length])

  // The session's halls in hall order, with their invigilators and bench layouts.
  const sessionHalls: (SeatingHallInfo & { benches: number; raw: any })[] = useMemo(() => {
    const ids = new Set(allocation.map((a: any) => a.hallId))
    return halls.filter(h => ids.has(h.id)).map(h => ({
      id: h.id, hall_code: h.hall_code, block: h.block, floor: h.floor,
      bench_rows: h.bench_rows, bench_cols: h.bench_cols, disabled_benches: h.disabled_benches,
      invigilators: allocation.filter((a: any) => a.hallId === h.id).map((a: any) => a.userName),
      benches: enabledBenches(hallLayout(h)).length, raw: h
    }))
  }, [halls, allocation])
  const totalSeats = sessionHalls.reduce((n, h) => n + h.benches * 2, 0)
  const seatsIn = (hallId: number) => seats.filter(s => s.hallId === hallId)
  // The group a hall holds: its students' (the planner may have moved a hall whose gender is not fixed), else the settings'.
  const genderOf = (hallId: number) => seatsIn(hallId)[0]?.gender ?? saved?.config.halls.find(h => h.hallId === hallId)?.gender ?? null
  const years = useMemo(() => [...new Set(seats.map(colorKey))].sort(), [seats])
  const colorOf = yearColors(years)
  const unallocated: UnallocatedRow[] = saved?.unallocated ?? []
  // Everyone selected last time, seated or not, for reselecting and re-configuring.
  const selectedIds = saved?.studentIds?.length ? saved.studentIds : seats.map(s => s.studentId)
  const viewHall = sessionHalls.find(h => h.id === viewHallId) ?? sessionHalls.find(h => seatsIn(h.id).length > 0) ?? null

  async function onSaved(r: any) {
    setStep(null)
    setWarnings(r.warnings ?? [])
    toast.success(`${r.seated} students seated${r.unallocated?.length ? `, ${r.unallocated.length} unallocated` : ""}.`)
    setLoading(true)
    try { await load() } finally { setLoading(false) }
  }

  async function clear() {
    if (!confirm("Remove the seating plan of this session?")) return
    await api.clearSeating(session.id)
    setWarnings([]); await load()
    toast.success("Seating removed.")
  }

  async function exportPdf(kind: "plan" | "attendance" | "list" | "unallocated") {
    const args = { cycle, session, halls: sessionHalls, seats, settings: await currentSettings() }
    if (kind === "plan") exportSeatingPlanPDF(args)
    else if (kind === "attendance") exportAttendanceSheetPDF(args)
    else if (kind === "unallocated") exportUnallocatedListPDF(args, unallocated)
    else exportStudentSeatListPDF(args)
    toast.success("PDF exported!")
  }

  const found = find.trim() ? seats.filter(s => [s.roll_no, s.register_no, s.studentName].some(v => String(v).toLowerCase().includes(find.trim().toLowerCase()))).slice(0, 8) : []

  if (allocation.length === 0) {
    return (
      <div className="card text-center py-16 text-brand-textsec">
        <LayoutGrid className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Generate the invigilator allocation first</p>
        <p className="text-sm mt-1">Students are seated in the same halls as this session's invigilators.</p>
      </div>
    )
  }

  const noLayout = sessionHalls.filter(h => h.benches === 0)
  const boys = seats.filter(s => s.gender === "M").length

  return (
    <div className="space-y-4">
      {/* Summary and actions */}
      <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="text-brand-textsec">Seated: </span><b>{seats.length}</b> <span className="text-brand-textsec">({boys} boys · {seats.length - boys} girls)</span></span>
          <span><span className="text-brand-textsec">Halls: </span><b>{sessionHalls.length}</b> <span className="text-brand-textsec">· {totalSeats} seats</span></span>
          {unallocated.length > 0 && (
            <button onClick={() => setShowUnallocated(true)} className="text-red-600 hover:underline flex items-center gap-1"><UserX className="w-4 h-4" /> Unallocated: <b>{unallocated.length}</b></button>
          )}
          {years.length > 0 && <span className="flex flex-wrap gap-1">{years.map(y => <span key={y} className={cn("px-2 py-0.5 rounded text-xs font-medium", colorOf(y))}>{y}</span>)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {seats.length > 0 && <button onClick={clear} disabled={loading} className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Clear</button>}
          <button onClick={() => setStep("select")} disabled={loading} className={cn(seats.length ? "btn-secondary" : "btn-primary", "flex items-center gap-2")}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            {seats.length ? "Reselect Students" : "Select Students & Configure Seating"}
          </button>
          {seats.length > 0 && (
            <button onClick={() => { setChosenIds(selectedIds); setStep("configure") }} disabled={loading} className="btn-secondary flex items-center gap-2"><Settings2 className="w-4 h-4" /> Edit Configuration</button>
          )}
          {seats.length > 0 && <>
            <button onClick={() => exportPdf("plan")} className="btn-primary flex items-center gap-2"><FileText className="w-4 h-4" /> Seating Plan</button>
            <button onClick={() => exportPdf("attendance")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> Attendance Sheets</button>
            <button onClick={() => exportPdf("list")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> Student List</button>
          </>}
        </div>
      </div>

      {noLayout.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>No bench layout for {noLayout.map(h => h.hall_code).join(", ")}: no students can sit there. Set the rows and columns in Master Data → Halls.</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          {warnings.map((w, i) => <p key={i}>• {w}</p>)}
        </div>
      )}

      {/* Halls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {sessionHalls.map(h => {
          const g = genderOf(h.id), n = seatsIn(h.id).length
          return (
            <div key={h.id} onClick={() => n && setViewHallId(h.id)}
              className={cn("card p-3 transition-all", n && "cursor-pointer hover:border-brand-primary", viewHall?.id === h.id && n && "border-brand-primary ring-1 ring-brand-primary")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-brand-primary">{h.hall_code}</span>
                <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full",
                  g === "M" ? "bg-sky-100 text-sky-700" : g === "F" ? "bg-pink-100 text-pink-700" : "bg-gray-100 text-gray-500")}>
                  {h.benches === 0 ? "No layout" : g ? groupLabel(g) : seats.length ? "Not used" : "Empty"}
                </span>
              </div>
              <p className="text-xs text-brand-textsec mt-1 truncate">{hallLocation(h) || "—"} · {h.invigilators.join(", ")}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs"><b>{n}</b> / {h.benches * 2} seats</span>
                {n > 0 && <span className="text-[11px] text-brand-textsec truncate ml-2">{[...new Set(seatsIn(h.id).map(s => s.category ?? s.batch))].join(", ")}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Find a student */}
      {seats.length > 0 && (
        <div className="card py-3">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-9" placeholder="Find a student's seat (roll no, register no, name)" value={find} onChange={e => setFind(e.target.value)} />
          </div>
          {found.length > 0 && (
            <div className="mt-2 text-sm divide-y divide-brand-border">
              {found.map(s => (
                <button key={s.studentId} onClick={() => setViewHallId(s.hallId)} className="w-full text-left py-1.5 flex flex-wrap gap-x-3 hover:text-brand-primary">
                  <span className="font-mono font-semibold">{s.roll_no}</span><span>{s.studentName}</span>
                  <span className="text-brand-textsec">{s.category} → Hall <b>{s.hall_code}</b>, bench {s.bench_no}, {seatLabel(s.seat).toLowerCase()} seat</span>
                </button>
              ))}
            </div>
          )}
          {find.trim() && found.length === 0 && <p className="text-xs text-brand-textsec mt-2">No seated student matches.</p>}
        </div>
      )}

      {/* Bench grid of the chosen hall */}
      {viewHall && seatsIn(viewHall.id).length > 0 && (
        <HallBenchGrid hall={viewHall} seats={seatsIn(viewHall.id)} colorOf={colorOf} highlight={found.map(s => s.studentId)} />
      )}

      {step === "select" && (
        <StudentSelector session={session} academicYear={cycle?.academic_year} seats={totalSeats} initialIds={chosenIds.length ? chosenIds : selectedIds}
          onClose={() => setStep(null)}
          onConfirm={ids => { setChosenIds(ids); setStep("configure") }} />
      )}
      {step === "configure" && (
        <SeatingConfigEditor session={session} halls={sessionHalls} studentIds={chosenIds}
          onBack={() => setStep("select")} onClose={() => setStep(null)} onSaved={onSaved} />
      )}

      {showUnallocated && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
              <div>
                <h3 className="text-base font-semibold">Unallocated Students ({unallocated.length})</h3>
                <p className="text-xs text-brand-textsec">Selected for this session but left without a seat by the seating rules.</p>
              </div>
              <button onClick={() => setShowUnallocated(false)} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3"><UnallocatedTable rows={unallocated} /></div>
            <div className="px-6 py-3 border-t border-brand-border flex justify-end gap-2">
              <button onClick={() => exportPdf("unallocated")} className="btn-primary flex items-center gap-2"><FileText className="w-4 h-4" /> Print / PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
