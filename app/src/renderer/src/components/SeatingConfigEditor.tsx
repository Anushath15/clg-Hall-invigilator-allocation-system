import { useEffect, useMemo, useState } from "react"
import { X, ChevronUp, ChevronDown, Wand2, Copy, AlertTriangle, CheckCircle2, RefreshCw, ArrowLeft, Users, Lock, Shuffle, LayoutGrid, Pencil } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { cn, formatDateWithDay } from "../lib/utils"
import { hallLayout } from "../../../shared/hall-layout"
import { checkConfig, mergeConfig, normalizeConfig, type SeatingConfig, type HallSeatingConfig, type StudentCategory, type SeatHall, type Gender } from "../../../shared/seating"
import type { SeatRow } from "../lib/export-seating-pdf"
import HallBenchGrid, { yearColors } from "./HallBenchGrid"
import UnallocatedTable from "./UnallocatedTable"
import SeatingPatternEditor from "./SeatingPatternEditor"
import { slotKey, type SeatingPattern, type PatternSlot } from "../../../shared/seating-pattern"

interface SessionHall { id: number; hall_code: string; benches: number; raw: any; invigilators: string[] }
interface Props {
  session: { id: number; exam_date: string; session_type: string }
  /** The session's halls (its invigilator allocation), with their layouts. */
  halls: SessionHall[]
  studentIds: number[]
  onBack: () => void
  onClose: () => void
  onSaved: (result: any) => void
}

