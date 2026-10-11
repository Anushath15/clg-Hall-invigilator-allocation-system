/**
 * A hall's benches for student seating: a grid of rows (row 1 at the front, by the board) and
 * columns (column 1 on the left as seen from the front), with some positions switched off where
 * the room has no bench (a short column, a pillar, the door). Each bench seats two students.
 *
 * Benches are numbered column by column, front to back: column 1 rows 1..n, then column 2, and so
 * on, skipping the switched-off positions. The seating plan and every printout use that numbering.
 * Pure logic, shared by the desktop and web builds and the screens.
 */

export const MAX_BENCH_ROWS = 30
export const MAX_BENCH_COLS = 20
/** Most distinct student categories a hall's default category limit may allow. */
export const MAX_HALL_CATEGORIES = 50

export interface HallLayout { rows: number; cols: number; disabled: string[] }
export interface Bench { row: number; col: number; benchNo: number }

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

/** A hall row from the database (bench_rows, bench_cols, disabled_benches) as a layout. */
export function hallLayout(h: { bench_rows?: unknown; bench_cols?: unknown; disabled_benches?: unknown }): HallLayout {
  return { rows: Number(h.bench_rows) || 0, cols: Number(h.bench_cols) || 0, disabled: parseDisabledBenches(h.disabled_benches) }
}

/** The benches that exist, in seating order (column by column, front to back), numbered from 1. */
export function enabledBenches(layout: HallLayout): Bench[] {
  const off = new Set(layout.disabled)
  const benches: Bench[] = []
  for (let col = 1; col <= layout.cols; col++) {
    for (let row = 1; row <= layout.rows; row++) {
      if (!off.has(benchKey(row, col))) benches.push({ row, col, benchNo: benches.length + 1 })
    }
  }
  return benches
}

export const benchCount = (layout: HallLayout) => enabledBenches(layout).length

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

/** Rows and columns: whole numbers within the limits, both set or both 0 (no layout). */
export function validateHallLayout(rows: unknown, cols: unknown): string | null {
  const r = Number(rows ?? 0), c = Number(cols ?? 0)
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return "Bench rows and columns must be whole numbers."
  if (r > MAX_BENCH_ROWS) return `A hall can have at most ${MAX_BENCH_ROWS} bench rows.`
  if (c > MAX_BENCH_COLS) return `A hall can have at most ${MAX_BENCH_COLS} bench columns.`
  if ((r === 0) !== (c === 0)) return "Enter both the number of bench rows and columns (or leave both 0)."
  return null
}
