import { cn } from "../lib/utils"
import { hallLayout, benchKey, enabledBenches, SEAT_KIND_LABEL, type Bench } from "../../../shared/hall-layout"
import { groupLabel, seatsGroup, type SeatRow } from "../lib/export-seating-pdf"

// Class colours on the bench grid (by the class's place in the list given).
const CLASS_COLORS = [
  "bg-sky-100 text-sky-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800", "bg-rose-100 text-rose-800", "bg-slate-200 text-slate-800",
  "bg-lime-100 text-lime-800", "bg-orange-100 text-orange-800", "bg-cyan-100 text-cyan-800",
  "bg-fuchsia-100 text-fuchsia-800", "bg-yellow-100 text-yellow-800", "bg-teal-100 text-teal-800"
]

/** The colour key of a seated student: their class (department and year), else year, else batch. */
export const colorKey = (s: Pick<SeatRow, "category" | "year" | "batch">) => s.category || s.year || s.batch

/** A colour picker for a list of keys (classes), stable for the list given. */
export function classColors(keys: string[]) {
  const order = [...new Set(keys)].sort()
  return (key: string) => CLASS_COLORS[Math.max(0, order.indexOf(key)) % CLASS_COLORS.length]
}

interface Props {
  hall: { hall_code: string; raw: any; invigilators?: string[] }
  seats: SeatRow[]
  colorOf: (key: string) => string
  highlight?: number[]
}

/** One hall's benches as seen from the front, each with its left and right seat (a chair: its one seat). */
export default function HallBenchGrid({ hall, seats, colorOf, highlight = [] }: Props) {
  const layout = hallLayout(hall.raw)
  const numbers = new Map<string, Bench>(enabledBenches(layout).map(b => [benchKey(b.row, b.col), b]))
  const at = new Map<string, { L?: SeatRow; R?: SeatRow }>()
  for (const s of seats) {
    const k = benchKey(s.bench_row, s.bench_col)
    at.set(k, { ...at.get(k), [s.seat]: s })
  }
  // In a hall whose bench pattern seats boys and girls, each seat shows whose it is.
  const mixed = seatsGroup(seats) === "mixed"
  const seatCell = (s?: SeatRow) => s
    ? <div title={`${s.roll_no} · ${s.studentName} · ${s.deptCode ?? ""} ${s.year ?? ""} · ${s.batch}`}
        className={cn("rounded px-1 py-0.5 font-mono text-[10px] font-semibold truncate", colorOf(colorKey(s)), mixed && (s.gender === "F" ? "border-l-4 border-pink-500" : "border-l-4 border-sky-500"), highlight.includes(s.studentId) && "ring-2 ring-red-500")}>{s.roll_no}</div>
    : <div className="rounded px-1 py-0.5 text-[10px] text-gray-300 border border-dashed border-gray-200">empty</div>

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3 className="font-semibold">Hall {hall.hall_code} <span className="text-sm font-normal text-brand-textsec">· {groupLabel(seatsGroup(seats))} · {seats.length} students{hall.invigilators?.length ? ` · ${hall.invigilators.join(", ")}` : ""}</span></h3>
        <p className="text-xs text-brand-textsec">Each bench: number, left seat, right seat (as seen from the front); a chair has one seat. Colour = academic year.{mixed && " Left edge: blue = boy, pink = girl."}</p>
      </div>
      <div className="text-center text-[11px] font-semibold tracking-widest uppercase bg-gray-700 text-white rounded-md py-1 mb-2">Front · Board</div>
      <div className="overflow-x-auto">
        <div className="grid gap-1.5 w-max mx-auto" style={{ gridTemplateColumns: `auto repeat(${layout.cols}, 7.5rem)` }}>
          <div />
          {Array.from({ length: layout.cols }, (_, c) => <div key={c} className="text-[10px] font-semibold text-brand-textsec text-center">Column {c + 1}</div>)}
          {Array.from({ length: layout.rows }, (_, r) => (
            <div key={r} className="contents">
              <div className="text-[10px] font-semibold text-brand-textsec self-center pr-1">R{r + 1}</div>
              {Array.from({ length: layout.cols }, (_, c) => {
                const k = benchKey(r + 1, c + 1)
                const bench = numbers.get(k)
                if (bench === undefined) return <div key={k} className="rounded-md bg-gray-50" />
                const b = at.get(k)
                return (
                  <div key={k} className={cn("rounded-md border p-1 bg-white", bench.seats === 1 ? "border-amber-300" : "border-brand-border")}>
                    <div className="text-[9px] text-brand-textsec mb-0.5">{SEAT_KIND_LABEL[bench.kind]} {bench.benchNo}</div>
                    {bench.seats === 2
                      ? <div className="grid grid-cols-2 gap-1">{seatCell(b?.L)}{seatCell(b?.R)}</div>
                      : <div className="w-1/2 mx-auto">{seatCell(b?.L)}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
