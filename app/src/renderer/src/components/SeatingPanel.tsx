import { useEffect, useMemo, useRef, useState } from "react"
import { Users, RefreshCw, Trash2, FileText, AlertTriangle, Settings2, Search, LayoutGrid, UserX, X, Copy, Download, ChevronDown } from "lucide-react"
import { createPortal } from "react-dom"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { currentSettings } from "../lib/college-settings"
import { cn, hallLocation, formatDateWithDay, formatSession } from "../lib/utils"
import { hallLayout, enabledBenches, seatCount, type Bench } from "../../../shared/hall-layout"
import {
  exportSeatingPlanPDF, exportAttendanceSheetPDF, exportStudentSeatListPDF, exportUnallocatedListPDF, seatLabel, groupLabel, seatsGroup,
  type SeatRow, type SeatingHallInfo, type UnallocatedRow
} from "../lib/export-seating-pdf"
import StudentSelector from "./StudentSelector"
import SeatingConfigEditor from "./SeatingConfigEditor"
import { colorKey, classColors } from "./HallBenchGrid"
import HallSeatingModal from "./HallSeatingModal"
import UnallocatedTable from "./UnallocatedTable"
import { hallPattern, patternGroup } from "../../../shared/seating"

interface Props {
  cycle: any
  session: any
  /** The session's invigilator allocation (getSessionAllocation rows): its halls are the seating halls. */
  allocation: any[]
  /**
   * Makes the invigilator allocation again with the same staff and halls (the seating is kept), so
   * that nobody invigilates a hall writing a subject they handle whenever the rotation allows.
   */
  onReassignInvigilators?: () => Promise<void>
  /** An element in the page's session bar where the "Export PDF" button is shown, as on the Invigilators tab. */
  barActions?: HTMLElement | null
}

/**
 * Student seating for one session: students sit in the halls of the session's invigilator
 * allocation, two to a bench or one to a chair. The administrator selects the students, then gives each hall a
 * bench pattern (boys, girls, or boys and girls bench by bench) and reviews a preview before saving
 * (SeatingConfigEditor, shared/seating.ts). Shows each hall's bench grid, the students left
 * unallocated, and exports the seating PDFs.
 */
