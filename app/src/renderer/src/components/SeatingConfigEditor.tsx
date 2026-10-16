import { useEffect, useMemo, useState } from "react"
import { X, Wand2, AlertTriangle, CheckCircle2, RefreshCw, ArrowLeft, Users, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { cn, formatDateWithDay, hallLocation } from "../lib/utils"
import {
  normalizeConfig, normalizeClassLimit, patternGroup, patternSeats, configureWithPattern, BENCH_TYPES, BENCH_TYPE_LABEL,
  DEFAULT_CLASS_LIMIT, MIN_CLASSES_PER_HALL, MAX_CLASSES_PER_HALL,
  type SeatingConfig, type SeatHall, type Gender, type BenchType, type HallGroup, type ClassLimit
} from "../../../shared/seating"
import { hallLayout, kindSummary, type Bench } from "../../../shared/hall-layout"
import type { SeatRow } from "../lib/export-seating-pdf"
import { classColors, colorKey } from "./HallBenchGrid"
import HallSeatingModal from "./HallSeatingModal"
import UnallocatedTable from "./UnallocatedTable"

interface SessionHall { id: number; hall_code: string; benches: number; seats: number; benchList: Bench[]; raw: any; invigilators: string[] }
interface Props {
  session: { id: number; exam_date: string; session_type: string }
  /** The session's halls (its invigilator allocation), with their layouts. */
  halls: SessionHall[]
  studentIds: number[]
  onBack: () => void
  onClose: () => void
  onSaved: (result: any) => void
}

/** The hall settings offered: whole boys' or girls' halls, a bench pattern of both, or not used. */
const HALL_MODES: { group: HallGroup; label: string; pattern: BenchType[] }[] = [
  { group: "M", label: "Boys", pattern: ["MM"] },
  { group: "F", label: "Girls", pattern: ["FF"] },
  { group: "mixed", label: "Boys & Girls", pattern: ["MM", "FF"] },
  { group: null, label: "Not used", pattern: [] }
]
/**
 * How the whole session is seated: in roll number order with boys and girls together; whole boys'
 * and girls' halls; one bench pattern in every hall; or each hall set on its own.
 */
type Method = "separate" | "pattern" | "custom" | "rollwise"
const METHODS: { value: Method; label: string }[] = [
  { value: "rollwise", label: "Roll number order" },
  { value: "separate", label: "Gender based allocation" },
  { value: "pattern", label: "Create your own pattern" },
  { value: "custom", label: "Custom per hall" }
]
const DEFAULT_PATTERN: BenchType[] = ["MM", "FF"]
const samePattern = (a: BenchType[], b: BenchType[]) => a.length === b.length && a.every((t, i) => t === b[i])

/** The method a configuration follows (used when the screen opens on saved or automatic settings). */
function methodOf(config: SeatingConfig): { method: Method; pattern: BenchType[] } {
  const used = config.halls.filter(h => h.pattern.length > 0)
  if (config.mixGenders) return { method: "rollwise", pattern: DEFAULT_PATTERN }
  if (used.every(h => h.pattern.length === 1 && (h.pattern[0] === "MM" || h.pattern[0] === "FF"))) return { method: "separate", pattern: DEFAULT_PATTERN }
  if (used.every(h => samePattern(h.pattern, used[0].pattern))) return { method: "pattern", pattern: used[0].pattern }
  return { method: "custom", pattern: DEFAULT_PATTERN }
}

const groupName = (g: HallGroup) => (g === "M" ? "Boys" : g === "F" ? "Girls" : g === "mixed" ? "Boys & Girls" : "Not used")
const MODE_COLOR: Record<string, string> = { M: "bg-sky-600 text-white", F: "bg-pink-600 text-white", mixed: "bg-violet-600 text-white", null: "bg-gray-500 text-white" }
const BENCH_CHIP: Record<BenchType, string> = { MM: "border-sky-300 bg-sky-50", FF: "border-pink-300 bg-pink-50" }

/**
 * Seating configuration for one session: each hall gets a bench pattern, repeated bench by bench:
 * boys only, girls only, a pattern of both (Boy + Boy and Girl + Girl benches; a boy and a girl
 * never share a bench), or not used. Students sit two to a bench, filling the halls in order (shared/seating.ts). A live preview shows
 * the plan; saving re-checks everything on the other side.
 */
export default function SeatingConfigEditor({ session, halls, studentIds, onBack, onClose, onSaved }: Props) {
  const [autoConfig, setAutoConfig] = useState<SeatingConfig | null>(null)
  const [separateConfig, setSeparateConfig] = useState<SeatingConfig | null>(null)
  const [rollConfig, setRollConfig] = useState<SeatingConfig | null>(null)
  const [method, setMethod] = useState<Method>("separate")
  /** The bench pattern of the "Create your own pattern" method. */
  const [sharedPattern, setSharedPattern] = useState<BenchType[]>(DEFAULT_PATTERN)
  const [config, setConfig] = useState<SeatingConfig | null>(null)
  /** How many different classes (papers) a hall may hold: the target, and the most if the target cannot seat everyone. */
  const [classLimit, setClassLimit] = useState<ClassLimit>(DEFAULT_CLASS_LIMIT)
  /** The class limit the automatic settings were last made for (they are made again when it changes). */
  const [autoLimit, setAutoLimit] = useState<ClassLimit | null>(null)
  const [counts, setCounts] = useState({ boys: 0, girls: 0 })
  /** Why no split of the halls seats everyone (from the automatic search); null when one does. */
  const [shortfall, setShortfall] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmList, setConfirmList] = useState<any[] | null>(null)
  const [viewHallId, setViewHallId] = useState<number | null>(null)

  const seatHalls: SeatHall[] = useMemo(() => halls.map(h => ({ id: h.id, hall_code: h.hall_code, ...hallLayout(h.raw) })), [halls])
  const hallOf = (id: number) => halls.find(h => h.id === id)!

  // Start from the saved configuration when it seated everyone of the same selection, else the
  // automatic one (which seats everyone whenever the halls can).
  useEffect(() => {
    let live = true
    api.getSeatingConfig(session.id).then(async saved => {
      const limit = normalizeClassLimit(saved?.config.classLimit)
      const auto = await api.autoConfigureSeating(session.id, studentIds, limit)
      if (!live) return
      if (!auto.success) { toast.error(auto.error, { duration: 7000 }); onClose(); return }
      setClassLimit(limit); setAutoLimit(limit)
      setAutoConfig(auto.config); setSeparateConfig(auto.separateConfig); setRollConfig(auto.rollConfig); setCounts({ boys: auto.boys, girls: auto.girls }); setShortfall(auto.shortfall)
      const sameStudents = !!saved && saved.studentIds.length === studentIds.length && studentIds.every(id => saved.studentIds.includes(id))
      const usable = saved && sameStudents && saved.unallocated.length === 0 && normalizeConfig(saved.config, seatHalls).halls.some(h => h.pattern.length > 0)
      const start: SeatingConfig = usable ? normalizeConfig(saved.config, seatHalls) : auto.config
      const m = methodOf(start)
      setMethod(m.method); setSharedPattern(m.pattern)
      setConfig(start)
    })
    return () => { live = false }
  }, [session.id, studentIds])

  // A new class limit: the automatic settings (and what cannot be seated) are worked out again for it.
  useEffect(() => {
    if (!autoLimit || (autoLimit.preferred === classLimit.preferred && autoLimit.max === classLimit.max)) return
    let live = true
    api.autoConfigureSeating(session.id, studentIds, classLimit).then(auto => {
      if (!live || !auto.success) return
      setAutoLimit(classLimit); setAutoConfig(auto.config); setSeparateConfig(auto.separateConfig); setRollConfig(auto.rollConfig); setShortfall(auto.shortfall)
    })
    return () => { live = false }
  }, [classLimit])

  // Preview the plan shortly after each change.
  useEffect(() => {
    if (!config) return
    setPreviewing(true)
    const t = setTimeout(() => {
      api.previewSeating(session.id, studentIds, { ...config, classLimit }).then(r => {
        if (!r.success) toast.error(r.error)
        setPreview(r.success ? r : null)
      }).finally(() => setPreviewing(false))
    }, 250)
    return () => clearTimeout(t)
  }, [config, classLimit])

  if (!config) {
    return (
      <Shell session={session} onClose={onClose}>
        <div className="flex-1 flex items-center justify-center text-brand-textsec"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      </Shell>
    )
  }

  const setPattern = (hallId: number, pattern: BenchType[]) =>
    setConfig({ ...config, halls: config.halls.map(h => h.hallId === hallId ? { ...h, pattern } : h) })
  const totalSeats = config.halls.reduce((n, h) => n + (h.pattern.length ? hallOf(h.hallId).seats : 0), 0)
  const seatsFor = (g: Gender) => config.halls.reduce((n, h) => n + patternSeats(h.pattern, hallOf(h.hallId).benchList)[g], 0)
  const need = { M: counts.boys, F: counts.girls }
  /** The automatic settings for a method: the halls needed, with that method's rule. */
  const autoFor = (m: Method, pattern = sharedPattern): SeatingConfig =>
    m === "separate" ? separateConfig! : m === "pattern" ? configureWithPattern(need, seatHalls, pattern) : m === "rollwise" ? rollConfig! : autoConfig!
  function chooseMethod(m: Method) {
    if (m === method) return
    setMethod(m)
    // Custom keeps the current settings to edit (as boys' and girls' seats, when leaving roll number
    // order); the other methods start from their automatic settings.
    if (m !== "custom") setConfig(autoFor(m))
    else if (config!.mixGenders) setConfig(autoConfig!)
  }
  function changeSharedPattern(pattern: BenchType[]) {
    setSharedPattern(pattern)
    setConfig({ ...config!, halls: config!.halls.map(h => h.pattern.length ? { ...h, pattern } : h) })
  }

  async function save(acceptUnallocated: boolean) {
    setSaving(true)
    try {
      const r = await api.confirmSeating(session.id, studentIds, { ...config!, classLimit }, { acceptUnallocated })
      if (r.needsConfirmation) { setConfirmList(r.unallocated); return }
      if (!r.success) { toast.error(r.error, { duration: 8000 }); return }
      setConfirmList(null)
      onSaved(r)
    } finally { setSaving(false) }
  }

  const plan = preview?.plan
  const errors: string[] = preview?.errors ?? []
  const warnings: string[] = preview?.warnings ?? []
  const studentOf = new Map<number, any>((preview?.students ?? []).map((s: any) => [s.id, s]))
  const previewSeats = (hallId: number): SeatRow[] => (plan?.seats ?? []).filter((s: any) => s.hallId === hallId).map((s: any) => {
    const st = studentOf.get(s.studentId)
    return { studentId: s.studentId, roll_no: st?.roll_no ?? "", register_no: "", studentName: st?.name ?? "", gender: st?.gender, batch: st?.batch ?? "", deptCode: st?.deptCode, year: st?.year, category: st?.category,
      hallId: s.hallId, hall_code: hallOf(s.hallId)?.hall_code ?? "", bench_row: s.row, bench_col: s.col, bench_no: s.benchNo, seat: s.seat }
  })
  const colorOf = classColors((preview?.students ?? []).map((s: any) => colorKey(s)))
  const viewHall = halls.find(h => h.id === viewHallId)
  const unallocated = plan?.unallocated ?? []

  return (
    <Shell session={session} onClose={onClose}>
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* Settings */}
        <div className="overflow-y-auto border-b lg:border-b-0 lg:border-r border-brand-border p-4 space-y-4">
          <div>
            <h4 className="text-sm font-semibold mb-1.5">Allocation method</h4>
            <div className="space-y-1.5">
              {METHODS.map(m => (
                <label key={m.value} className={cn("flex items-center gap-2 border rounded-lg px-2.5 py-2 cursor-pointer", method === m.value ? "border-brand-primary bg-brand-primary/5" : "border-brand-border hover:bg-gray-50")}>
                  <input type="radio" name="seating-method" className="accent-brand-primary mt-0.5" checked={method === m.value} onChange={() => chooseMethod(m.value)} />
                  <span className="text-sm font-medium">{m.label}</span>
                </label>
              ))}
            </div>
            {method === "pattern" && (
              <div className="mt-2 border border-violet-200 bg-violet-50/40 rounded-lg p-2.5">
                <PatternEditor pattern={sharedPattern} onChange={changeSharedPattern} />
              </div>
            )}
            <div className="mt-3 border border-brand-border rounded-lg px-2.5 py-2">
              <h4 className="text-sm font-semibold">Classes per hall</h4>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                <label className="flex items-center gap-1">Target
                  <select className="input-field py-0.5 text-xs w-auto" value={classLimit.preferred}
                    onChange={e => setClassLimit(normalizeClassLimit({ preferred: Number(e.target.value), max: classLimit.max }))}>
                    {range(MIN_CLASSES_PER_HALL, MAX_CLASSES_PER_HALL).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1">up to
                  <select className="input-field py-0.5 text-xs w-auto" value={classLimit.max}
                    onChange={e => setClassLimit(normalizeClassLimit({ preferred: classLimit.preferred, max: Number(e.target.value) }))}>
                    {range(classLimit.preferred, MAX_CLASSES_PER_HALL).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  if needed
                </label>
              </div>
            </div>
            <button onClick={() => { setConfig(autoFor(method)); toast.success("Halls assigned automatically.") }} className="btn-secondary text-sm flex items-center gap-2 mt-2"><Wand2 className="w-4 h-4" /> Auto-assign halls</button>
          </div>

          {method === "rollwise" ? (
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
              <b>Students</b>: {counts.boys + counts.girls} selected ({counts.boys} boys, {counts.girls} girls)
              <div className={cn(counts.boys + counts.girls > totalSeats ? "text-red-600 font-semibold" : "text-brand-textsec")}>{totalSeats} seats in the halls used</div>
            </div>
          ) : <div className="grid grid-cols-2 gap-2 text-xs">
            {(["M", "F"] as Gender[]).map(g => {
              const need = g === "M" ? counts.boys : counts.girls, have = seatsFor(g)
              return (
                <div key={g} className={cn("rounded-lg border px-3 py-2", g === "M" ? "border-sky-200 bg-sky-50" : "border-pink-200 bg-pink-50")}>
                  <b>{groupName(g)}</b>: {need} selected
                  <div className={cn(need > have ? "text-red-600 font-semibold" : "text-brand-textsec")}>{have} seats assigned</div>
                </div>
              )
            })}
          </div>}

          <div className="space-y-2">
            {config.halls.map(h => {
              const hall = hallOf(h.hallId)
              const group = patternGroup(h.pattern)
              const seats = patternSeats(h.pattern, hall.benchList)
              // The choices a hall card offers under the session's method.
              const modes = method === "separate" ? HALL_MODES.filter(m => m.group !== "mixed")
                : method === "pattern" ? [{ group: "mixed" as HallGroup, label: "Use", pattern: sharedPattern }, HALL_MODES[3]]
                : method === "rollwise" ? [{ group: "mixed" as HallGroup, label: "Use", pattern: ["MM"] as BenchType[] }, HALL_MODES[3]]
                : HALL_MODES
              const active = (m: { group: HallGroup }) => method === "pattern" || method === "rollwise" ? (m.group === null) === (h.pattern.length === 0) : group === m.group
              return (
                <div key={h.hallId} className={cn("border rounded-lg p-2.5", group ? "border-brand-border" : "border-dashed border-gray-300 bg-gray-50")}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-brand-primary">{hall.hall_code}</span>
                    <span className="text-xs text-brand-textsec">{kindSummary(hallLayout(hall.raw))} · {hall.seats} seats</span>
                    {group && method !== "rollwise" && <span className="ml-auto text-[13px] text-brand-textsec whitespace-nowrap"><b className="text-sky-700">{seats.M}</b> B · <b className="text-pink-700">{seats.F}</b> G</span>}
                  </div>
                  <div className="flex flex-wrap rounded-md border border-brand-border overflow-hidden text-xs mt-2 w-fit">
                    {modes.map(m => (
                      <button key={m.label} onClick={() => !active(m) && setPattern(h.hallId, m.pattern)}
                        className={cn("px-2.5 py-1", active(m) ? MODE_COLOR[String((method === "pattern" || method === "rollwise") && m.group ? "mixed" : m.group)] : "bg-white hover:bg-gray-50")}>{m.label}</button>
                    ))}
                  </div>
                  {method === "custom" && (group === "mixed" || h.pattern.length > 1) && (
                    <div className="mt-2">
                      <PatternEditor pattern={h.pattern} onChange={p => setPattern(h.hallId, p)} />
                      {h.pattern.length > hall.benches && hall.benches > 0 && <p className="text-[13px] text-brand-textsec mt-1">Only the first {hall.benches} benches of the pattern are used.</p>}
                    </div>
                  )}
                  {group && hall.benches === 0 && <p className="text-xs text-red-600 mt-2">No bench layout: set it in Master Data → Halls.</p>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Preview */}
        <div className="overflow-y-auto p-4 space-y-4 bg-gray-50/50">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="font-semibold flex items-center gap-2">Preview {previewing && <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-textsec" />}</span>
            {plan && <>
              <span><span className="text-brand-textsec">Selected: </span><b>{studentIds.length}</b></span>
              <span><span className="text-brand-textsec">Seated: </span><b>{plan.seats.length}</b></span>
              <span className={cn(unallocated.length && "text-red-600")}><span className="text-brand-textsec">Unallocated: </span><b>{unallocated.length}</b></span>
            </>}
          </div>

          {shortfall && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Not everyone can be seated</p>
              <p>{shortfall}</p>
              <p className="text-xs mt-1">Every combination of halls was tried, including boys and girls sharing a hall bench by bench.</p>
            </div>
          )}
          {!shortfall && unallocated.length > 0 && (
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-900 flex flex-wrap items-center justify-between gap-2">
              <span>These halls can seat everyone with different hall settings.</span>
              <button onClick={() => { const m = methodOf(autoConfig!); setMethod(m.method); if (m.method === "pattern") setSharedPattern(m.pattern); setConfig(autoConfig) }} className="btn-primary text-xs flex items-center gap-1.5"><Wand2 className="w-3.5 h-3.5" /> Seat everyone</button>
            </div>
          )}
          {errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Fix these before saving</p>
              {errors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}
          {errors.length === 0 && plan && <p className="text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Two students per bench, never two of the same class on a bench, at most {classLimit.max} classes in a hall, {config.mixGenders ? "seats in roll number order, boys and girls together." : "every seat as its hall's bench pattern says."}</p>}
          {warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 max-h-40 overflow-y-auto">
              {warnings.map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          {plan && (
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-brand-border">
                  <tr>{["Hall", "Group", "Benches", "Seats", "Students", "Empty"].map(t => <th key={t} className="text-left px-3 py-2 font-semibold text-brand-textsec uppercase tracking-wider whitespace-nowrap">{t}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {plan.halls.map((h: any) => (
                    <tr key={h.hallId} onClick={() => h.occupied && setViewHallId(h.hallId)} className={cn("align-top", h.occupied && "cursor-pointer hover:bg-gray-50", viewHall?.id === h.hallId && "bg-brand-primary/5")}>
                      <td className="px-3 py-2 font-mono font-bold text-brand-primary">{h.hall_code}</td>
                      <td className={cn("px-3 py-2 whitespace-nowrap", !h.gender && "text-brand-textsec")}>{groupName(h.gender)}</td>
                      <td className="px-3 py-2">{h.benches}</td>
                      <td className="px-3 py-2">{h.capacity}</td>
                      <td className="px-3 py-2 font-semibold">{h.occupied}</td>
                      <td className="px-3 py-2">{h.empty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewHall && previewSeats(viewHall.id).length > 0 && (() => {
            const g = plan?.halls?.find((h: any) => h.hallId === viewHall.id)?.gender
            return (
              <HallSeatingModal hall={viewHall} location={hallLocation(viewHall.raw)} seats={previewSeats(viewHall.id)} colorOf={colorOf}
                badge={{ text: groupName(g), className: g === "M" ? "bg-sky-100 text-sky-700" : g === "F" ? "bg-pink-100 text-pink-700" : g === "mixed" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-700" }}
                onClose={() => setViewHallId(null)} />
            )
          })()}

          {unallocated.length > 0 && (
            <div className="card">
              <h4 className="text-sm font-semibold mb-2 text-red-700">Unallocated students ({unallocated.length})</h4>
              <UnallocatedTable rows={unallocated} />
            </div>
          )}
        </div>
      </div>

      <div className="px-6 py-3 border-t border-brand-border flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="btn-secondary flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> <Users className="w-4 h-4" /> Change students</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => (unallocated.length ? setConfirmList(unallocated) : save(false))} disabled={!plan || errors.length > 0 || previewing || saving || plan.seats.length === 0} className="btn-primary flex items-center gap-2">
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />} Confirm & Save
          </button>
        </div>
      </div>

      {confirmList && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-brand-border">
              <h3 className="text-base font-semibold flex items-center gap-2 text-red-700"><AlertTriangle className="w-5 h-5" /> {confirmList.length} student{confirmList.length === 1 ? "" : "s"} will not be seated</h3>
              <p className="text-xs text-brand-textsec mt-1">Their group's halls are full. Saving keeps this list with the plan, to view and print from the Student Seating tab. To seat them, go back and give their group more seats.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-3"><UnallocatedTable rows={confirmList} /></div>
            <div className="px-6 py-3 border-t border-brand-border flex justify-end gap-2">
              <button onClick={() => setConfirmList(null)} className="btn-secondary">Go back</button>
              <button onClick={() => save(true)} disabled={saving} className="btn-primary bg-red-600 hover:bg-red-700 flex items-center gap-2">
                {saving && <RefreshCw className="w-4 h-4 animate-spin" />} Save with {confirmList.length} unallocated
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

/** The whole numbers from `from` to `to`. */
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)

/** A bench pattern: its benches in order (left seat + right seat), each changeable, removable, and more added. */
function PatternEditor({ pattern, onChange }: { pattern: BenchType[]; onChange: (pattern: BenchType[]) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {pattern.map((t, i) => (
          <span key={i} className={cn("flex items-center gap-0.5 border rounded pl-1 text-[13px]", BENCH_CHIP[t])}>
            <span className="text-brand-textsec">{i + 1}.</span>
            <select className="bg-transparent py-0.5 outline-none" value={t} title="Who sits on this bench: left seat + right seat"
              onChange={e => onChange(pattern.map((x, j) => j === i ? e.target.value as BenchType : x))}>
              {BENCH_TYPES.map(bt => <option key={bt} value={bt}>{BENCH_TYPE_LABEL[bt]}</option>)}
            </select>
            <button title="Remove this bench from the pattern" disabled={pattern.length === 1}
              onClick={() => onChange(pattern.filter((_, j) => j !== i))} className="px-1 hover:text-red-600 disabled:opacity-30"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <button onClick={() => onChange([...pattern, pattern[pattern.length - 1] === "MM" ? "FF" : "MM"])} title="Add a bench to the pattern"
          className="flex items-center gap-0.5 border border-dashed border-gray-300 rounded px-1.5 text-[13px] hover:bg-gray-50"><Plus className="w-3 h-3" /> Bench</button>
      </div>
    </div>
  )
}

function Shell({ session, onClose, children }: { session: Props["session"]; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[94vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-brand-border">
          <div>
            <h3 className="text-base font-semibold">Seating Configuration</h3>
            <p className="text-xs text-brand-textsec">{formatDateWithDay(session.exam_date)} · {session.session_type}</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
