/**
 * SEATING PATTERNS: a seat-by-seat plan the administrator draws for a hall and saves to use again.
 *
 * A pattern is a grid of benches (rows x columns, as seen from the front); each bench has a left and
 * a right seat, and each seat names who sits there: a department, an academic year and a gender
 * ("CSE – Second Year boys"), or nobody. Boys and girls may share a hall, and even a bench.
 *
 * The one rule a pattern keeps: two seats of a bench are never given the same academic year
 * (bench mates are always in different years, as everywhere else in seating).
 *
 * A pattern repeats to fit a hall of another size: hall bench (row, col) takes the pattern's bench
 * ((row-1) mod rows + 1, (col-1) mod cols + 1). The hall's removed benches are simply skipped.
 * Pure logic, shared by both builds and the screens.
 */
import { benchKey, MAX_BENCH_ROWS, MAX_BENCH_COLS } from "./hall-layout"
import type { Gender } from "./seating"

export interface PatternSlot { departmentId: number; deptCode: string; year: string; gender: Gender }
export interface PatternBench { L?: PatternSlot | null; R?: PatternSlot | null }
export interface SeatingPattern {
  id?: number
  name: string
  rows: number
  cols: number
  /** Benches by benchKey(row, col); a missing bench or seat is left empty. */
  cells: Record<string, PatternBench>
}

export const MAX_PATTERN_NAME = 60

/** The students a slot takes: one department, one academic year, one gender. */
export const slotKey = (s: PatternSlot) => `${s.departmentId}|${s.year}|${s.gender}`
export const slotLabel = (s: PatternSlot) => `${s.deptCode || "—"} – ${s.year} ${s.gender === "M" ? "boys" : "girls"}`
/** "CSE 2nd B": short enough for a seat on the grid. */
export function slotShort(s: PatternSlot): string {
  const y = s.year === "Final Year" ? "Final" : (s.year.match(/^(\w+) Year$/)?.[1] ?? s.year)
  const ord: Record<string, string> = { First: "1st", Second: "2nd", Third: "3rd", Fourth: "4th", Fifth: "5th", Sixth: "6th" }
  return `${s.deptCode || "—"} ${ord[y] ?? y} ${s.gender === "M" ? "B" : "G"}`
}

const whole = (v: unknown, min: number, max: number) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}

function cleanSlot(v: any): PatternSlot | null {
  if (!v || typeof v !== "object") return null
  const departmentId = Number(v.departmentId)
  if (!Number.isInteger(departmentId) || departmentId <= 0) return null
  if (v.gender !== "M" && v.gender !== "F") return null
  const year = String(v.year ?? "").trim()
  if (!year) return null
  return { departmentId, deptCode: String(v.deptCode ?? ""), year, gender: v.gender }
}

/** A pattern as saved or received, cleaned: sizes within limits, benches outside the grid and unreadable seats dropped. */
export function normalizePattern(raw: any): SeatingPattern | null {
  if (!raw || typeof raw !== "object") return null
  const rows = whole(raw.rows, 1, MAX_BENCH_ROWS), cols = whole(raw.cols, 1, MAX_BENCH_COLS)
  const cells: Record<string, PatternBench> = {}
  for (const [k, b] of Object.entries(raw.cells ?? {})) {
    const [r, c] = k.split("-").map(Number)
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || r > rows || c < 1 || c > cols) continue
    const L = cleanSlot((b as any)?.L), R = cleanSlot((b as any)?.R)
    if (L || R) cells[benchKey(r, c)] = { L, R }
  }
  const id = Number(raw.id)
  return { ...(Number.isInteger(id) && id > 0 ? { id } : {}), name: String(raw.name ?? "").trim().replace(/\s+/g, " "), rows, cols, cells }
}

/** The problem that stops a pattern from being saved or used, or null. */
export function validatePattern(p: SeatingPattern | null): string | null {
  if (!p) return "The pattern could not be read."
  if (!p.name.trim()) return "Give the pattern a name."
  if (p.name.length > MAX_PATTERN_NAME) return `The pattern name can have at most ${MAX_PATTERN_NAME} characters.`
  const benches = Object.entries(p.cells)
  if (!benches.some(([, b]) => b.L || b.R)) return "The pattern has no seats filled in. Choose a department and tap the seats."
  for (const [k, b] of benches) {
    if (b.L && b.R && b.L.year === b.R.year) {
      const [r, c] = k.split("-")
      return `Row ${r}, column ${c}: both seats are ${b.L.year}. Bench mates must be in different academic years.`
    }
  }
  return null
}

/** Who sits in a seat of a hall bench under the pattern (repeated to fit), or null for an empty seat. */
export function patternSlotAt(p: SeatingPattern, row: number, col: number, seat: "L" | "R"): PatternSlot | null {
  const r = ((row - 1) % p.rows) + 1, c = ((col - 1) % p.cols) + 1
  return p.cells[benchKey(r, c)]?.[seat] ?? null
}

/** Whether two slots take the same students. */
export const sameSlot = (a: PatternSlot | null | undefined, b: PatternSlot | null | undefined) => !!a && !!b && slotKey(a) === slotKey(b)