export default function SeatingPanel({ cycle, session, allocation, onReassignInvigilators, barActions }: Props) {
  const [seats, setSeats] = useState<SeatRow[]>([])
  const [halls, setHalls] = useState<any[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<null | "select" | "configure">(null)
  const [chosenIds, setChosenIds] = useState<number[]>([])
  /** Subjects picked under "By subject" when selecting the students: the subjects of this exam. */
  const [chosenSubjects, setChosenSubjects] = useState<number[] | null>(null)
  const [saved, setSaved] = useState<Awaited<ReturnType<typeof api.getSeatingConfig>>>(null)
  const [showUnallocated, setShowUnallocated] = useState(false)
  const [viewHallId, setViewHallId] = useState<number | null>(null)
  const [find, setFind] = useState("")
  const [findOpen, setFindOpen] = useState(false)
  const findRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!findOpen) return
    const away = (e: MouseEvent) => { if (!findRef.current?.contains(e.target as Node)) setFindOpen(false) }
    document.addEventListener("mousedown", away)
    return () => document.removeEventListener("mousedown", away)
  }, [findOpen])
  const [others, setOthers] = useState<any[]>([])
  /** Invigilators in a hall writing a subject they handle (Master Data → Subjects). */
  const [conflicts, setConflicts] = useState<Awaited<ReturnType<typeof api.getSubjectConflicts>>>([])
  const [reassigning, setReassigning] = useState(false)

  const load = async () => {
    const [s, h, c] = await Promise.all([api.getSessionSeating(session.id), api.getHalls(), api.getSeatingConfig(session.id)])
    setSeats(s); setHalls(h); setSaved(c)
    api.getSeatingSelections().then(x => setOthers(x.filter((o: any) => o.id !== session.id))).catch(() => setOthers([]))
  }
  useEffect(() => { setWarnings([]); setViewHallId(null); setFind(""); setStep(null); setChosenIds([]); setChosenSubjects(null); load() }, [session.id, allocation.length])
  useEffect(() => { api.getSubjectConflicts(session.id).then(setConflicts).catch(() => setConflicts([])) }, [session.id, allocation, seats])
  const confirmed = session.status === "confirmed" || session.status === "published"

  async function reassign() {
    if (!onReassignInvigilators) return
    if (!confirm("Make the invigilator allocation again with the same staff and halls, keeping staff out of halls writing a subject they handle? Manual changes to this session's allocation are replaced. The seating stays as it is.")) return
    setReassigning(true)
    try { await onReassignInvigilators() } finally { setReassigning(false) }
  }

  // The session's halls in hall order, with their invigilators and bench layouts.
  const sessionHalls: (SeatingHallInfo & { benches: number; seats: number; benchList: Bench[]; raw: any })[] = useMemo(() => {
    const ids = new Set(allocation.map((a: any) => a.hallId))
    return halls.filter(h => ids.has(h.id)).map(h => ({
      id: h.id, hall_code: h.hall_code, block: h.block, floor: h.floor,
      bench_rows: h.bench_rows, bench_cols: h.bench_cols, disabled_benches: h.disabled_benches, seat_kinds: h.seat_kinds,
      invigilators: allocation.filter((a: any) => a.hallId === h.id).map((a: any) => a.userName),
      benches: enabledBenches(hallLayout(h)).length, seats: seatCount(hallLayout(h)), benchList: enabledBenches(hallLayout(h)), raw: h
    }))
  }, [halls, allocation])
  const totalSeats = sessionHalls.reduce((n, h) => n + h.seats, 0)
  const seatsIn = (hallId: number) => seats.filter(s => s.hallId === hallId)
  // The group a hall holds: its students', else the settings'.
  const genderOf = (hallId: number) => seatsGroup(seatsIn(hallId)) ?? patternGroup(hallPattern(saved?.config.halls.find(h => h.hallId === hallId)))
  const years = useMemo(() => [...new Set(seats.map(colorKey))].sort(), [seats])
  const colorOf = classColors(years)
  const unallocated: UnallocatedRow[] = saved?.unallocated ?? []
  // Everyone selected last time, seated or not, for reselecting and re-configuring.
  const selectedIds = saved?.studentIds?.length ? saved.studentIds : seats.map(s => s.studentId)
  // The hall whose tile was clicked: its seating opens in a popup.
  const viewHall = sessionHalls.find(h => h.id === viewHallId) ?? null

  async function onSaved(r: any) {
    setStep(null)
    setWarnings(r.warnings ?? [])
    toast.success(`${r.seated} students seated${r.unallocated?.length ? `, ${r.unallocated.length} unallocated` : ""}.`)
    setLoading(true)
    try { await load() } finally { setLoading(false) }
  }

  // The previous exam: the latest earlier session with seating whose invigilator allocation has
  // exactly this session's halls (so its seats can be copied as they are). The list is newest first;
  // FN comes before AN on the same day.
  const isBefore = (o: any) => o.exam_date < session.exam_date || (o.exam_date === session.exam_date && o.session_type === "FN" && session.session_type === "AN")
  const hallsHere = [...new Set(allocation.map((a: any) => a.hallId as number))].sort((a, b) => a - b).join(",")
  const previous = others.find(o => isBefore(o) && (o.hallIds ?? []).join(",") === hallsHere) ?? null

  /** Gives this session exactly the previous exam's seating: same hall, bench and seat for everyone. */
  async function copyPrevious() {
    if (!previous) return
    const from = `${previous.cycleName} · ${formatDateWithDay(previous.exam_date)} · ${formatSession(previous.session_type)}`
    if (!confirm(`Use the seating of the previous exam (${from}) for this exam? Every student keeps the same hall, bench and seat.${seats.length ? " This replaces the current seating plan." : ""}`)) return
    setLoading(true)
    try {
      const r = await api.copySeating(session.id, previous.id)
      if (!r.success) { toast.error(r.error); return }
      setWarnings([])
      toast.success(`Seating copied from ${from}: ${r.seated} students seated${r.unallocated?.length ? `, ${r.unallocated.length} unallocated` : ""}.`)
      await load()
    } catch (e: any) {
      toast.error(`The seating could not be copied: ${e?.message ?? e}`)
    } finally { setLoading(false) }
  }

  async function clear() {
    if (!confirm("Remove the seating plan of this session?")) return
    await api.clearSeating(session.id)
    setWarnings([]); await load()
    toast.success("Seating removed.")
  }

  // One "Export PDF" button in the session bar, as on the Invigilators tab; it opens the list of seating PDFs.
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exportOpen) return
    const away = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setExportOpen(false) }
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc) }
  }, [exportOpen])
  const exportChoices = [
    { kind: "plan", title: "Seating Plan", note: "One landscape page per hall, bench by bench" },
    { kind: "attendance", title: "Attendance Sheets", note: "One page per hall with a signature column" },
    { kind: "list", title: "Student List", note: "Every student with hall, bench and seat" }
  ] as const

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

  return (
    <div className="space-y-4">
      {seats.length > 0 && barActions && createPortal(
      <div className="relative" ref={exportRef}>
        <button onClick={() => setExportOpen(o => !o)} aria-haspopup="menu" aria-expanded={exportOpen} className="btn-primary flex items-center gap-2">
          <Download className="w-4 h-4" /> Export PDF <ChevronDown className={cn("w-4 h-4 transition-transform", exportOpen && "rotate-180")} />
        </button>
        {exportOpen && (
          <div role="menu" className="absolute right-0 mt-2 w-72 bg-white border border-brand-border rounded-xl shadow-lg z-20 py-1">
            {exportChoices.map(c => (
              <button key={c.kind} role="menuitem" onClick={() => { setExportOpen(false); exportPdf(c.kind) }}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                <FileText className="w-4 h-4 text-brand-textsec shrink-0" />
                <span><span className="block text-sm font-medium text-brand-textmain">{c.title}</span><span className="block text-xs text-brand-textsec">{c.note}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
      , barActions)}
      {/* Summary and actions */}
      <div className="card flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="text-sm flex flex-wrap items-center gap-x-6 gap-y-2 flex-1 min-w-0">
          {seats.length > 0 && (
            <div className="relative w-full max-w-sm" ref={findRef}>
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input className="input-field pl-9" placeholder="Find a student's seat (roll no, register no, name)" value={find}
                onChange={e => { setFind(e.target.value); setFindOpen(true) }} onFocus={() => setFindOpen(true)} />
              {findOpen && find.trim() && (
                <div className="absolute left-0 top-full mt-1 w-[34rem] max-w-[85vw] z-20 bg-white border border-brand-border rounded-xl shadow-lg px-3 py-1 text-sm">
                  {found.length > 0 ? (
                    <div className="divide-y divide-brand-border">
                      {found.map(s => (
                        <button key={s.studentId} onClick={() => { setViewHallId(s.hallId); setFindOpen(false) }} className="w-full text-left py-1.5 flex flex-wrap gap-x-3 hover:text-brand-primary">
                          <span className="font-mono font-semibold">{s.roll_no}</span><span>{s.studentName}</span>
                          <span className="text-brand-textsec">{s.category} → Hall <b>{s.hall_code}</b>, bench {s.bench_no}, {seatLabel(s.seat).toLowerCase()} seat</span>
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-xs text-brand-textsec py-2">No seated student matches.</p>}
                </div>
              )}
            </div>
          )}
          {unallocated.length > 0 && (
            <button onClick={() => setShowUnallocated(true)} className="text-red-600 hover:underline flex items-center gap-1"><UserX className="w-4 h-4" /> Unallocated: <b>{unallocated.length}</b></button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {seats.length > 0 && <button onClick={clear} disabled={loading} className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Clear</button>}
          {others.some(isBefore) && (
            <button onClick={copyPrevious} disabled={loading || !previous}
              title={previous ? `Copy the seating of ${previous.cycleName}, ${formatDateWithDay(previous.exam_date)} ${formatSession(previous.session_type)}` : "Only an earlier exam with exactly the same halls can be copied, and none has them. Use the same halls in the invigilator allocation."}
              className="btn-secondary flex items-center gap-2"><Copy className="w-4 h-4" /> Same as Previous Exam</button>
          )}
          <button onClick={() => setStep("select")} disabled={loading} className={cn(seats.length ? "btn-secondary" : "btn-primary", "flex items-center gap-2")}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            {seats.length ? "Reselect Students" : "Select Students & Configure Seating"}
          </button>
          {seats.length > 0 && (
            <button onClick={() => { setChosenIds(selectedIds); setStep("configure") }} disabled={loading} className="btn-secondary flex items-center gap-2"><Settings2 className="w-4 h-4" /> Edit Configuration</button>
          )}
        </div>
      </div>

      {noLayout.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>No bench layout for {noLayout.map(h => h.hall_code).join(", ")}: no students can sit there. Set the rows and columns in Master Data → Halls.</span>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Invigilator handles a subject written in their hall</p>
            {conflicts.map((c, i) => <p key={i}>• {c.userName} ({c.staffId}) – Hall <b>{c.hall_code}</b> writes {c.subjectCode} {c.subjectName}</p>)}
            <p className="text-xs mt-1">{confirmed ? "This session is confirmed, so its allocation can no longer change." : "Reassigning keeps the rotation first: a clash stays only when the rotation leaves no other choice."}</p>
          </div>
          {!confirmed && onReassignInvigilators && (
            <button onClick={reassign} disabled={reassigning} className="btn-primary text-sm flex items-center gap-2">
              {reassigning && <RefreshCw className="w-4 h-4 animate-spin" />} Reassign invigilators by subject
            </button>
          )}
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
                  g === "M" ? "bg-sky-100 text-sky-700" : g === "F" ? "bg-pink-100 text-pink-700" : g === "mixed" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-700")}>
                  {h.benches === 0 ? "No layout" : g ? groupLabel(g) : seats.length ? "Not used" : "Empty"}
                </span>
              </div>
              <p className="text-xs text-brand-textsec mt-1 truncate">{hallLocation(h) || "—"} · {h.invigilators.join(", ")}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs"><b>{n}</b> / {h.seats} seats</span>
                {n > 0 && <span className="text-[13px] text-brand-textsec truncate ml-2">{[...new Set(seatsIn(h.id).map(s => s.category ?? s.batch))].join(", ")}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Seating of the clicked hall, in a popup */}
      {viewHall && seatsIn(viewHall.id).length > 0 && (
        <HallSeatingModal hall={viewHall} location={hallLocation(viewHall)} seats={seatsIn(viewHall.id)} colorOf={colorOf} highlight={found.map(s => s.studentId)}
          badge={(() => {
            const g = genderOf(viewHall.id)
            return { text: g ? groupLabel(g) : "Not used", className: g === "M" ? "bg-sky-100 text-sky-700" : g === "F" ? "bg-pink-100 text-pink-700" : g === "mixed" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-700" }
          })()}
          onClose={() => setViewHallId(null)} />
      )}

      {step === "select" && (
        <StudentSelector session={session} academicYear={cycle?.academic_year} seats={totalSeats} initialIds={chosenIds.length ? chosenIds : selectedIds}
          initialSubjectIds={chosenSubjects ?? saved?.config.sessionSubjects ?? []}
          onClose={() => setStep(null)}
          onConfirm={(ids, subjectIds) => { setChosenIds(ids); setChosenSubjects(subjectIds); setStep("configure") }} />
      )}
      {step === "configure" && (
        <SeatingConfigEditor session={session} halls={sessionHalls} studentIds={chosenIds} sessionSubjectIds={chosenSubjects}
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