const GENDER_OPTIONS: [Gender | "", string][] = [["M", "Boys"], ["F", "Girls"], ["", "Not used"]]
const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by
  if (j < 0 || j >= list.length) return list
  const next = [...list]; [next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * Seating configuration for one session: the order of halls and categories, each hall's group
 * (boys/girls), category limit, permitted categories and requested quantities, with a live preview
 * of the plan (shared/seating.ts) and its checks. Saving re-checks everything on the other side.
 */
export default function SeatingConfigEditor({ session, halls, studentIds, onBack, onClose, onSaved }: Props) {
  const [categories, setCategories] = useState<StudentCategory[]>([])
  const [autoConfig, setAutoConfig] = useState<SeatingConfig | null>(null)
  const [config, setConfig] = useState<SeatingConfig | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmList, setConfirmList] = useState<any[] | null>(null)
  const [viewHallId, setViewHallId] = useState<number | null>(null)
  const [sources, setSources] = useState<any[]>([])
  const [patterns, setPatterns] = useState<SeatingPattern[]>([])
  /** The pattern being drawn, and the hall to give it to once saved. */
  const [editing, setEditing] = useState<{ pattern: SeatingPattern; hallId: number | null } | null>(null)

  const seatHalls: SeatHall[] = useMemo(() => halls.map(h => ({ id: h.id, hall_code: h.hall_code, ...hallLayout(h.raw), default_max_categories: h.raw.default_max_categories ?? null })), [halls])
  const hallOf = (id: number) => halls.find(h => h.id === id)!
  const catOf = useMemo(() => new Map(categories.map(c => [c.key, c])), [categories])

  // Start from the saved configuration (for the halls and categories still present), else the automatic one.
  useEffect(() => {
    let live = true
    Promise.all([api.autoConfigureSeating(session.id, studentIds), api.getSeatingConfig(session.id), api.getSeatingSelections()]).then(([auto, saved, sel]) => {
      if (!live) return
      if (!auto.success) { toast.error(auto.error, { duration: 7000 }); onClose(); return }
      setCategories(auto.categories); setAutoConfig(auto.config)
      setConfig(saved ? mergeConfig(auto.config, normalizeConfig(saved.config, seatHalls), auto.categories.map((c: StudentCategory) => c.key)) : auto.config)
      setSources(sel.filter((s: any) => s.id !== session.id))
    })
    api.getSeatingPatterns().then(p => { if (live) setPatterns(p) })
    return () => { live = false }
  }, [session.id, studentIds])

  // Preview the plan shortly after each change.
  useEffect(() => {
    if (!config) return
    setPreviewing(true)
    const t = setTimeout(() => {
      api.previewSeating(session.id, studentIds, config).then(r => {
        if (!r.success) toast.error(r.error)
        setPreview(r.success ? r : null)
      }).finally(() => setPreviewing(false))
    }, 350)
    return () => clearTimeout(t)
  }, [config])

  // Ordered categories (the configured order, with categories present).
  const orderedCats = useMemo(() => {
    if (!config) return []
    const rank = new Map(config.categoryOrder.map((k, i) => [k, i]))
    return [...categories].sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9))
  }, [categories, config])

  const local = useMemo(() => config ? checkConfig(normalizeConfig(config, seatHalls), seatHalls, categories) : { errors: [], warnings: [] }, [config, seatHalls, categories])
  // What a pattern seat can be: each department + academic year of the selected students, boys or girls.
  const patternSlots = useMemo(() => {
    const out = new Map<string, { slot: PatternSlot; students: number }>()
    for (const c of orderedCats) {
      if (!c.year || !c.departmentId) continue
      for (const g of ["M", "F"] as Gender[]) {
        const slot: PatternSlot = { departmentId: c.departmentId, deptCode: c.deptCode, year: c.year, gender: g }
        const e = out.get(slotKey(slot)) ?? { slot, students: 0 }
        e.students += g === "M" ? c.boys : c.girls
        out.set(slotKey(slot), e)
      }
    }
    return [...out.values()].filter(x => x.students > 0)
  }, [orderedCats])
  // Department + year + gender that some hall's pattern has seats for.
  const patternTakes = useMemo(() => {
    const keys = new Set<string>()
    for (const h of config?.halls ?? []) for (const b of Object.values(h.pattern?.cells ?? {})) for (const s of [b.L, b.R]) if (s) keys.add(slotKey(s))
    return keys
  }, [config])

  // Categories with students of a group that no hall of that group permits: they cannot be seated.
  const unpermitted = useMemo(() => {
    if (!config) return []
    const out: string[] = []
    for (const c of orderedCats) for (const g of ["M", "F"] as Gender[]) {
      const n = g === "M" ? c.boys : c.girls
      if (patternTakes.has(`${c.departmentId}|${c.year}|${g}`)) continue
      if (n > 0 && c.year && !config.halls.some(h => !h.pattern && h.gender === g && h.categories.some(x => x.key === c.key))) out.push(`${n} ${g === "M" ? "boys" : "girls"} of ${c.label}: no ${g === "M" ? "boys'" : "girls'"} hall permits this category.`)
    }
    return out
  }, [config, orderedCats, patternTakes])

  if (!config) {
    return (
      <Shell session={session} onClose={onClose}>
        <div className="flex-1 flex items-center justify-center text-brand-textsec"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      </Shell>
    )
  }

  const setHall = (hallId: number, patch: Partial<HallSeatingConfig>) =>
    setConfig({ ...config, halls: config.halls.map(h => h.hallId === hallId ? { ...h, ...patch } : h) })
  const toggleCat = (h: HallSeatingConfig, key: string, on: boolean) =>
    setHall(h.hallId, { categories: on ? [...h.categories, { key, quantity: null }] : h.categories.filter(c => c.key !== key) })
  const setQty = (h: HallSeatingConfig, key: string, value: string) =>
    setHall(h.hallId, { categories: h.categories.map(c => c.key === key ? { ...c, quantity: value === "" ? null : Math.max(0, Math.floor(Number(value) || 0)) } : c) })

  // A new pattern starts with the size of the hall it is drawn for.
  const newPattern = (hallId: number): SeatingPattern => {
    const layout = hallLayout(hallOf(hallId).raw)
    return { name: "", rows: Math.max(1, layout.rows), cols: Math.max(1, layout.cols), cells: {} }
  }
  function patternSaved(p: SeatingPattern) {
    setPatterns(list => [...list.filter(x => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name)))
    // Halls already following this pattern take the new version; the hall it was drawn for starts following it.
    setConfig({ ...config!, halls: config!.halls.map(h => (h.pattern?.id === p.id || h.hallId === editing?.hallId) ? { ...h, pattern: p } : h) })
    setEditing(null)
  }
  function choosePattern(h: HallSeatingConfig, value: string) {
    if (value === "") setHall(h.hallId, { pattern: null })
    else if (value === "new") setEditing({ pattern: newPattern(h.hallId), hallId: h.hallId })
    else if (value !== "own") setHall(h.hallId, { pattern: patterns.find(p => String(p.id) === value) ?? null })
  }

  async function copyFrom(id: number) {
    const other = await api.getSeatingConfig(id)
    if (!other) { toast.error("That session has no saved hall settings to copy."); return }
    setConfig(mergeConfig(config!, normalizeConfig(other.config, seatHalls), categories.map(c => c.key)))
    toast.success("Hall settings copied for the halls both sessions use.")
  }

  async function save(acceptUnallocated: boolean) {
    setSaving(true)
    try {
      const r = await api.confirmSeating(session.id, studentIds, config!, { acceptUnallocated })
      if (r.needsConfirmation) { setConfirmList(r.unallocated); return }
      if (!r.success) { toast.error(r.error, { duration: 8000 }); return }
      setConfirmList(null)
      onSaved(r)
    } finally { setSaving(false) }
  }

  const plan = preview?.plan
  const errors: string[] = preview?.errors ?? local.errors
  const warnings: string[] = [...new Set([...(preview?.warnings ?? local.warnings), ...unpermitted])]
  const studentOf = new Map<number, any>((preview?.students ?? []).map((s: any) => [s.id, s]))
  const previewSeats = (hallId: number): SeatRow[] => (plan?.seats ?? []).filter((s: any) => s.hallId === hallId).map((s: any) => {
    const st = studentOf.get(s.studentId)
    return { studentId: s.studentId, roll_no: st?.roll_no ?? "", register_no: "", studentName: st?.name ?? "", gender: st?.gender, batch: st?.batch ?? "", deptCode: st?.deptCode, year: st?.year,
      hallId: s.hallId, hall_code: hallOf(s.hallId)?.hall_code ?? "", bench_row: s.row, bench_col: s.col, bench_no: s.benchNo, seat: s.seat }
  })
  const colorOf = yearColors(categories.map(c => c.year || c.batch))
  const viewHall = halls.find(h => h.id === viewHallId) ?? halls.find(h => previewSeats(h.id).length > 0)
  const unallocated = plan?.unallocated ?? []

  return (
    <Shell session={session} onClose={onClose}>
      <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Settings */}
        <div className="overflow-y-auto border-b lg:border-b-0 lg:border-r border-brand-border p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setConfig(autoConfig); toast.success("Automatic settings applied.") }} className="btn-secondary text-sm flex items-center gap-2"><Wand2 className="w-4 h-4" /> Auto-configure</button>
            {sources.length > 0 && (
              <div className="relative">
                <Copy className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select className="input-field pl-9 w-auto text-sm" value="" onChange={e => e.target.value && copyFrom(Number(e.target.value))}>
                  <option value="">Copy from session…</option>
                  {sources.map(s => <option key={s.id} value={s.id}>{formatDateWithDay(s.exam_date)} · {s.session_type} — {s.cycleName}</option>)}
                </select>
              </div>
            )}
          </div>

          <section>
            <h4 className="text-sm font-semibold">Category order</h4>
            <p className="text-xs text-brand-textsec mb-2">Categories are seated in this order. Bench mates are always in different academic years.</p>
            <div className="space-y-1">
              {orderedCats.map((c, i) => (
                <div key={c.key} className={cn("flex items-center gap-2 text-xs border border-brand-border rounded-md px-2 py-1", !c.year && "bg-red-50")}>
                  <span className="flex-1 truncate" title={c.label}>{c.label}</span>
                  <span className="text-brand-textsec whitespace-nowrap">{c.boys} B · {c.girls} G</span>
                  <button title="Move up" disabled={i === 0} onClick={() => setConfig({ ...config, categoryOrder: move(orderedCats.map(x => x.key), i, -1) })} className="p-0.5 disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                  <button title="Move down" disabled={i === orderedCats.length - 1} onClick={() => setConfig({ ...config, categoryOrder: move(orderedCats.map(x => x.key), i, 1) })} className="p-0.5 disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold">Halls (filled in this order)</h4>
            <p className="text-xs text-brand-textsec mb-2">Quantity blank = as many as fit. The category limit counts department + year combinations.</p>
            <div className="space-y-2">
              {config.halls.map((h, i) => {
                const hall = hallOf(h.hallId)
                // Categories with students of the hall's group (any group, for a hall that may change).
                const forGroup = orderedCats.filter(c => (h.gender === "M" ? c.boys : h.gender === "F" ? c.girls : 0) > 0 || (!h.genderFixed && c.boys + c.girls > 0))
                const requested = h.categories.reduce((n, c) => n + (c.quantity ?? 0), 0)
                const def = hall.raw.default_max_categories
                return (
                  <div key={h.hallId} className={cn("border rounded-lg p-2.5", h.pattern ? "border-violet-300 bg-violet-50/40" : h.gender ? "border-brand-border" : "border-dashed border-gray-300 bg-gray-50")}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-brand-primary">{hall.hall_code}</span>
                      <span className="text-xs text-brand-textsec">{hall.benches} benches · {hall.benches * 2} seats</span>
                      <span className="ml-auto flex">
                        <button title="Move up" disabled={i === 0} onClick={() => setConfig({ ...config, halls: move(config.halls, i, -1) })} className="p-0.5 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                        <button title="Move down" disabled={i === config.halls.length - 1} onClick={() => setConfig({ ...config, halls: move(config.halls, i, 1) })} className="p-0.5 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <LayoutGrid className="w-3.5 h-3.5 text-brand-textsec shrink-0" />
                      <select className="input-field py-1 text-xs flex-1 min-w-0" title="Seat students by the boys/girls hall rules, or by a seating pattern you drew"
                        value={h.pattern ? (patterns.some(p => p.id === h.pattern!.id) ? String(h.pattern.id) : "own") : ""} onChange={e => choosePattern(h, e.target.value)}>
                        <option value="">Rules: boys' or girls' hall</option>
                        {patterns.map(p => <option key={p.id} value={String(p.id)}>Pattern: {p.name}</option>)}
                        {h.pattern && !patterns.some(p => p.id === h.pattern!.id) && <option value="own">Pattern: {h.pattern.name} (this session's copy)</option>}
                        <option value="new">+ New pattern…</option>
                      </select>
                      {h.pattern && (
                        <button title="Edit this pattern" onClick={() => setEditing({ pattern: h.pattern!, hallId: h.hallId })} className="p-1 rounded hover:bg-gray-100"><Pencil className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    {h.pattern ? (
                      <p className="text-[11px] text-brand-textsec mt-1.5">
                        Seats follow the pattern "{h.pattern.name}" ({h.pattern.rows} × {h.pattern.cols} benches, repeated to fill the hall). Boys and girls sit where the pattern puts them. This hall is filled before the halls that use the rules.
                      </p>
                    ) : <>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <div className="flex rounded-md border border-brand-border overflow-hidden text-xs">
                        {GENDER_OPTIONS.map(([g, label]) => (
                          <button key={label} onClick={() => setHall(h.hallId, { gender: (g || null) as Gender | null, genderFixed: true, categories: g && !h.categories.length ? orderedCats.map(c => ({ key: c.key, quantity: null })) : h.categories })}
                            className={cn("px-2.5 py-1", (h.gender ?? "") === g ? (g === "M" ? "bg-sky-600 text-white" : g === "F" ? "bg-pink-600 text-white" : "bg-gray-500 text-white") : "bg-white hover:bg-gray-50")}>{label}</button>
                        ))}
                      </div>
                      <label className="text-xs flex items-center gap-1 cursor-pointer" title="Fixed: the hall always holds this group. Not fixed: it may be given to the other group, or brought into use, when that seats more students.">
                        <input type="checkbox" className="accent-brand-primary" checked={h.genderFixed} onChange={e => setHall(h.hallId, { genderFixed: e.target.checked })} />
                        {h.genderFixed ? <Lock className="w-3 h-3" /> : <Shuffle className="w-3 h-3" />} Fixed
                      </label>
                      {h.gender && (
                        <label className="text-xs flex items-center gap-1">Max categories
                          <input type="number" min={1} step={1} className="input-field w-16 py-1 text-xs" placeholder={def ? String(def) : "No limit"} title={def ? `Hall default: ${def}` : "No hall default: no limit"}
                            value={h.maxCategories ?? ""} onChange={e => setHall(h.hallId, { maxCategories: e.target.value === "" ? null : Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
                        </label>
                      )}
                    </div>
                    {(h.gender || !h.genderFixed) && hall.benches > 0 && (
                      <div className="mt-2 space-y-1">
                        {!h.gender && <p className="text-[11px] text-brand-textsec">Used only if it seats more students. Categories it may hold:</p>}
                        {forGroup.length === 0 && <p className="text-xs text-brand-textsec">No selected {h.gender === "M" ? "boys" : "girls"}.</p>}
                        {forGroup.map(c => {
                          const sel = h.categories.find(x => x.key === c.key)
                          return (
                            <div key={c.key} className="flex items-center gap-2 text-xs">
                              <input type="checkbox" className="accent-brand-primary" checked={!!sel} onChange={e => toggleCat(h, c.key, e.target.checked)} />
                              <span className={cn("flex-1 truncate", !sel && "text-brand-textsec")} title={c.label}>{c.label}</span>
                              {sel && <input type="number" min={0} step={1} placeholder="All" className="input-field w-16 py-0.5 text-xs" value={sel.quantity ?? ""} onChange={e => setQty(h, c.key, e.target.value)} />}
                            </div>
                          )
                        })}
                        {requested > 0 && <p className={cn("text-[11px]", requested > hall.benches * 2 ? "text-red-600" : "text-brand-textsec")}>Requested {requested} of {hall.benches * 2} seats</p>}
                      </div>
                    )}
                    </>}
                    {(h.gender || h.pattern) && hall.benches === 0 && <p className="text-xs text-red-600 mt-2">No bench layout: set it in Master Data → Halls.</p>}
                  </div>
                )
              })}
            </div>
          </section>
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
          {plan?.groups && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(["M", "F"] as Gender[]).map(g => {
                const x = plan.groups[g]
                return (
                  <div key={g} className={cn("rounded-lg border px-3 py-2", g === "M" ? "border-sky-200 bg-sky-50" : "border-pink-200 bg-pink-50")}>
                    <b>{g === "M" ? "Boys" : "Girls"}</b>: {x.students} selected · {x.halls} hall{x.halls === 1 ? "" : "s"} with {x.seats} seats · <b>{x.seated}</b> seated
                    {x.unallocated > 0 && <span className="text-red-600"> · {x.unallocated} unallocated</span>}
                    {x.seats > x.seated && <span className="text-brand-textsec"> · {x.seats - x.seated} seats free</span>}
                  </div>
                )
              })}
            </div>
          )}
          {plan?.reassigned?.length > 0 && (
            <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-sm text-sky-900">
              <p className="font-semibold flex items-center gap-1.5"><Shuffle className="w-4 h-4" /> Halls moved to seat more students (their gender is not fixed)</p>
              {plan.reassigned.map((r: any) => <p key={r.hallId}>• {r.hall_code}: {r.from === "M" ? "Boys" : r.from === "F" ? "Girls" : "Not used"} → <b>{r.to === "M" ? "Boys" : r.to === "F" ? "Girls" : "Not used"}</b></p>)}
              <p className="text-xs mt-1">To keep a hall's group, tick Fixed on it.</p>
            </div>
          )}

          {errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Fix these before saving</p>
              {errors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}
          {errors.length === 0 && plan && <p className="text-xs text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Every mandatory rule is met: separate halls for boys and girls{plan.halls.some((h: any) => h.pattern) && " (except where a pattern mixes them)"}, at most two per bench, bench mates in different academic years, capacities, category limits and selections.</p>}
          {warnings.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 max-h-40 overflow-y-auto">
              {warnings.filter(w => !/to seat more students \(its gender is not fixed\)/.test(w)).map((w, i) => <p key={i}>• {w}</p>)}
            </div>
          )}

          {plan && (
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-brand-border">
                  <tr>{["Hall", "Group", "Benches", "Seats", "Occupied", "Empty", "Limit", "Categories (allocated / requested)"].map(t => <th key={t} className="text-left px-3 py-2 font-semibold text-brand-textsec uppercase tracking-wider whitespace-nowrap">{t}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-brand-border">
                  {plan.halls.map((h: any) => (
                    <tr key={h.hallId} onClick={() => h.occupied && setViewHallId(h.hallId)} className={cn("align-top", h.occupied && "cursor-pointer hover:bg-gray-50", viewHall?.id === h.hallId && "bg-brand-primary/5")}>
                      <td className="px-3 py-2 font-mono font-bold text-brand-primary">{h.hall_code}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {h.pattern ? <span className="text-violet-700">Pattern<div className="text-[10px] truncate max-w-[8rem]" title={h.pattern}>{h.pattern}</div></span>
                          : h.gender === "M" ? "Boys" : h.gender === "F" ? "Girls" : <span className="text-brand-textsec">Not used</span>}
                        {!h.pattern && h.gender !== h.configuredGender && <div className="text-[10px] text-sky-700">was {h.configuredGender === "M" ? "Boys" : h.configuredGender === "F" ? "Girls" : "Not used"}</div>}
                      </td>
                      <td className="px-3 py-2">{h.benches}</td>
                      <td className="px-3 py-2">{h.capacity}</td>
                      <td className="px-3 py-2 font-semibold">{h.occupied}</td>
                      <td className="px-3 py-2">{h.empty}</td>
                      <td className="px-3 py-2">{h.gender && !h.pattern ? h.maxCategories ?? "—" : ""}</td>
                      <td className="px-3 py-2">
                        {h.categories.filter((c: any) => c.actual > 0 || c.requested).map((c: any) => (
                          <div key={c.key} className={cn("whitespace-nowrap", c.requested !== null && c.actual !== c.requested && "text-amber-700")}>{catOf.get(c.key)?.label ?? c.label}: <b>{c.actual}</b>{c.requested !== null && <> / {c.requested}</>}</div>
                        ))}
                        {h.warnings.filter((w: string) => !/requested,/.test(w)).map((w: string, i: number) => <div key={i} className="text-amber-700">{w}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewHall && previewSeats(viewHall.id).length > 0 && <HallBenchGrid hall={viewHall} seats={previewSeats(viewHall.id)} colorOf={colorOf} />}

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

      {editing && (
        <SeatingPatternEditor pattern={editing.pattern} slots={patternSlots} onClose={() => setEditing(null)} onSaved={patternSaved}
          onDeleted={id => { setPatterns(list => list.filter(p => p.id !== id)); setEditing(null) }} />
      )}

      {confirmList && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-brand-border">
              <h3 className="text-base font-semibold flex items-center gap-2 text-red-700"><AlertTriangle className="w-5 h-5" /> {confirmList.length} student{confirmList.length === 1 ? "" : "s"} will not be seated</h3>
              <p className="text-xs text-brand-textsec mt-1">The seating rules are never relaxed to fit everyone. Saving keeps this list with the plan, to view and print from the Student Seating tab. To seat them, go back and add halls, permit their categories, or change the quantities.</p>
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
