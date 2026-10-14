/**
 * STUDENT SEATING for one exam session (pure logic, no database access).
 *
 * The administrator's seating configuration decides, for each hall in the order the halls are
 * listed: whether it holds boys or girls, which student categories (department + batch, see
 * categories.ts) it may hold, at most how many different categories, and optionally how many
 * students of each category it should take.
 *
 * Mandatory rules, never relaxed to fit more students in:
 *  1. Boys and girls sit in separate halls; a hall only takes the group it is assigned to. (A hall
 *     with a seating pattern is the exception: see below.)
 *  2. Two students per bench at most, and bench mates are in DIFFERENT ACADEMIC YEARS (a Final Year
 *     student never sits with another Final Year student, whatever their departments).
 *  3. A hall takes only the categories selected for it, no more distinct categories than its limit,
 *     and no more of a category than requested.
 *  4. A hall never holds more students than its seats.
 * A student who cannot be seated under these rules is listed as unallocated with the reason.
 *
 * How many students of each category go to each hall is found as a min-cost max-flow (see
 * min-cost-flow.ts): as many students as the rules allow are seated, requested quantities are met
 * first, and earlier halls and earlier categories are preferred, so halls fill in the configured
 * order. Halls whose gender is not fixed may be given to the other group when that seats more
 * students (see planSeating). A hall can hold at most one student of an academic year per bench, which is exactly when
 * its students can be paired with different-year bench mates. Within each category students go to
 * the halls in roll-number order, so a category continues from one hall into the next. The result is
 * deterministic: the same input gives the same plan.
 *
 * A hall may instead follow a SEATING PATTERN (seating-pattern.ts): the administrator has said seat by
 * seat which department, academic year and gender sits there, boys and girls together if they wish.
 * Such halls take their students first, seat by seat in bench order, in roll-number order; the hall's
 * gender, categories and limit do not apply. A seat whose students have run out stays empty. The
 * remaining students go to the other halls as above.
 */
import { enabledBenches, type Bench, type HallLayout } from "./hall-layout"
import { categoryKey, categoryLabel, yearOfStudy } from "./categories"
import { MinCostFlow } from "./min-cost-flow"
import { normalizePattern, validatePattern, patternSlotAt, slotKey, slotLabel, type SeatingPattern, type PatternSlot } from "./seating-pattern"

export type Gender = "M" | "F"
export const GENDER_GROUP: Record<Gender, string> = { M: "Boys", F: "Girls" }
const GENDERS: Gender[] = ["M", "F"]

export interface SeatStudent { id: number; roll_no: string; gender: Gender; batch: string; department_id: number | null; dept_code?: string | null; name?: string }
export interface SeatHall extends HallLayout { id: number; hall_code: string; default_max_categories?: number | null }
export interface Seat { studentId: number; hallId: number; row: number; col: number; benchNo: number; seat: "L" | "R" }

/** One hall's settings for a session. `maxCategories` null means: use the hall's default (Master Data). */
export interface HallSeatingConfig {
  hallId: number
  /** Boys' or girls' hall; null = not used in this session. */
  gender: Gender | null
  /**
   * True: the hall keeps `gender` whatever happens. False: the planner may give it to the other
   * group, or bring an unused hall into use, when that seats more students. Missing counts as fixed.
   */
  genderFixed: boolean
  maxCategories: number | null
  /** Categories this hall may hold; `quantity` null means "as many as fit". */
  categories: { key: string; quantity: number | null }[]
  /** A seat-by-seat pattern; when set, gender, categories and limit are not used for this hall. */
  pattern?: SeatingPattern | null
}
/** A session's seating configuration. The order of `halls` is the order halls are filled in. */
export interface SeatingConfig { categoryOrder: string[]; halls: HallSeatingConfig[] }

export interface StudentCategory {
  key: string; departmentId: number | null; deptCode: string; batch: string
  /** "Final Year", "Second Year", …; empty when the batch is not studying in this academic year. */
  year: string
  label: string
  boys: number; girls: number
}
export interface UnallocatedStudent { studentId: number; roll_no: string; name?: string; gender: Gender; categoryKey: string; category: string; reason: string }
export interface HallSummary {
  /** `gender` is the group the hall holds in the plan; `configuredGender` what the configuration said. */
  hallId: number; hall_code: string; gender: Gender | null; configuredGender: Gender | null; genderFixed: boolean
  benches: number; capacity: number; occupied: number; empty: number
  /** The limit in force (session setting, else hall default); null = no limit. */
  maxCategories: number | null
  categories: { key: string; label: string; requested: number | null; actual: number }[]
  warnings: string[]
  /** The name of the seating pattern the hall follows, or null. */
  pattern: string | null
}
export interface SeatingPlan {
  seats: Seat[]
  /** The group each hall holds; null for a hall not used. */
  hallGender: Record<number, Gender | null>
  halls: HallSummary[]
  unallocated: UnallocatedStudent[]
  categories: StudentCategory[]
  warnings: string[]
  /** Halls whose group the planner changed (only halls whose gender is not fixed). */
  reassigned: { hallId: number; hall_code: string; from: Gender | null; to: Gender | null }[]
  /** Each group's totals: students selected, seated, unallocated, and the halls and seats it holds. */
  groups: Record<Gender, { students: number; seated: number; unallocated: number; halls: number; seats: number }>
}

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const byRoll = (a: SeatStudent, b: SeatStudent) => rollOrder.compare(a.roll_no, b.roll_no) || a.id - b.id
const groupWord = (g: Gender) => (g === "M" ? "boys" : "girls")

