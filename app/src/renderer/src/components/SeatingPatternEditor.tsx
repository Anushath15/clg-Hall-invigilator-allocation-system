import { useMemo, useState } from "react"
import { X, Eraser, Trash2, RefreshCw, ArrowLeftToLine, ArrowRightToLine } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { cn } from "../lib/utils"
import { benchKey, MAX_BENCH_ROWS, MAX_BENCH_COLS } from "../../../shared/hall-layout"
import {
  normalizePattern, validatePattern, slotKey, slotLabel, slotShort, sameSlot, MAX_PATTERN_NAME,
  type SeatingPattern, type PatternSlot, type PatternBench
} from "../../../shared/seating-pattern"

// One colour per department + year on the grid; boys and girls are told apart by the edge colour.
const SLOT_COLORS = [
  "bg-sky-100 text-sky-900", "bg-amber-100 text-amber-900", "bg-emerald-100 text-emerald-900", "bg-violet-100 text-violet-900",
  "bg-rose-100 text-rose-900", "bg-lime-100 text-lime-900", "bg-cyan-100 text-cyan-900", "bg-orange-100 text-orange-900",
  "bg-fuchsia-100 text-fuchsia-900", "bg-teal-100 text-teal-900", "bg-indigo-100 text-indigo-900", "bg-yellow-100 text-yellow-900"
]
const genderEdge = (s: PatternSlot) => (s.gender === "M" ? "border-l-4 border-l-sky-600" : "border-l-4 border-l-pink-600")

interface Props {
  pattern: SeatingPattern
  /** The seats that can be drawn: department + academic year + gender, with how many such students are selected. */
  slots: { slot: PatternSlot; students: number }[]
  onClose: () => void
  onSaved: (pattern: SeatingPattern) => void
  onDeleted: (id: number) => void
}

/**
 * Draw a seating pattern: choose who sits in a seat (department, academic year, boys or girls) and
 * tap the seats on the bench grid. The pattern is saved by name to use again in any session, and
 * repeats to fill a bigger hall. Bench mates must be in different academic years.
 */
