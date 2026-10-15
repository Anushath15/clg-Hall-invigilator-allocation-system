/**
 * A hall's benches for student seating: a grid of rows (row 1 at the front, by the board) and
 * columns (column 1 on the left as seen from the front), with some positions switched off where
 * the room has no bench (a short column, a pillar, the door). Each position holds a bench (two
 * students, left and right seat) or a chair (one student); `kinds` lists the chairs.
 *
 * Benches are numbered column by column, front to back: column 1 rows 1..n, then column 2, and so
 * on, skipping the switched-off positions. The seating plan and every printout use that numbering.
 * Pure logic, shared by the desktop and web builds and the screens.
 */

export const MAX_BENCH_ROWS = 30
export const MAX_BENCH_COLS = 20

/** What stands at a seating position: a two-seat bench or a single chair. */
export type SeatKind = "bench" | "chair"
export const SEAT_KINDS: SeatKind[] = ["bench", "chair"]
export const SEAT_KIND_LABEL: Record<SeatKind, string> = { bench: "Bench", chair: "Chair" }
/** Students one position seats: two on a bench, one on a chair. */
export const SEATS_PER: Record<SeatKind, 1 | 2> = { bench: 2, chair: 1 }

export interface HallLayout { rows: number; cols: number; disabled: string[]; kinds?: Record<string, SeatKind> }
/** One seating position. `seats` 2: left and right seat; 1: only the "L" seat. */
export interface Bench { row: number; col: number; benchNo: number; kind: SeatKind; seats: 1 | 2 }

/** The key of one bench position in `disabled`: "row-col", both from 1. */
export const benchKey = (row: number, col: number) => `${row}-${col}`

/** The switched-off positions as saved in halls.disabled_benches (JSON); anything unreadable counts as none. */
export function parseDisabledBenches(text: unknown): string[] {
  if (Array.isArray(text)) return text.map(String)
  try {
    const v = JSON.parse(String(text ?? "[]"))
    return Array.isArray(v) ? v.map(String) : []
  } catch { return [] }
}

/** The chairs as saved in halls.seat_kinds (JSON {"row-col": "chair"}); anything unreadable counts as none. A "desk" (chair + table, no longer offered) reads as a chair. */
export function parseSeatKinds(text: unknown): Record<string, SeatKind> {
  let v: unknown = text
  if (typeof text !== "object" || text === null) {
    try { v = JSON.parse(String(text ?? "{}")) } catch { return {} }
  }
  const out: Record<string, SeatKind> = {}
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, kind] of Object.entries(v)) if (kind === "chair" || kind === "desk") out[String(k)] = "chair"
  }
  return out
}

/** A hall row from the database (bench_rows, bench_cols, disabled_benches, seat_kinds) as a layout. */
export function hallLayout(h: { bench_rows?: unknown; bench_cols?: unknown; disabled_benches?: unknown; seat_kinds?: unknown }): HallLayout {
  return { rows: Number(h.bench_rows) || 0, cols: Number(h.bench_cols) || 0, disabled: parseDisabledBenches(h.disabled_benches), kinds: parseSeatKinds(h.seat_kinds) }
}

/** What stands at a position (a bench unless `kinds` says otherwise). */
export const kindAt = (layout: HallLayout, row: number, col: number): SeatKind => layout.kinds?.[benchKey(row, col)] ?? "bench"

/** The benches that exist, in seating order (column by column, front to back), numbered from 1. */
export function enabledBenches(layout: HallLayout): Bench[] {
  const off = new Set(layout.disabled)
  const benches: Bench[] = []
  for (let col = 1; col <= layout.cols; col++) {
    for (let row = 1; row <= layout.rows; row++) {
      if (off.has(benchKey(row, col))) continue
      const kind = kindAt(layout, row, col)
      benches.push({ row, col, benchNo: benches.length + 1, kind, seats: SEATS_PER[kind] })
    }
  }
  return benches
}

export const benchCount = (layout: HallLayout) => enabledBenches(layout).length
/** Students the hall seats: two per bench, one per chair. */
export const seatCount = (layout: HallLayout) => enabledBenches(layout).reduce((n, b) => n + b.seats, 0)
/** How many positions of each kind the hall has. */
export function kindCounts(layout: HallLayout): Record<SeatKind, number> {
  const out: Record<SeatKind, number> = { bench: 0, chair: 0 }
  for (const b of enabledBenches(layout)) out[b.kind]++
  return out
}
/** "30 benches, 10 chairs" — the kinds a hall has, for summaries. */
export function kindSummary(layout: HallLayout): string {
  const c = kindCounts(layout)
  const word: Record<SeatKind, [string, string]> = { bench: ["bench", "benches"], chair: ["chair", "chairs"] }
  return SEAT_KINDS.filter(k => c[k] > 0).map(k => `${c[k]} ${word[k][c[k] === 1 ? 0 : 1]}`).join(", ") || "0 benches"
}

/** The switched-off positions that lie inside the grid, sorted (positions outside a shrunk grid are dropped). */
export function cleanDisabled(layout: HallLayout): string[] {
  const inside = new Set<string>()
  for (const k of layout.disabled) {
    const [r, c] = k.split("-").map(Number)
    if (Number.isInteger(r) && Number.isInteger(c) && r >= 1 && r <= layout.rows && c >= 1 && c <= layout.cols) inside.add(benchKey(r, c))
  }
  return [...inside].sort((a, b) => {
    const [ar, ac] = a.split("-").map(Number), [br, bc] = b.split("-").map(Number)
    return ac - bc || ar - br
  })
}

/** The non-bench positions that lie inside the grid and are not switched off. */
export function cleanKinds(layout: HallLayout): Record<string, SeatKind> {
  const off = new Set(layout.disabled), out: Record<string, SeatKind> = {}
  for (const [k, kind] of Object.entries(parseSeatKinds(layout.kinds ?? {}))) {
    const [r, c] = k.split("-").map(Number)
    if (r >= 1 && r <= layout.rows && c >= 1 && c <= layout.cols && !off.has(benchKey(r, c))) out[benchKey(r, c)] = kind
  }
  return out
}

/** Rows and columns: whole numbers within the limits, both set or both 0 (no layout). */
export function validateHallLayout(rows: unknown, cols: unknown): string | null {
  const r = Number(rows ?? 0), c = Number(cols ?? 0)
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return "Bench rows and columns must be whole numbers."
  if (r > MAX_BENCH_ROWS) return `A hall can have at most ${MAX_BENCH_ROWS} bench rows.`
  if (c > MAX_BENCH_COLS) return `A hall can have at most ${MAX_BENCH_COLS} bench columns.`
  if ((r === 0) !== (c === 0)) return "Enter both the number of bench rows and columns (or leave both 0)."
  return null
}