// ── Categories ──────────────────────────────────────────────

interface Placed { s: SeatStudent; key: string; year: string }

/**
 * The categories of the given students (with boys and girls counted) in the configured order:
 * `order` first, then the rest by batch (oldest first) and department. Students whose batch is not
 * studying in the academic year are returned in `invalid` with the reason.
 */
export function studentCategories(students: SeatStudent[], academicYear: unknown, order: string[] = []) {
  const byKey = new Map<string, StudentCategory>()
  const placed: Placed[] = []
  const invalid: { s: SeatStudent; key: string; reason: string }[] = []
  for (const s of students) {
    const key = categoryKey(s.department_id, s.batch)
    const y = yearOfStudy(s.batch, academicYear)
    let c = byKey.get(key)
    if (!c) {
      const year = y.ok ? y.label : ""
      c = { key, departmentId: s.department_id ?? null, deptCode: s.dept_code ?? "", batch: s.batch, year, label: `${categoryLabel(s.dept_code, year || "not studying")} (${s.batch})`, boys: 0, girls: 0 }
      byKey.set(key, c)
    }
    if (s.gender === "M") c.boys++; else c.girls++
    if (y.ok) placed.push({ s, key, year: y.label })
    else invalid.push({ s, key, reason: y.reason })
  }
  const rest = [...byKey.values()].filter(c => !order.includes(c.key))
    .sort((a, b) => a.batch.localeCompare(b.batch) || rollOrder.compare(a.deptCode, b.deptCode) || a.key.localeCompare(b.key))
  const categories = [...order.filter(k => byKey.has(k)).map(k => byKey.get(k)!), ...rest]
  return { categories, placed, invalid }
}

// ── Configuration ───────────────────────────────────────────

const wholeOrNull = (v: unknown, min: number): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : null
}

/**
 * The configuration cleaned up against the session's halls: unknown halls dropped, every session
 * hall present once (halls missing from it are added at the end, not used), numbers made whole,
 * repeated categories removed.
 */
export function normalizeConfig(config: Partial<SeatingConfig> | null | undefined, halls: SeatHall[]): SeatingConfig {
  const known = new Set(halls.map(h => h.id))
  const seen = new Set<number>()
  const out: HallSeatingConfig[] = []
  for (const h of config?.halls ?? []) {
    const id = Number(h?.hallId)
    if (!known.has(id) || seen.has(id)) continue
    seen.add(id)
    const cats = new Map<string, number | null>()
    for (const c of h.categories ?? []) if (c && typeof c.key === "string" && !cats.has(c.key)) cats.set(c.key, wholeOrNull(c.quantity, 0))
    out.push({
      hallId: id, gender: h.gender === "M" || h.gender === "F" ? h.gender : null, genderFixed: h.genderFixed !== false,
      maxCategories: wholeOrNull(h.maxCategories, 1),
      categories: [...cats].map(([key, quantity]) => ({ key, quantity })),
      pattern: h.pattern ? normalizePattern(h.pattern) : null
    })
  }
  for (const h of halls) if (!seen.has(h.id)) out.push({ hallId: h.id, gender: null, genderFixed: true, maxCategories: null, categories: [] })
  return { categoryOrder: [...new Set((config?.categoryOrder ?? []).filter(k => typeof k === "string"))], halls: out }
}

/** The category limit in force for a hall: the session's setting, else the hall default, else none. */
export const effectiveMaxCategories = (cfg: HallSeatingConfig, hall: SeatHall | undefined) =>
  cfg.maxCategories ?? (hall?.default_max_categories ? Number(hall.default_max_categories) : null)

/**
 * Problems that stop a configuration from being used (errors) and requests that cannot be met in
 * full (warnings). The screen shows them while the administrator edits.
 */
