import { useMemo } from "react"
import { benchKey, enabledBenches } from "../../../shared/hall-layout"
import { cn } from "../lib/utils"

interface Props {
  rows: number
  cols: number
  disabled: string[]
  onChange: (disabled: string[]) => void
}

/**
 * The hall's bench grid as seen from the front (the board at the top). Tap a bench to remove it
 * (no bench at that place) or bring it back; tap a column or row heading to toggle the whole line.
 * Benches are numbered column by column, front to back, the order students are seated in.
 */
export default function BenchLayoutEditor({ rows, cols, disabled, onChange }: Props) {
  const off = useMemo(() => new Set(disabled), [disabled])
  const numbers = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of enabledBenches({ rows, cols, disabled })) m.set(benchKey(b.row, b.col), b.benchNo)
    return m
  }, [rows, cols, disabled])

  const toggle = (keys: string[]) => {
    // A line with any bench present is cleared; a fully removed line comes back.
    const anyOn = keys.some(k => !off.has(k))
    const next = new Set(off)
    for (const k of keys) anyOn ? next.add(k) : next.delete(k)
    onChange([...next])
  }
  const colKeys = (c: number) => Array.from({ length: rows }, (_, i) => benchKey(i + 1, c))
  const rowKeys = (r: number) => Array.from({ length: cols }, (_, i) => benchKey(r, i + 1))

  return (
    <div>
      <div className="text-center text-[11px] font-semibold tracking-widest uppercase bg-gray-700 text-white rounded-md py-1 mb-2">
        Front · Board
      </div>
      <div className="overflow-auto max-h-[45vh]">
        <div className="grid gap-1 w-max mx-auto" style={{ gridTemplateColumns: `auto repeat(${cols}, 3rem)` }}>
          <div />
          {Array.from({ length: cols }, (_, i) => (
            <button key={`c${i}`} type="button" onClick={() => toggle(colKeys(i + 1))} title={`Remove or restore all of column ${i + 1}`}
              className="text-[10px] font-semibold text-brand-textsec hover:text-brand-primary py-0.5">C{i + 1}</button>
          ))}
          {Array.from({ length: rows }, (_, r) => (
            <div key={`r${r}`} className="contents">
              <button type="button" onClick={() => toggle(rowKeys(r + 1))} title={`Remove or restore all of row ${r + 1}`}
                className="text-[10px] font-semibold text-brand-textsec hover:text-brand-primary pr-1 text-right">R{r + 1}</button>
              {Array.from({ length: cols }, (_, c) => {
                const k = benchKey(r + 1, c + 1)
                const isOff = off.has(k)
                return (
                  <button key={k} type="button" onClick={() => toggle([k])}
                    title={isOff ? `No bench at row ${r + 1}, column ${c + 1} — tap to add it` : `Bench ${numbers.get(k)} (row ${r + 1}, column ${c + 1}) — tap to remove it`}
                    className={cn("h-8 rounded-md text-[11px] font-semibold border transition-colors",
                      isOff ? "border-dashed border-gray-300 bg-white text-gray-300 hover:border-gray-400"
                        : "border-brand-primary bg-brand-verylight text-brand-primary hover:bg-brand-primary hover:text-white")}>
                    {isOff ? "×" : numbers.get(k)}
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