export default function SeatingPatternEditor({ pattern, slots, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(pattern.name)
  const [rows, setRows] = useState(pattern.rows)
  const [cols, setCols] = useState(pattern.cols)
  const [cells, setCells] = useState<Record<string, PatternBench>>(pattern.cells)
  const [brush, setBrush] = useState<PatternSlot | null>(slots[0]?.slot ?? null)
  const [saving, setSaving] = useState(false)

  // Every slot that can be drawn, plus any the pattern already uses (e.g. a year not selected this time).
  const palette = useMemo(() => {
    const list = [...slots]
    for (const b of Object.values(pattern.cells)) for (const s of [b.L, b.R]) if (s && !list.some(x => sameSlot(x.slot, s))) list.push({ slot: s, students: 0 })
    return list
  }, [slots, pattern])
  const colorOf = useMemo(() => {
    const groups = [...new Set(palette.map(p => `${p.slot.departmentId}|${p.slot.year}`))]
    return (s: PatternSlot) => SLOT_COLORS[groups.indexOf(`${s.departmentId}|${s.year}`) % SLOT_COLORS.length]
  }, [palette])

  const current = (): SeatingPattern => normalizePattern({ id: pattern.id, name, rows, cols, cells })!
  const used = useMemo(() => {
    const n = new Map<string, number>()
    const p = normalizePattern({ name: "x", rows, cols, cells })!
    for (const b of Object.values(p.cells)) for (const s of [b.L, b.R]) if (s) n.set(slotKey(s), (n.get(slotKey(s)) ?? 0) + 1)
    return n
  }, [rows, cols, cells])

  /** The bench with one seat set to the brush, or the reason it cannot be. */
  const paint = (bench: PatternBench | undefined, side: "L" | "R"): PatternBench | string => {
    const other = bench?.[side === "L" ? "R" : "L"]
    if (brush && other && other.year === brush.year) return `Bench mates must be in different academic years: the ${side === "L" ? "right" : "left"} seat is already ${other.year}.`
    return { ...bench, [side]: brush }
  }
  const tapSeat = (r: number, c: number, side: "L" | "R") => {
    const k = benchKey(r, c)
    const next = paint(cells[k], side)
    if (typeof next === "string") { toast.error(next); return }
    // Tapping a seat that already has the brush clears it.
    if (brush && sameSlot(cells[k]?.[side], brush)) { setCells({ ...cells, [k]: { ...cells[k], [side]: null } }); return }
    setCells({ ...cells, [k]: next })
  }
  const fillSide = (side: "L" | "R") => {
    const next = { ...cells }
    let skipped = 0
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) {
      const b = paint(next[benchKey(r, c)], side)
      if (typeof b === "string") skipped++
      else next[benchKey(r, c)] = b
    }
    setCells(next)
    if (skipped) toast(`${skipped} bench${skipped === 1 ? " was" : "es were"} skipped: the other seat is the same academic year.`)
  }

  async function save() {
    const p = current()
    const problem = validatePattern(p)
    if (problem) { toast.error(problem); return }
    setSaving(true)
    try {
      const r = await api.saveSeatingPattern(p)
      if (!r.success) { toast.error(r.error); return }
      toast.success(`Pattern "${r.pattern.name}" saved.`)
      onSaved(r.pattern)
    } finally { setSaving(false) }
  }

  async function remove() {
    if (!pattern.id || !confirm(`Delete the pattern "${pattern.name}"? Sessions that already use it keep their own copy.`)) return
    await api.deleteSeatingPattern(pattern.id)
    toast.success("Pattern deleted.")
    onDeleted(pattern.id)
  }

  const size = (v: string, max: number) => Math.min(max, Math.max(1, Math.floor(Number(v) || 1)))

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-brand-border">
          <div>
            <h3 className="text-base font-semibold">{pattern.id ? "Edit Seating Pattern" : "New Seating Pattern"}</h3>
            <p className="text-xs text-brand-textsec">Choose who sits in a seat, then tap the seats. The pattern repeats to fill a bigger hall; removed benches are skipped.</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {/* Name, size and the seat brushes */}
          <div className="overflow-y-auto border-b lg:border-b-0 lg:border-r border-brand-border p-4 space-y-4">
            <label className="block text-sm">
              <span className="font-semibold">Pattern name</span>
              <input className="input-field mt-1" maxLength={MAX_PATTERN_NAME} placeholder="e.g. CSE + MECH alternate" value={name} onChange={e => setName(e.target.value)} />
            </label>
            <div className="flex gap-3 text-sm">
              <label className="flex-1"><span className="font-semibold">Rows</span>
                <input type="number" min={1} max={MAX_BENCH_ROWS} className="input-field mt-1" value={rows} onChange={e => setRows(size(e.target.value, MAX_BENCH_ROWS))} />
              </label>
              <label className="flex-1"><span className="font-semibold">Columns</span>
                <input type="number" min={1} max={MAX_BENCH_COLS} className="input-field mt-1" value={cols} onChange={e => setCols(size(e.target.value, MAX_BENCH_COLS))} />
              </label>
            </div>
            <p className="text-[11px] text-brand-textsec -mt-2">Tip: draw just 2 rows (e.g. boys then girls) and they repeat down the hall.</p>

            <section>
              <h4 className="text-sm font-semibold mb-1">Who sits here</h4>
              <div className="space-y-1">
                {palette.map(({ slot, students }) => {
                  const on = sameSlot(brush, slot)
                  return (
                    <button key={slotKey(slot)} onClick={() => setBrush(slot)}
                      className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left", colorOf(slot), genderEdge(slot), on ? "ring-2 ring-brand-primary font-semibold" : "opacity-80 hover:opacity-100")}>
                      <span className="flex-1 truncate">{slotLabel(slot)}</span>
                      <span className="whitespace-nowrap text-[10px]">{used.get(slotKey(slot)) ?? 0} seats · {students} selected</span>
                    </button>
                  )
                })}
                {palette.length === 0 && <p className="text-xs text-brand-textsec">No selected students with a department and academic year.</p>}
                <button onClick={() => setBrush(null)}
                  className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs border border-dashed border-gray-300", brush === null ? "ring-2 ring-brand-primary font-semibold" : "hover:bg-gray-50")}>
                  <Eraser className="w-3.5 h-3.5" /> Empty seat
                </button>
              </div>
            </section>

            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Quick fill with the chosen seat</h4>
              <div className="flex gap-2">
                <button onClick={() => fillSide("L")} className="btn-secondary text-xs flex-1 flex items-center justify-center gap-1"><ArrowLeftToLine className="w-3.5 h-3.5" /> All left seats</button>
                <button onClick={() => fillSide("R")} className="btn-secondary text-xs flex-1 flex items-center justify-center gap-1"><ArrowRightToLine className="w-3.5 h-3.5" /> All right seats</button>
              </div>
              <button onClick={() => setCells({})} className="btn-secondary text-xs w-full">Clear all seats</button>
            </section>
          </div>

          {/* The bench grid */}
          <div className="overflow-auto p-4 bg-gray-50/50">
            <div className="text-center text-[11px] font-semibold tracking-widest uppercase bg-gray-700 text-white rounded-md py-1 mb-2">Front · Board</div>
            <div className="grid gap-1.5 w-max mx-auto" style={{ gridTemplateColumns: `auto repeat(${cols}, 9.5rem)` }}>
              <div />
              {Array.from({ length: cols }, (_, c) => <div key={c} className="text-[10px] font-semibold text-brand-textsec text-center">C{c + 1}</div>)}
              {Array.from({ length: rows }, (_, r) => (
                <div key={r} className="contents">
                  <div className="text-[10px] font-semibold text-brand-textsec self-center pr-1">R{r + 1}</div>
                  {Array.from({ length: cols }, (_, c) => {
                    const b = cells[benchKey(r + 1, c + 1)]
                    return (
                      <div key={c} className="rounded-md border border-brand-border p-1 bg-white grid grid-cols-2 gap-1">
                        {(["L", "R"] as const).map(side => {
                          const s = b?.[side]
                          return (
                            <button key={side} onClick={() => tapSeat(r + 1, c + 1, side)} title={s ? `${side === "L" ? "Left" : "Right"} seat: ${slotLabel(s)}` : `${side === "L" ? "Left" : "Right"} seat: empty`}
                              className={cn("h-9 rounded px-1 text-[10px] font-semibold truncate", s ? cn(colorOf(s), genderEdge(s)) : "border border-dashed border-gray-300 text-gray-300 hover:border-brand-primary")}>
                              {s ? slotShort(s) : side}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-brand-textsec text-center mt-3">Left edge: blue = boys, pink = girls. Tap a filled seat with the same choice to empty it.</p>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-brand-border flex flex-wrap items-center justify-between gap-3">
          <div>{pattern.id && <button onClick={remove} className="btn-secondary text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="w-4 h-4" /> Delete pattern</button>}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">{saving && <RefreshCw className="w-4 h-4 animate-spin" />} Save pattern</button>
          </div>
        </div>
      </div>
    </div>
  )
}