export function checkConfig(config: SeatingConfig, halls: SeatHall[], categories: StudentCategory[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = []
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const catOf = new Map(categories.map(c => [c.key, c]))
  for (const cfg of config.halls) {
    const hall = hallOf.get(cfg.hallId)
    if (!hall) continue
    if (cfg.pattern) { checkPatternHall(cfg.pattern, hall, categories, errors, warnings); continue }
    if (!cfg.gender) continue
    const benches = enabledBenches(hall).length
    const code = hall.hall_code
    if (benches === 0) { errors.push(`Hall ${code} has no bench layout. Set its rows and columns in Master Data → Halls, or mark it Not used.`); continue }
    if (cfg.categories.length === 0) warnings.push(`Hall ${code} has no categories selected, so it will stay empty.`)
    const requested = cfg.categories.reduce((n, c) => n + (c.quantity ?? 0), 0)
    if (requested > benches * 2) errors.push(`Hall ${code}: ${requested} students requested, but it seats only ${benches * 2} (${benches} benches). Lower the quantities or choose another hall.`)
    const max = effectiveMaxCategories(cfg, hall)
    const asked = cfg.categories.filter(c => (c.quantity ?? 0) > 0)
    if (max !== null && asked.length > max) errors.push(`Hall ${code}: quantities are requested for ${asked.length} categories, but the hall allows at most ${max}.`)
    // Bench mates must be in different academic years: a hall seats at most one student of a year per bench.
    const perYear = new Map<string, number>()
    for (const c of asked) {
      const cat = catOf.get(c.key)
      if (cat?.year) perYear.set(cat.year, (perYear.get(cat.year) ?? 0) + c.quantity!)
      const have = cat ? (cfg.gender === "M" ? cat.boys : cat.girls) : 0
      if (cat && c.quantity! > have) warnings.push(`Hall ${code}: ${c.quantity} ${cat.label} ${groupWord(cfg.gender)} requested, but only ${have} are selected.`)
    }
    for (const [year, n] of perYear) {
      if (n > benches) warnings.push(`Hall ${code}: ${n} ${year} students requested, but bench mates must be in different academic years, so its ${benches} benches seat at most ${benches} ${year} students.`)
    }
  }
  return { errors, warnings }
}

/** checkConfig for a hall that follows a seating pattern. */
function checkPatternHall(pattern: SeatingPattern, hall: SeatHall, categories: StudentCategory[], errors: string[], warnings: string[]) {
  const code = hall.hall_code
  const benches = enabledBenches(hall)
  if (benches.length === 0) { errors.push(`Hall ${code} has no bench layout. Set its rows and columns in Master Data → Halls, or remove its pattern.`); return }
  const problem = validatePattern(pattern)
  if (problem) { errors.push(`Hall ${code}, pattern "${pattern.name}": ${problem}`); return }
  const used = new Map<string, PatternSlot>()
  for (const b of benches) for (const side of ["L", "R"] as const) {
    const slot = patternSlotAt(pattern, b.row, b.col, side)
    if (slot) used.set(slotKey(slot), slot)
  }
  if (used.size === 0) warnings.push(`Hall ${code}: its pattern leaves every bench of this hall empty.`)
  for (const slot of used.values()) {
    const have = categories.filter(c => c.departmentId === slot.departmentId && c.year === slot.year).reduce((n, c) => n + (slot.gender === "M" ? c.boys : c.girls), 0)
    if (have === 0) warnings.push(`Hall ${code}: the pattern has seats for ${slotLabel(slot)}, but none are selected, so those seats stay empty.`)
  }
}

// ── Bench pairing ───────────────────────────────────────────

interface Unit<T> { left: T; right?: T }

/**
 * Bench groups for one hall's students, given in order with each academic year together. When no
 * year has more than half the students, the list is split in half and the halves sit side by side,
 * which always puts different years together. Otherwise every other student sits with one of the
 * largest year, and the rest of that year sit alone. Uses max(⌈n/2⌉, largest year) benches.
 */
export function benchUnits<T>(sorted: T[], yearOf: (t: T) => string): Unit<T>[] {
  const n = sorted.length
  if (n === 0) return []
  const half = Math.ceil(n / 2)
  const counts = new Map<string, number>()
  for (const t of sorted) counts.set(yearOf(t), (counts.get(yearOf(t)) ?? 0) + 1)
  let big = { year: "", count: 0 }
  for (const [year, count] of counts) if (count > big.count) big = { year, count }
  if (big.count <= half) {
    const units: Unit<T>[] = []
    for (let i = 0; i + half < n; i++) units.push({ left: sorted[i], right: sorted[i + half] })
    if (n % 2 === 1) units.push({ left: sorted[half - 1] })
    return units
  }
  const mine = sorted.filter(t => yearOf(t) === big.year)
  const others = sorted.filter(t => yearOf(t) !== big.year)
  return [...others.map((o, i) => ({ left: mine[i], right: o })), ...mine.slice(others.length).map(left => ({ left }))]
}

/** Benches needed to seat students with different-year bench mates. */
export const benchesNeeded = (n: number, largestYear: number) => Math.max(Math.ceil(n / 2), largestYear)

// ── Planning ────────────────────────────────────────────────

interface HallRun { hall: SeatHall; cfg: HallSeatingConfig; benches: Bench[]; max: number | null }

/**
 * How many students of each category each hall of one group takes. Runs the flow, then while a
 * hall holds more categories than its limit, drops its smallest category there and runs again.
 */
function distribute(runs: HallRun[], cats: { key: string; year: string; count: number }[]) {
  const dropped = new Map<number, Set<string>>(runs.map(r => [r.hall.id, new Set()]))
  const years = [...new Set(cats.map(c => c.year))]
  const rank = new Map(cats.map((c, i) => [c.key, i]))
  for (;;) {
    // Nodes: 0 source, 1 sink, categories, then for each hall one node per year and the hall itself.
    const catNode = (i: number) => 2 + i
    const yearNode = (h: number, y: number) => 2 + cats.length + h * (years.length + 1) + y
    const hallNode = (h: number) => 2 + cats.length + h * (years.length + 1) + years.length
    const flow = new MinCostFlow(2 + cats.length + runs.length * (years.length + 1))
    cats.forEach((c, i) => flow.addEdge(0, catNode(i), c.count, 0))
    const step = cats.length + 1, fillCost = runs.length * step
    const edges: { h: number; key: string; edge: number }[] = []
    runs.forEach((r, h) => {
      const seats = r.benches.length * 2
      for (const want of r.cfg.categories) {
        const i = rank.get(want.key)
        if (i === undefined || dropped.get(r.hall.id)!.has(want.key)) continue
        const cap = want.quantity === null ? seats : Math.min(want.quantity, seats)
        if (cap <= 0) continue
        // Requested quantities first, then earlier halls, then earlier categories.
        const cost = (want.quantity === null ? fillCost : 0) + h * step + i
        edges.push({ h, key: want.key, edge: flow.addEdge(catNode(i), yearNode(h, years.indexOf(cats[i].year)), cap, cost) })
      }
      years.forEach((_, y) => flow.addEdge(yearNode(h, y), hallNode(h), r.benches.length, 0))
      flow.addEdge(hallNode(h), 1, seats, 0)
    })
    flow.run(0, 1)
    const take = runs.map(() => new Map<string, number>())
    for (const e of edges) { const x = flow.flowOn(e.edge); if (x > 0) take[e.h].set(e.key, (take[e.h].get(e.key) ?? 0) + x) }

    let changed = false
    runs.forEach((r, h) => {
      if (r.max === null || take[h].size <= r.max) return
      const victim = [...take[h]].sort((a, b) => a[1] - b[1] || rank.get(b[0])! - rank.get(a[0])!)[0][0]
      dropped.get(r.hall.id)!.add(victim)
      changed = true
    })
    if (!changed) return { take, dropped }
  }
}

/** Why the remaining students of a category could not be seated in any hall of their group. */
function unseatedReason(g: Gender, cat: StudentCategory, runs: HallRun[], take: Map<string, number>[], dropped: Map<number, Set<string>>, yearOf: (key: string) => string): string {
  if (runs.length === 0) return `No hall with benches is assigned to ${groupWord(g)}.`
  const permit = runs.map((r, h) => ({ r, h })).filter(({ r }) => r.cfg.categories.some(c => c.key === cat.key))
  if (permit.length === 0) return `No ${groupWord(g)}' hall permits ${cat.label}.`
  const open = permit.filter(({ r }) => !dropped.get(r.hall.id)!.has(cat.key))
  if (open.length === 0) return `Hall category limits: every ${groupWord(g)}' hall that permits ${cat.label} already holds its maximum number of categories.`
  let full = 0, year = 0
  for (const { r, h } of open) {
    const q = r.cfg.categories.find(c => c.key === cat.key)!.quantity
    const occupied = [...take[h].values()].reduce((a, b) => a + b, 0)
    const sameYear = [...take[h]].filter(([k]) => yearOf(k) === cat.year).reduce((a, [, n]) => a + n, 0)
    if (q !== null && (take[h].get(cat.key) ?? 0) >= q) continue
    if (occupied >= r.benches.length * 2) full++
    else if (sameYear >= r.benches.length) year++
  }
  if (full === 0 && year === 0) return `Requested quantities: the ${groupWord(g)}' halls that permit ${cat.label} already have the number of these students requested.`
  if (year > 0) return `No compatible bench mate: the ${groupWord(g)}' halls that permit ${cat.label} with free seats already have a ${cat.year} student on every bench (bench mates must be in different academic years).`
  return `Insufficient hall capacity: the ${groupWord(g)}' halls that permit ${cat.label} are full.`
}

/** Lexicographic comparison of two scores (lower is better). */
function lessThan(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]
  return false
}

