import { useMemo, useState } from "react"
import { benchKey, enabledBenches, SEAT_KINDS, SEAT_KIND_LABEL, type SeatKind } from "../../../shared/hall-layout"
import { cn } from "../lib/utils"

interface Props {
  rows: number
  cols: number
  disabled: string[]
  /** Positions that are chairs (one student) instead of benches. */
  kinds: Record<string, SeatKind>
  onChange: (disabled: string[], kinds: Record<string, SeatKind>) => void
}

type Tool = SeatKind | "remove"

const KIND_STYLE: Record<SeatKind, string> = {
  bench: "border-brand-primary bg-brand-verylight text-brand-primary",
  chair: "border-amber-500 bg-amber-50 text-amber-700"
}
const KIND_HINT: Record<SeatKind, string> = { bench: "2 students", chair: "1 student" }
// The letter shown on a position beside its number: no letter for a bench.
const KIND_MARK: Record<SeatKind, string> = { bench: "", chair: "C" }

/**
 * The hall's seating grid as seen from the front (the board at the top). Pick a tool — Bench,
 * Chair or No seat — and tap positions to set them; tap a column or row heading to
 * set the whole line. Positions are numbered column by column, front to back, the order students
 * are seated in.
 */
export default function BenchLayoutEditor({ rows, cols, disabled, kinds, onChange }: Props) {
  const [tool, setTool] = useState<Tool>("remove")
  const off = useMemo(() => new Set(disabled), [disabled])
  const numbers = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of enabledBenches({ rows, cols, disabled })) m.set(benchKey(b.row, b.col), b.benchNo)
    return m
  }, [rows, cols, disabled])

  const apply = (keys: string[]) => {
    const nextOff = new Set(off), nextKinds = { ...kinds }
    if (tool === "remove") {
      // A line with any seat present is cleared; a fully removed line comes back.
      const anyOn = keys.some(k => !off.has(k))
      for (const k of keys) anyOn ? nextOff.add(k) : nextOff.delete(k)
    } else {
      for (const k of keys) {
        nextOff.delete(k)
        if (tool === "bench") delete nextKinds[k]; else nextKinds[k] = tool
      }
    }
    onChange([...nextOff], nextKinds)
  }
  const fillAll = (kind: SeatKind) => {
    const all: Record<string, SeatKind> = {}
    if (kind !== "bench") for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) all[benchKey(r, c)] = kind
    onChange(disabled, all)
  }
  const colKeys = (c: number) => Array.from({ length: rows }, (_, i) => benchKey(i + 1, c))
  const rowKeys = (r: number) => Array.from({ length: cols }, (_, i) => benchKey(r, i + 1))
  const toolName = tool === "remove" ? "remove or restore" : `make ${SEAT_KIND_LABEL[tool].toLowerCase()}`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-xs text-brand-textsec mr-1">Tap to place:</span>
        {SEAT_KINDS.map(k => (
          <button key={k} type="button" onClick={() => setTool(k)}
            className={cn("px-2 py-1 rounded-md text-xs font-semibold border", KIND_STYLE[k], tool === k ? "ring-2 ring-offset-1 ring-brand-primary" : "opacity-70 hover:opacity-100")}>
            {SEAT_KIND_LABEL[k]} <span className="font-normal">({KIND_HINT[k]})</span>
          </button>
        ))}
        <button type="button" onClick={() => setTool("remove")}
          className={cn("px-2 py-1 rounded-md text-xs font-semibold border border-dashed border-gray-400 text-gray-700 bg-white", tool === "remove" ? "ring-2 ring-offset-1 ring-brand-primary" : "opacity-70 hover:opacity-100")}>
          No seat ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs text-brand-textsec">
        Whole hall:
        {SEAT_KINDS.map(k => (
          <button key={k} type="button" onClick={() => fillAll(k)} className="underline hover:text-brand-primary">all {SEAT_KIND_LABEL[k].toLowerCase()}{k === "bench" ? "es" : "s"}</button>
        ))}
      </div>
      <div className="text-center text-[13px] font-semibold tracking-widest uppercase bg-gray-700 text-white rounded-md py-1 mb-2">
        Front · Board
      </div>
      <div className="overflow-auto max-h-[45vh]">
        <div className="grid gap-1 w-max mx-auto" style={{ gridTemplateColumns: `auto repeat(${cols}, 3rem)` }}>
          <div />
          {Array.from({ length: cols }, (_, i) => (
            <button key={`c${i}`} type="button" onClick={() => apply(colKeys(i + 1))} title={`${toolName} all of column ${i + 1}`}
              className="text-[12px] font-semibold text-brand-textsec hover:text-brand-primary py-0.5">C{i + 1}</button>
          ))}
          {Array.from({ length: rows }, (_, r) => (
            <div key={`r${r}`} className="contents">
              <button type="button" onClick={() => apply(rowKeys(r + 1))} title={`${toolName} all of row ${r + 1}`}
                className="text-[12px] font-semibold text-brand-textsec hover:text-brand-primary pr-1 text-right">R{r + 1}</button>
              {Array.from({ length: cols }, (_, c) => {
                const k = benchKey(r + 1, c + 1)
                const isOff = off.has(k)
                const kind = kinds[k] ?? "bench"
                return (
                  <button key={k} type="button" onClick={() => apply([k])}
                    title={isOff ? `No seat at row ${r + 1}, column ${c + 1}` : `${SEAT_KIND_LABEL[kind]} ${numbers.get(k)} (row ${r + 1}, column ${c + 1})`}
                    className={cn("h-8 rounded-md text-[13px] font-semibold border transition-colors",
                      isOff ? "border-dashed border-gray-300 bg-white text-gray-300 hover:border-gray-400"
                        : cn(KIND_STYLE[kind], "hover:brightness-95"))}>
                    {isOff ? "×" : <>{numbers.get(k)}{KIND_MARK[kind] && <sup className="ml-0.5 text-[11px]">{KIND_MARK[kind]}</sup>}</>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