/**
 * The seating plan for the selected students in the session's halls under a configuration.
 * `academicYear` is the exam cycle's academic year ("2025-2026").
 *
 * All halls are considered together. A hall whose gender is fixed keeps it. A hall whose gender is
 * not fixed (`genderFixed: false`) may be given to the other group, or brought into use, when that
 * seats more students: starting from the configured genders, single changes and swaps between two
 * such halls are tried, and the best is kept while it seats more students (or the same number with
 * fewer changes). Hall and category order still decide who sits where within each group.
 */
export function planSeating(students: SeatStudent[], halls: SeatHall[], rawConfig: Partial<SeatingConfig> | null | undefined, academicYear: unknown): SeatingPlan {
  const config = normalizeConfig(rawConfig, halls)
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const { categories, placed, invalid } = studentCategories(students, academicYear, config.categoryOrder)
  const catOf = new Map(categories.map(c => [c.key, c]))
  const rank = new Map(categories.map((c, i) => [c.key, i]))
  const yearOf = (key: string) => catOf.get(key)?.year ?? ""
  const warnings: string[] = []
  const seats: Seat[] = []
  const unallocated: UnallocatedStudent[] = invalid.sort((a, b) => byRoll(a.s, b.s)).map(({ s, key, reason }) => ({
    studentId: s.id, roll_no: s.roll_no, name: s.name, gender: s.gender, categoryKey: key, category: catOf.get(key)!.label, reason
  }))
  const benchesOf = new Map(halls.map(h => [h.id, enabledBenches(h)]))

  // Each group's students, queued by category in roll-number order.
  const queues: Record<Gender, Map<string, Placed[]>> = { M: new Map(), F: new Map() }
  for (const p of placed) queues[p.s.gender].set(p.key, [...(queues[p.s.gender].get(p.key) ?? []), p])
  for (const g of GENDERS) for (const q of queues[g].values()) q.sort((a, b) => byRoll(a.s, b.s))

  // Halls with a pattern take their students first, seat by seat, in hall order.
  const patternIntake = new Map<number, Placed[]>()
  const emptySlots = new Map<number, Map<string, { slot: PatternSlot; n: number }>>()
  const patternSeats: Record<Gender, number> = { M: 0, F: 0 }
  const patternHalls: Record<Gender, Set<number>> = { M: new Set(), F: new Set() }
  const takeFor = (slot: PatternSlot): Placed | undefined => {
    for (const c of categories) {
      if (c.departmentId !== slot.departmentId || c.year !== slot.year) continue
      const q = queues[slot.gender].get(c.key)
      if (q?.length) return q.shift()
    }
    return undefined
  }
  for (const cfg of config.halls) {
    const benches = benchesOf.get(cfg.hallId)!
    if (!cfg.pattern || validatePattern(cfg.pattern) || benches.length === 0) continue
    const list: Placed[] = [], empty = new Map<string, { slot: PatternSlot; n: number }>()
    for (const b of benches) for (const side of ["L", "R"] as const) {
      const slot = patternSlotAt(cfg.pattern, b.row, b.col, side)
      if (!slot) continue
      patternSeats[slot.gender]++
      patternHalls[slot.gender].add(cfg.hallId)
      const p = takeFor(slot)
      if (p) {
        list.push(p)
        seats.push({ studentId: p.s.id, hallId: cfg.hallId, row: b.row, col: b.col, benchNo: b.benchNo, seat: side })
      } else {
        const e = empty.get(slotKey(slot)) ?? { slot, n: 0 }
        e.n++; empty.set(slotKey(slot), e)
      }
    }
    patternIntake.set(cfg.hallId, list)
    emptySlots.set(cfg.hallId, empty)
  }

  const cats: Record<Gender, { key: string; year: string; count: number }[]> = {
    M: categories.filter(c => queues.M.get(c.key)?.length).map(c => ({ key: c.key, year: c.year, count: queues.M.get(c.key)!.length })),
    F: categories.filter(c => queues.F.get(c.key)?.length).map(c => ({ key: c.key, year: c.year, count: queues.F.get(c.key)!.length }))
  }

  // One group in the halls a split gives it (in hall order); remembered, as splits share groups.
  type GroupRun = { runs: HallRun[]; take: Map<string, number>[]; dropped: Map<number, Set<string>>; seated: number }
  const memo = new Map<string, GroupRun>()
  const runGroup = (g: Gender, split: Map<number, Gender | null>): GroupRun => {
    const runs: HallRun[] = config.halls.filter(c => split.get(c.hallId) === g && benchesOf.get(c.hallId)!.length > 0).map(cfg => {
      const hall = hallOf.get(cfg.hallId)!
      return { hall, cfg, benches: benchesOf.get(hall.id)!, max: effectiveMaxCategories(cfg, hall) }
    })
    const key = `${g}:${runs.map(r => r.hall.id).join(",")}`
    let run = memo.get(key)
    if (!run) {
      const { take, dropped } = distribute(runs, cats[g])
      run = { runs, take, dropped, seated: take.reduce((n, t) => n + [...t.values()].reduce((a, b) => a + b, 0), 0) }
      memo.set(key, run)
    }
    return run
  }

  // Which group each hall holds: the configured split, improved where non-fixed halls allow it.
  // A hall with a pattern holds no group of its own: it is left out of the split.
  const configured = new Map(config.halls.map(c => [c.hallId, c.pattern ? null : c.gender]))
  const flexible = config.halls.filter(c => !c.pattern && !c.genderFixed && benchesOf.get(c.hallId)!.length > 0).map(c => c.hallId)
  const score = (split: Map<number, Gender | null>) => {
    let changes = 0
    for (const [id, g] of split) if (g !== configured.get(id)) changes++
    return [-(runGroup("M", split).seated + runGroup("F", split).seated), changes]
  }
  let split = configured, best = score(split)
  while (flexible.length > 0 && -best[0] < placed.length) {
    let next: Map<number, Gender | null> | null = null, nextScore = best
    const consider = (candidate: Map<number, Gender | null>) => {
      const s = score(candidate)
      if (lessThan(s, nextScore)) { next = candidate; nextScore = s }
    }
    for (const id of flexible) for (const g of [...GENDERS, null]) if (split.get(id) !== g) consider(new Map(split).set(id, g))
    for (let i = 0; i < flexible.length; i++) for (let j = i + 1; j < flexible.length; j++) {
      const a = flexible[i], b = flexible[j]
      if (split.get(a) !== split.get(b)) consider(new Map(split).set(a, split.get(b)!).set(b, split.get(a)!))
    }
    if (!next) break
    split = next; best = nextScore
  }

  const hallGender: Record<number, Gender | null> = {}
  const reassigned: SeatingPlan["reassigned"] = []
  for (const cfg of config.halls) {
    const hall = hallOf.get(cfg.hallId)!, g = split.get(cfg.hallId) ?? null
    hallGender[hall.id] = g
    if (cfg.pattern) {
      if (benchesOf.get(hall.id)!.length === 0) warnings.push(`Hall ${hall.hall_code} has no bench layout, so no students were seated there. Set its rows and columns in Master Data → Halls.`)
      continue
    }
    if (g !== cfg.gender) {
      reassigned.push({ hallId: hall.id, hall_code: hall.hall_code, from: cfg.gender, to: g })
      const word = (x: Gender | null) => (x ? `a ${groupWord(x)}' hall` : "not used")
      warnings.push(`Hall ${hall.hall_code} was ${word(cfg.gender)} and is now ${word(g)}, to seat more students (its gender is not fixed).`)
    }
    if (g && benchesOf.get(hall.id)!.length === 0) warnings.push(`Hall ${hall.hall_code} has no bench layout, so no students were seated there. Set its rows and columns in Master Data → Halls.`)
  }

  // Each category goes to its group's halls in hall order, in roll-number order.
  const intake = new Map<number, Placed[]>()
  const groups = {} as SeatingPlan["groups"]
  for (const g of GENDERS) {
    const { runs, take, dropped, seated } = runGroup(g, split)
    runs.forEach((r, h) => {
      const list: Placed[] = []
      for (const c of cats[g]) list.push(...queues[g].get(c.key)!.splice(0, take[h].get(c.key) ?? 0))
      intake.set(r.hall.id, list)
    })
    for (const c of cats[g]) {
      const left = queues[g].get(c.key)!
      if (!left.length) continue
      const reason = unseatedReason(g, catOf.get(c.key)!, runs, take, dropped, yearOf)
      for (const p of left) unallocated.push({ studentId: p.s.id, roll_no: p.s.roll_no, name: p.s.name, gender: g, categoryKey: c.key, category: catOf.get(c.key)!.label, reason })
    }
    const total = students.filter(s => s.gender === g).length
    const inPatterns = [...patternIntake.values()].flat().filter(p => p.s.gender === g).length
    groups[g] = {
      students: total, seated: seated + inPatterns, unallocated: total - seated - inPatterns,
      halls: runs.length + patternHalls[g].size, seats: runs.reduce((n, r) => n + r.benches.length * 2, 0) + patternSeats[g]
    }
  }

  // Bench by bench: each year kept together (years in category order), then category, then roll number.
  const summaries: HallSummary[] = []
  for (const cfg of config.halls) {
    const hall = hallOf.get(cfg.hallId)!
    const gender = hallGender[hall.id]
    const benches = benchesOf.get(hall.id)!
    const patterned = patternIntake.has(hall.id)
    const list = patterned ? patternIntake.get(hall.id)! : intake.get(hall.id) ?? []
    if (!patterned) {
      const yearRank = new Map<string, number>()
      for (const p of [...list].sort((a, b) => rank.get(a.key)! - rank.get(b.key)!)) if (!yearRank.has(p.year)) yearRank.set(p.year, yearRank.size)
      list.sort((a, b) => yearRank.get(a.year)! - yearRank.get(b.year)! || rank.get(a.key)! - rank.get(b.key)! || byRoll(a.s, b.s))
      benchUnits(list, p => p.year).forEach((u, i) => {
        const b = benches[i]
        seats.push({ studentId: u.left.s.id, hallId: hall.id, row: b.row, col: b.col, benchNo: b.benchNo, seat: "L" })
        if (u.right) seats.push({ studentId: u.right.s.id, hallId: hall.id, row: b.row, col: b.col, benchNo: b.benchNo, seat: "R" })
      })
    }

    const counts = new Map<string, number>()
    for (const p of list) counts.set(p.key, (counts.get(p.key) ?? 0) + 1)
    const hallWarnings: string[] = []
    const rows = patterned
      ? [...counts.keys()].sort((a, b) => rank.get(a)! - rank.get(b)!).map(key => ({ key, label: catOf.get(key)!.label, requested: null, actual: counts.get(key)! }))
      : cfg.categories.filter(c => catOf.has(c.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!).map(c => {
        const actual = counts.get(c.key) ?? 0
        if (gender && c.quantity !== null && actual !== c.quantity) hallWarnings.push(`${c.quantity} ${catOf.get(c.key)!.label} requested, ${actual} allocated.`)
        return { key: c.key, label: catOf.get(c.key)!.label, requested: c.quantity, actual }
      })
    for (const { slot, n } of emptySlots.get(hall.id)?.values() ?? []) hallWarnings.push(`${n} pattern seat${n === 1 ? "" : "s"} for ${slotLabel(slot)} left empty: no more of these students are selected.`)
    if ((gender || patterned) && benches.length > 0 && list.length === 0) hallWarnings.push("No students in this hall.")
    for (const w of hallWarnings) warnings.push(`Hall ${hall.hall_code}: ${w}`)
    summaries.push({
      hallId: hall.id, hall_code: hall.hall_code, gender, configuredGender: cfg.gender, genderFixed: cfg.genderFixed,
      benches: benches.length, capacity: benches.length * 2, occupied: list.length, empty: benches.length * 2 - list.length,
      maxCategories: effectiveMaxCategories(cfg, hall), categories: rows, warnings: hallWarnings,
      pattern: cfg.pattern?.name ?? null
    })
  }
  return { seats, hallGender, halls: summaries, unallocated, categories, warnings, reassigned, groups }
}

// ── Validation ──────────────────────────────────────────────

/**
 * Checks a plan against every mandatory rule, independently of how it was made. Errors mean the
 * plan must not be saved; warnings (requested quantities not met) are shown for review.
 */
export function validateSeatingPlan(plan: Pick<SeatingPlan, "seats" | "unallocated"> & Partial<Pick<SeatingPlan, "hallGender">>, students: SeatStudent[], halls: SeatHall[], rawConfig: Partial<SeatingConfig> | null | undefined, academicYear: unknown): { errors: string[]; warnings: string[] } {
  const config = normalizeConfig(rawConfig, halls)
  const errors: string[] = [], warnings: string[] = []
  const studentOf = new Map(students.map(s => [s.id, s]))
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const cfgOf = new Map(config.halls.map(c => [c.hallId, c]))
  const yearOf = (s: SeatStudent) => { const y = yearOfStudy(s.batch, academicYear); return y.ok ? y.label : null }
  const keyOf = (s: SeatStudent) => categoryKey(s.department_id, s.batch)
  // The group each hall holds: the plan's, else the configuration's. A fixed hall must keep its own.
  const groupOf = new Map(config.halls.map(c => [c.hallId, plan.hallGender && c.hallId in plan.hallGender ? plan.hallGender[c.hallId] : c.gender]))
  for (const c of config.halls) {
    if (!c.pattern && c.genderFixed && groupOf.get(c.hallId) !== c.gender) errors.push(`Hall ${hallOf.get(c.hallId)?.hall_code}: its gender is fixed (${c.gender ? groupWord(c.gender) : "not used"}) but the plan changes it.`)
  }

  // 7, 8: every selected student once, either seated or listed as unallocated.
  const seen = new Map<number, number>()
  for (const id of [...plan.seats.map(s => s.studentId), ...plan.unallocated.map(u => u.studentId)]) seen.set(id, (seen.get(id) ?? 0) + 1)
  for (const [id, n] of seen) {
    const s = studentOf.get(id)
    if (!s) errors.push(`Student #${id} is in the plan but was not selected.`)
    else if (n > 1) errors.push(`Student ${s.roll_no} is allocated more than once.`)
  }
  for (const s of students) if (!seen.has(s.id)) errors.push(`Student ${s.roll_no} is neither seated nor listed as unallocated.`)

  const byHall = new Map<number, Seat[]>()
  for (const seat of plan.seats) {
    const hall = hallOf.get(seat.hallId), s = studentOf.get(seat.studentId)
    if (!hall) { errors.push(`A student is seated in hall #${seat.hallId}, which is not one of this session's halls.`); continue }
    if (!s) continue
    if (!enabledBenches(hall).some(b => b.row === seat.row && b.col === seat.col && b.benchNo === seat.benchNo)) errors.push(`Hall ${hall.hall_code}: bench ${seat.benchNo} does not exist.`)
    if (!yearOf(s)) errors.push(`Student ${s.roll_no} is seated, but batch ${s.batch} is not studying in academic year ${academicYear}.`)
    byHall.set(hall.id, [...(byHall.get(hall.id) ?? []), seat])
  }

  for (const [hallId, list] of byHall) {
    const hall = hallOf.get(hallId)!, cfg = cfgOf.get(hallId)!, code = hall.hall_code
    const people = list.map(x => studentOf.get(x.studentId)!).filter(Boolean)
    const problem = cfg.pattern ? validatePattern(cfg.pattern) : null
    if (problem) errors.push(`Hall ${code}: its seating pattern is not valid. ${problem}`)
    const pattern = cfg.pattern && !problem ? cfg.pattern : null
    if (pattern) {
      // A pattern hall: every student sits in a seat the pattern gives to their department, year and gender.
      for (const x of list) {
        const s = studentOf.get(x.studentId)
        if (!s) continue
        const slot = patternSlotAt(pattern, x.row, x.col, x.seat)
        if (!slot) errors.push(`Hall ${code}, bench ${x.benchNo}: the pattern leaves this seat empty, but ${s.roll_no} sits there.`)
        else if (s.department_id !== slot.departmentId || yearOf(s) !== slot.year || s.gender !== slot.gender) errors.push(`Hall ${code}, bench ${x.benchNo}: ${s.roll_no} sits in a seat the pattern gives to ${slotLabel(slot)}.`)
      }
    } else {
      // 1. One group per hall, the one assigned.
      const genders = new Set(people.map(s => s.gender))
      if (genders.size > 1) errors.push(`Hall ${code} has both boys and girls.`)
      const group = groupOf.get(hallId) ?? null
      if (!group) errors.push(`Hall ${code} is not used in this session but has students.`)
      else if ([...genders].some(g => g !== group)) errors.push(`Hall ${code} is a ${groupWord(group)}' hall but has ${groupWord(group === "M" ? "F" : "M")}.`)
    }
    // 2, 3. Benches: one student per seat, at most two, different academic years.
    const benches = new Map<number, Seat[]>()
    for (const x of list) benches.set(x.benchNo, [...(benches.get(x.benchNo) ?? []), x])
    for (const [no, b] of benches) {
      if (b.length > 2) errors.push(`Hall ${code}, bench ${no} has ${b.length} students (at most 2).`)
      if (new Set(b.map(x => x.seat)).size !== b.length) errors.push(`Hall ${code}, bench ${no}: two students in the same seat.`)
      if (b.length === 2) {
        const [a, c] = b.map(x => studentOf.get(x.studentId)!)
        if (a && c && yearOf(a) && yearOf(a) === yearOf(c)) errors.push(`Hall ${code}, bench ${no}: ${a.roll_no} and ${c.roll_no} are both ${yearOf(a)} students.`)
      }
    }
    // 4. Capacity.
    const capacity = enabledBenches(hall).length * 2
    if (list.length > capacity) errors.push(`Hall ${code} has ${list.length} students but only ${capacity} seats.`)
    if (cfg.pattern) continue
    // 5, 6. Categories: only selected ones, no more than the limit.
    const present = new Map<string, number>()
    for (const s of people) present.set(keyOf(s), (present.get(keyOf(s)) ?? 0) + 1)
    const allowed = new Map(cfg.categories.map(c => [c.key, c.quantity]))
    for (const k of present.keys()) if (!allowed.has(k)) errors.push(`Hall ${code} has students of a category not selected for it (${people.find(s => keyOf(s) === k)!.dept_code ?? ""} ${people.find(s => keyOf(s) === k)!.batch}).`)
    const max = effectiveMaxCategories(cfg, hall)
    if (max !== null && present.size > max) errors.push(`Hall ${code} has ${present.size} categories, more than its limit of ${max}.`)
    // 9. Requested quantities: never exceeded; a shortfall is reported.
    for (const [k, q] of allowed) {
      const n = present.get(k) ?? 0
      if (q === null) continue
      if (n > q) errors.push(`Hall ${code} has ${n} students of a category requested at ${q}.`)
      else if (n < q) warnings.push(`Hall ${code}: ${q} requested of one category, ${n} allocated.`)
    }
  }
  return { errors, warnings }
}

// ── Automatic configuration ─────────────────────────────────

/**
 * A starting configuration: every category allowed in every hall, quantities "as many as fit", the
 * category limit left to each hall's default, and the halls handed to boys or girls in hall order,
 * none of them fixed (so the planner may still move a hall to the other group).
 * Boys-first and girls-first are both tried; the split that leaves the fewest students unallocated
 * (then uses the fewest halls) wins. Halls not needed are marked Not used.
 */
export function autoConfigure(students: SeatStudent[], halls: SeatHall[], academicYear: unknown, categoryOrder: string[] = []): SeatingConfig {
  const { categories } = studentCategories(students, academicYear, categoryOrder)
  const order = categories.map(c => c.key)
  const all = order.map(key => ({ key, quantity: null }))
  const usable = halls.filter(h => enabledBenches(h).length > 0)
  const configFor = (genders: Map<number, Gender>, genderFixed = true): SeatingConfig => ({
    categoryOrder: order,
    halls: halls.map(h => ({ hallId: h.id, gender: genders.get(h.id) ?? null, genderFixed, maxCategories: null, categories: all }))
  })
  const unallocatedOf = (plan: SeatingPlan, g: Gender) => plan.unallocated.filter(u => u.gender === g).length

  let best: { score: number[]; config: SeatingConfig } | null = null
  for (const [first, second] of [["M", "F"], ["F", "M"]] as Gender[][]) {
    const genders = new Map<number, Gender>()
    let i = 0
    // The first group takes halls until everyone it can seat is seated.
    if (students.some(s => s.gender === first)) {
      let last = Infinity
      while (i < usable.length) {
        genders.set(usable[i++].id, first)
        const left = unallocatedOf(planSeating(students, halls, configFor(genders), academicYear), first)
        const invalid = students.filter(s => s.gender === first && !yearOfStudy(s.batch, academicYear).ok).length
        if (left <= invalid || left === last) break
        last = left
      }
    }
    for (; i < usable.length; i++) genders.set(usable[i].id, second)
    let plan = planSeating(students, halls, configFor(genders), academicYear)
    for (const h of plan.halls) if (h.gender && h.occupied === 0) genders.delete(h.hallId)
    plan = planSeating(students, halls, configFor(genders, false), academicYear)
    // Keep any hall the planner moved to the other group, so the settings show the split in use.
    const settled = new Map(Object.entries(plan.hallGender).filter(([, g]) => g).map(([id, g]) => [Number(id), g as Gender]))
    const config = configFor(settled, false)
    const score = [plan.unallocated.length, genders.size]
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { score, config }
  }
  return best!.config
}

/**
 * Another session's configuration applied to this one: halls they share keep the copied gender,
 * limit, categories and quantities, in the copied order; halls only in this session keep their
 * current settings and come after. Category order follows the copy, for categories present here.
 */
export function mergeConfig(current: SeatingConfig, copied: Partial<SeatingConfig> | null | undefined, presentKeys: string[]): SeatingConfig {
  const present = new Set(presentKeys)
  const mine = new Map(current.halls.map(h => [h.hallId, h]))
  const fromCopy = (copied?.halls ?? []).filter(h => mine.has(h.hallId)).map(h => ({ ...h, categories: (h.categories ?? []).filter(c => present.has(c.key)) }))
  const copiedIds = new Set(fromCopy.map(h => h.hallId))
  const order = [...(copied?.categoryOrder ?? []).filter(k => present.has(k))]
  for (const k of current.categoryOrder) if (!order.includes(k)) order.push(k)
  return { categoryOrder: order, halls: [...fromCopy, ...current.halls.filter(h => !copiedIds.has(h.hallId))] }
}

/** A short message naming how many students are unallocated, or null when everyone is seated. */
export function unallocatedMessage(plan: Pick<SeatingPlan, "unallocated">): string | null {
  const parts = GENDERS.map(g => [g, plan.unallocated.filter(u => u.gender === g).length] as const).filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${g === "M" ? "boy" : "girl"}${n === 1 ? "" : "s"}`)
  return parts.length ? `${parts.join(" and ")} could not be seated under the seating rules.` : null
}
