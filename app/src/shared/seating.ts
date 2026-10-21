/**
 * STUDENT SEATING for one exam session (pure logic, no database access).
 *
 * Each hall follows a BENCH PATTERN the administrator chooses: a sequence of bench types, repeated
 * bench by bench through the hall:
 *   "MM" both seats boys · "FF" both seats girls (a boy and a girl never share a bench)
 * A boys' hall is the pattern [MM], a girls' hall [FF], a hall not used []; a pattern such as
 * [MM, FF] mixes them bench by bench. Rules:
 *  1. At most two students per bench, one per seat; one student per chair (a hall may have chairs
 *     in place of some or all benches: they have only a left seat).
 *  2. Every seat holds the gender its bench pattern gives it, nobody else.
 *  3. Two students of the same CLASS (department + batch, e.g. CSE – Third Year) never share a
 *     bench. A Third Year CSE student may sit with a Final Year student of any department, or with
 *     a CSE student of another year.
 *
 * SEAT COLUMNS: each column of benches has a left-seat column and a right-seat column. Seats are
 * filled hall by hall, column by column, the left-seat column front to back and then the
 * right-seat column front to back. Each seat column is given ONE class, whose students sit in it
 * in roll-number order; the classes take the seat columns in turn (largest class first, classes of
 * equal size by batch, oldest first, then department), each continuing from where it stopped.
 * With classes A, B, C:
 *
 *     column 1     column 2     column 3     column 4      next hall
 *     L    R       L    R       L    R       L    R
 *     A01  B01     C01  A05     B05  C05     A09  B09      C09 ...
 *     A02  B02     C02  A06     B06  C06     A10  B10
 *     A03  B03     C03  A07     B07  C07     A11  B11
 *     A04  B04     C04  A08     B08  C08     A12  B12
 *
 * so bench mates are always of different classes. Every hall holds at most `classLimit.preferred`
 * different classes (papers). Only if that leaves students without a seat is the plan made again
 * letting a hall that would have empty seats while students wait take more, up to `classLimit.max`
 * (each such hall tries preferred + 1, … max and keeps the first that fills it). Within a hall the classes take turns among themselves; the next hall goes on
 * with the next classes in turn. When a class runs out the next one in turn
 * continues the seat column. Seat columns are kept per gender (in a hall that mixes boys and girls
 * bench by bench, the boys and the girls of a seat column each have their own class). A seat stays
 * empty when no student of another class than the bench mate is left. A student still left over
 * then takes the seat of a student of another class, who moves to an empty seat beside a student
 * of yet another class (so a seat column may hold a student of another class, but only to seat
 * everyone). Anyone left after that is listed as unallocated with the reason. autoConfigure gives whole halls to boys and girls by trying every
 * combination of halls; when no such split seats everyone but the seats suffice, it mixes one hall
 * bench by bench so that everyone is seated. The result is deterministic.
 */
import { enabledBenches, seatCount, type Bench, type HallLayout } from "./hall-layout"
import { categoryKey, categoryLabel, yearOfStudy } from "./categories"

export type Gender = "M" | "F"
export const GENDER_GROUP: Record<Gender, string> = { M: "Boys", F: "Girls" }
const GENDERS: Gender[] = ["M", "F"]

/** A bench's two seats, left then right: "MM" two boys, "FF" two girls. Boys and girls never share a bench. */
export type BenchType = "MM" | "FF"
export const BENCH_TYPES: BenchType[] = ["MM", "FF"]
export const BENCH_TYPE_LABEL: Record<BenchType, string> = { MM: "Boy + Boy", FF: "Girl + Girl" }
/** The longest pattern kept (longer ones are cut): enough to spell out every bench of a large hall. */
export const MAX_PATTERN_LENGTH = 600

export interface SeatStudent {
  id: number; roll_no: string; gender: Gender; batch: string; department_id: number | null; dept_code?: string | null; name?: string
  /**
   * The paper the student writes in this session ("sub:12"), when subjects are entered for the
   * session (applySessionSubjects). Students writing the same paper are then kept apart instead of
   * students of the same class, and also never sit side by side across the aisle.
   */
  paper?: string
  /** The subjects the student is mapped to (Master Data → Subjects → Students), when known. */
  subject_ids?: number[]
}
export interface SeatHall extends HallLayout { id: number; hall_code: string }
export interface Seat { studentId: number; hallId: number; row: number; col: number; benchNo: number; seat: "L" | "R" }

/** One hall's setting for a session: its bench pattern, repeated through the hall; [] = not used. */
export interface HallSeatingConfig { hallId: number; pattern: BenchType[] }
/** A session's seating configuration, one entry per hall, in the session's hall order. */
export interface SeatingConfig {
  halls: HallSeatingConfig[]
  /**
   * How many different classes (papers) one hall may hold: `preferred` for every hall, and up to
   * `max` in a hall where `preferred` would leave seats empty while students wait. Both 2 to 4.
   */
  classLimit?: ClassLimit
  /**
   * Roll number order, boys and girls together: gender is ignored, each seat column takes the next
   * students of its class in roll-number order whatever their gender (102349 a boy, then 102350 a
   * girl). Halls are only used or not used; their bench patterns do not apply.
   */
  mixGenders?: boolean
  /**
   * The subject each class writes in this session: class key (categoryKey, department + batch) →
   * subject id. Optional: without it the seating is made by class exactly as before. It applies to
   * students not mapped to any of `sessionSubjects`.
   */
  subjects?: Record<string, number>
  /**
   * The subjects written in this session. A student mapped to one of them (student_subjects)
   * writes that one; the class subject above is only for students with no such mapping.
   */
  sessionSubjects?: number[]
}
export interface ClassLimit { preferred: number; max: number }
/** Fewest and most different classes a hall may be set to hold (a hall needs two for bench mates of different classes). */
export const MIN_CLASSES_PER_HALL = 2, MAX_CLASSES_PER_HALL = 4
export const DEFAULT_CLASS_LIMIT: ClassLimit = { preferred: 3, max: 4 }

/** A class limit made valid: preferred 2 to 4, max from preferred to 4. */
export function normalizeClassLimit(limit: Partial<ClassLimit> | null | undefined): ClassLimit {
  const clamp = (v: unknown, lo: number, fallback: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) ? Math.min(MAX_CLASSES_PER_HALL, Math.max(lo, n)) : fallback
  }
  const preferred = clamp(limit?.preferred, MIN_CLASSES_PER_HALL, DEFAULT_CLASS_LIMIT.preferred)
  return { preferred, max: clamp(limit?.max, preferred, Math.max(preferred, DEFAULT_CLASS_LIMIT.max)) }
}
/** Who a hall holds: only boys, only girls, both (bench by bench), or nobody (not used). */
export type HallGroup = Gender | "mixed" | null

export interface UnallocatedStudent { studentId: number; roll_no: string; name?: string; gender: Gender; categoryKey: string; category: string; reason: string }
export interface HallSummary {
  hallId: number; hall_code: string; gender: HallGroup; pattern: BenchType[]
  benches: number; capacity: number; occupied: number; empty: number
  /** Seats the pattern gives boys and girls in this hall. */
  seatsFor: Record<Gender, number>
  /** The department + year of the students seated here, with how many of each. */
  categories: { key: string; label: string; count: number }[]
}
export interface SeatingPlan {
  seats: Seat[]
  /** Who each hall holds. */
  hallGender: Record<number, HallGroup>
  halls: HallSummary[]
  unallocated: UnallocatedStudent[]
  warnings: string[]
  /** Each group's totals: students selected, seated, unallocated, and the halls and seats it has. */
  groups: Record<Gender, { students: number; seated: number; unallocated: number; halls: number; seats: number }>
}

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
const groupWordOf = (g: Gender) => (g === "M" ? "boys" : "girls")
const seatsOf = (h: SeatHall) => seatCount(h)

/** Seating order within a group: batch (oldest first), department, roll number. */
const seatingOrder = (a: SeatStudent, b: SeatStudent) =>
  a.batch.localeCompare(b.batch) || rollOrder.compare(a.dept_code ?? "", b.dept_code ?? "") || rollOrder.compare(a.roll_no, b.roll_no) || a.id - b.id

/** A student's department + year, as shown on screen ("CSE – Final Year"). */
export function studentCategory(s: SeatStudent, academicYear: unknown): { key: string; label: string } {
  const y = yearOfStudy(s.batch, academicYear)
  return { key: categoryKey(s.department_id, s.batch), label: categoryLabel(s.dept_code, y.ok ? y.label : s.batch) }
}

// ── Bench patterns ──────────────────────────────────────────

/** The gender of a bench's seat under a pattern: bench index i (0-based, in bench order), left or right. */
export const seatGender = (pattern: BenchType[], i: number, side: "L" | "R"): Gender =>
  pattern[i % pattern.length][side === "L" ? 0 : 1] as Gender

/** The seats of a position: left and right on a bench, only left on a chair. */
export const sidesOf = (b: Pick<Bench, "seats">): ("L" | "R")[] => (b.seats === 2 ? ["L", "R"] : ["L"])

/** Seats a pattern gives boys and girls over a hall's benches (a number: that many two-seat benches). */
export function patternSeats(pattern: BenchType[], benches: number | Pick<Bench, "seats">[]): Record<Gender, number> {
  const out: Record<Gender, number> = { M: 0, F: 0 }
  if (pattern.length === 0) return out
  const list = typeof benches === "number" ? Array.from({ length: benches }, () => ({ seats: 2 as const })) : benches
  list.forEach((b, i) => { for (const side of sidesOf(b)) out[seatGender(pattern, i, side)]++ })
  return out
}

/** Who a pattern seats: boys only, girls only, both, or nobody. */
export function patternGroup(pattern: BenchType[]): HallGroup {
  if (pattern.length === 0) return null
  const genders = new Set(pattern.flatMap(t => [t[0], t[1]]))
  return genders.size > 1 ? "mixed" : ([...genders][0] as Gender)
}

/**
 * A hall's pattern from saved settings; older versions saved only `gender` (boys/girls/not used).
 * Boy + girl benches saved by older versions are dropped: boys and girls no longer share a bench.
 */
export function hallPattern(h: any): BenchType[] {
  if (Array.isArray(h?.pattern)) return h.pattern.filter((t: unknown): t is BenchType => BENCH_TYPES.includes(t as BenchType)).slice(0, MAX_PATTERN_LENGTH)
  return h?.gender === "M" ? ["MM"] : h?.gender === "F" ? ["FF"] : []
}

// ── Configuration ───────────────────────────────────────────

/**
 * The configuration cleaned up against the session's halls: one entry per session hall, in the
 * session's hall order. Halls missing from it are not used; settings from older versions are read.
 */
/**
 * A student's class: department + batch (the batch fixes the year of study). When subjects are
 * entered for the session it is the paper they write, so two classes writing the same subject are
 * kept apart like one class.
 */
const classOf = (s: SeatStudent) => s.paper ?? categoryKey(s.department_id, s.batch)

/** The subject map of a configuration cleaned up: class key → positive subject id. */
export function cleanSubjects(subjects: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!subjects || typeof subjects !== "object") return out
  for (const [key, value] of Object.entries(subjects as Record<string, unknown>)) {
    const id = Math.floor(Number(value))
    if (key && Number.isFinite(id) && id > 0) out[key] = id
  }
  return out
}

/** A list of subject ids cleaned up: positive whole numbers, each once, in the order given. */
export function cleanSubjectIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map(v => Math.floor(Number(v))).filter(n => Number.isFinite(n) && n > 0))]
}

/**
 * The subject a student writes in the session, and where it comes from: their own mapping to one
 * of the session's subjects (the first, if several), else their class's subject, else none.
 */
export function sessionSubjectOf(s: SeatStudent, subjects: unknown, sessionSubjects: unknown): { id: number; from: "student" | "class"; also: number[] } | null {
  const written = cleanSubjectIds(sessionSubjects)
  const mine = written.filter(id => s.subject_ids?.includes(id))
  if (mine.length) return { id: mine[0], from: "student", also: mine.slice(1) }
  const id = cleanSubjects(subjects)[categoryKey(s.department_id, s.batch)]
  return id ? { id, from: "class", also: [] } : null
}

/** The students with the paper each writes in the session (sessionSubjectOf); students with none keep their class. */
export function applySessionSubjects<T extends SeatStudent>(students: T[], subjects: unknown, sessionSubjects?: unknown): T[] {
  return students.map(s => {
    const sub = sessionSubjectOf(s, subjects, sessionSubjects)
    const { paper: _old, ...rest } = s
    return (sub ? { ...rest, paper: `sub:${sub.id}` } : rest) as T
  })
}

/** Whether the subject rules apply: some student has a paper (subjects entered for the session). */
const bySubject = (students: SeatStudent[]) => students.some(s => s.paper !== undefined)

/**
 * The seats beside a seat across the aisle, in the bench columns to its left and right (same row):
 * a left seat's left neighbour is the right seat (or the chair) of the bench to its left; a right
 * seat's (or a chair's) right neighbour is the left seat of the bench to its right.
 */
function sideNeighbours(benchAt: (row: number, col: number) => Bench | undefined, row: number, col: number, side: "L" | "R"): { row: number; col: number; side: "L" | "R" }[] {
  const here = benchAt(row, col)
  const out: { row: number; col: number; side: "L" | "R" }[] = []
  if (side === "L") {
    const left = benchAt(row, col - 1)
    if (left) out.push({ row, col: col - 1, side: left.seats === 2 ? "R" : "L" })
  }
  if ((side === "R" || here?.seats === 1) && benchAt(row, col + 1)) out.push({ row, col: col + 1, side: "L" })
  return out
}

/** A hall's benches by position, for sideNeighbours. */
function benchFinder(benches: Bench[]) {
  const m = new Map(benches.map(b => [`${b.row}-${b.col}`, b]))
  return (row: number, col: number) => m.get(`${row}-${col}`)
}

export function normalizeConfig(config: Partial<SeatingConfig> | null | undefined, halls: SeatHall[]): SeatingConfig {
  const given = new Map<number, BenchType[]>()
  for (const h of config?.halls ?? []) {
    const id = Number(h?.hallId)
    if (!given.has(id)) given.set(id, hallPattern(h))
  }
  const mixGenders = config?.mixGenders === true
  return {
    // In roll number order a used hall is just "used": its pattern is kept as [MM].
    halls: halls.map(h => { const p = given.get(h.id) ?? []; return { hallId: h.id, pattern: mixGenders && p.length ? ["MM"] : p } }),
    classLimit: normalizeClassLimit(config?.classLimit), ...(mixGenders ? { mixGenders } : {}),
    ...(Object.keys(cleanSubjects(config?.subjects)).length ? { subjects: cleanSubjects(config?.subjects) } : {}),
    ...(cleanSubjectIds(config?.sessionSubjects).length ? { sessionSubjects: cleanSubjectIds(config?.sessionSubjects) } : {})
  }
}

/**
 * The fewest halls (by index into `seats`) whose seats add up to each possible total, found by
 * subset-sum over every combination: `pick(total)` returns the halls, or null if no combination
 * gives exactly that total. Among equal counts, earlier halls are preferred.
 */
function subsetSums(seats: number[]) {
  const total = seats.reduce((a, b) => a + b, 0)
  // fewest[i][s]: fewest of the first i halls that seat exactly s (Infinity: impossible).
  const fewest: number[][] = [new Array(total + 1).fill(Infinity)]
  fewest[0][0] = 0
  seats.forEach((n, i) => {
    const prev = fewest[i], next = [...prev]
    for (let s = n; s <= total; s++) if (prev[s - n] + 1 < next[s]) next[s] = prev[s - n] + 1
    fewest.push(next)
  })
  const last = fewest[seats.length]
  return {
    total,
    reachable: (s: number) => s >= 0 && s <= total && last[s] < Infinity,
    count: (s: number) => last[s],
    pick(s: number): number[] | null {
      if (!(last[s] < Infinity)) return null
      const out: number[] = []
      for (let i = seats.length; i > 0 && s > 0; i--) {
        if (fewest[i - 1][s] === fewest[i][s]) continue // hall i-1 not needed
        out.push(i - 1); s -= seats[i - 1]
      }
      return out.reverse()
    }
  }
}

/**
 * Whole halls handed to boys and girls so that as many students as possible are seated, trying
 * every combination of halls (subset sums over the hall seats), not just halls in order. Among the
 * combinations that seat the most students, the one with the fewest empty seats, then the fewest
 * halls, wins. Returns each hall's group (halls not needed are left out).
 */
function separateHalls(need: Record<Gender, number>, usable: SeatHall[]): Map<number, Gender> {
  const seats = usable.map(seatsOf)
  const all = subsetSums(seats)
  let best: { score: number[]; genders: Map<number, Gender> } | null = null
  for (const [first, second] of [["M", "F"], ["F", "M"]] as Gender[][]) {
    // The first group's seats: any total some combination of halls gives. The second group can
    // then use any of the remaining halls, so it can have up to all of the rest.
    let choice: { s: number; score: number[] } | null = null
    for (let s = 0; s <= all.total; s++) {
      if (!all.reachable(s)) continue
      const seated = Math.min(s, need[first]) + Math.min(all.total - s, need[second])
      const score = [-seated, Math.max(0, s - need[first]), all.count(s)]
      if (!choice || lexLess(score, choice.score)) choice = { s, score }
    }
    const firstHalls = new Set(all.pick(choice!.s)!)
    // The second group: the fewest seats (then halls) among the rest that hold all it can.
    const restIdx = seats.map((_, i) => i).filter(i => !firstHalls.has(i))
    const rest = subsetSums(restIdx.map(i => seats[i]))
    let r: { s: number; score: number[] } | null = null
    for (let s = 0; s <= rest.total; s++) {
      if (!rest.reachable(s)) continue
      const score = [-Math.min(s, need[second]), s, rest.count(s)]
      if (!r || lexLess(score, r.score)) r = { s, score }
    }
    const genders = new Map<number, Gender>()
    for (const i of firstHalls) genders.set(usable[i].id, first)
    for (const j of rest.pick(r!.s)!) genders.set(usable[restIdx[j]].id, second)

    const seatsFor = (g: Gender) => usable.filter(h => genders.get(h.id) === g).reduce((n, h) => n + seatsOf(h), 0)
    const seated = Math.min(seatsFor("M"), need.M) + Math.min(seatsFor("F"), need.F)
    const score = [-seated, seatsFor("M") + seatsFor("F") - seated, genders.size]
    if (!best || lexLess(score, best.score)) best = { score, genders }
  }
  return best!.genders
}

/**
 * A starting configuration that seats as many students as the halls can hold. Whole boys' and
 * girls' halls are tried first (every combination). If they leave someone out although there are
 * enough seats, the halls are filled in order instead: boys' halls, then ONE hall that holds both
 * (boy benches, then girl benches; an odd boy leaves one seat empty), then girls' halls, so that
 * everyone is seated. With `separateOnly`, no hall is shared: whole boys' and girls' halls only.
 */
export function autoConfigure(students: SeatStudent[], halls: SeatHall[], options: { separateOnly?: boolean; mixGenders?: boolean; classLimit?: Partial<ClassLimit> } = {}): SeatingConfig {
  // Roll number order: everyone as one group, in as few halls as seat them all.
  if (options.mixGenders) {
    const cfg = autoConfigure(asOneGroup(students), halls, { separateOnly: true, classLimit: options.classLimit })
    return { ...cfg, mixGenders: true }
  }
  const config: SeatingConfig = { ...hallSplit(students, halls, options), ...(options.classLimit ? { classLimit: normalizeClassLimit(options.classLimit) } : {}) }
  // Two of one class cannot share a bench and a hall holds only a few classes, so a group may need
  // more benches than its head count suggests: while someone is left out with every hall kept to
  // the preferred number of classes, give an unused hall to the group with most left out. (Only
  // when no hall is left may halls take more classes, up to the maximum: planSeating does that.)
  const limit = normalizeClassLimit(options.classLimit)
  for (;;) {
    const left = planSeating(students, halls, { ...config, classLimit: { preferred: limit.preferred, max: limit.preferred } }, "").unallocated
    const unused = halls.find(h => seatsOf(h) > 0 && config.halls.find(c => c.hallId === h.id)!.pattern.length === 0)
    if (left.length === 0 || !unused) return config
    const boys = left.filter(u => u.gender === "M").length
    config.halls = config.halls.map(c => c.hallId === unused.id ? { ...c, pattern: [boys * 2 >= left.length ? "MM" : "FF"] } : c)
  }
}

/** The students as one group (all "M"), for roll number order where gender is ignored. */
const asOneGroup = (students: SeatStudent[]): SeatStudent[] => students.map(s => ({ ...s, gender: "M" as Gender }))

/** autoConfigure's split of the halls between boys and girls, by head count. */
function hallSplit(students: SeatStudent[], halls: SeatHall[], options: { separateOnly?: boolean }): SeatingConfig {
  const need: Record<Gender, number> = { M: students.filter(s => s.gender === "M").length, F: students.filter(s => s.gender === "F").length }
  const usable = halls.filter(h => seatsOf(h) > 0)
  const total = usable.reduce((n, h) => n + seatsOf(h), 0)
  const separate = separateHalls(need, usable)
  const seatsFor = (g: Gender) => usable.filter(h => separate.get(h.id) === g).reduce((n, h) => n + seatsOf(h), 0)
  const separateSeated = Math.min(seatsFor("M"), need.M) + Math.min(seatsFor("F"), need.F)
  const patterns = new Map<number, BenchType[]>()
  if (options.separateOnly || separateSeated >= Math.min(total, need.M + need.F)) {
    for (const [id, g] of separate) patterns.set(id, [g === "M" ? "MM" : "FF"])
  } else {
    let boys = need.M, girls = need.F
    for (const h of usable) {
      const benches = enabledBenches(h), seats = seatsOf(h)
      if (boys >= seats) { patterns.set(h.id, ["MM"]); boys -= seats; continue }
      if (boys > 0) {
        // The hall where boys end and girls begin: boy benches, then girl benches, spelled out bench by bench.
        let boyBenches = 0
        for (let have = 0; have < boys; boyBenches++) have += benches[boyBenches].seats
        const p: BenchType[] = benches.map((_, i) => (i < boyBenches ? "MM" : "FF"))
        boys = 0; girls -= benches.slice(boyBenches).reduce((n, b) => n + b.seats, 0)
        patterns.set(h.id, p.every(t => t === p[0]) ? [p[0]] : p)
        continue
      }
      if (girls > 0) { patterns.set(h.id, ["FF"]); girls -= seats }
    }
  }
  return { halls: halls.map(h => ({ hallId: h.id, pattern: patterns.get(h.id) ?? [] })) }
}

/**
 * One bench pattern for the whole session: the halls take it in hall order until there are enough
 * seats for `need` boys and girls; halls not needed are not used. If even every hall is not
 * enough, every hall is used.
 */
export function configureWithPattern(need: Record<Gender, number>, halls: SeatHall[], pattern: BenchType[]): SeatingConfig {
  const have: Record<Gender, number> = { M: 0, F: 0 }
  const used = new Set<number>()
  for (const h of halls) {
    if (have.M >= need.M && have.F >= need.F) break
    if (seatsOf(h) === 0 || pattern.length === 0) continue
    const seats = patternSeats(pattern, enabledBenches(h))
    used.add(h.id); have.M += seats.M; have.F += seats.F
  }
  return { halls: halls.map(h => ({ hallId: h.id, pattern: used.has(h.id) ? pattern : [] })) }
}

/** Lexicographic comparison of two scores (lower is better). */
function lexLess(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]
  return false
}

/**
 * Why the session's halls cannot seat every selected student, with what would fix it; null when
 * they can (autoConfigure then seats everyone).
 */
export function seatingShortfall(students: SeatStudent[], halls: SeatHall[], classLimit?: Partial<ClassLimit>): string | null {
  const boys = students.filter(s => s.gender === "M").length, girls = students.length - boys
  const total = halls.reduce((n, h) => n + seatsOf(h), 0)
  if (students.length > total) {
    return `${students.length} students are selected (${boys} boys, ${girls} girls), but this session's halls have only ${total} seats. Add halls with at least ${students.length - total} more seats to the invigilator allocation, or select fewer students.`
  }
  const left = planSeating(students, halls, autoConfigure(students, halls, { classLimit }), "").unallocated.length
  if (left === 0) return null
  return `There are ${total} seats for ${students.length} students, but two students of the same class never share a bench and each hall holds only a few different classes, so some seats stay empty: ${left} cannot be seated. Add halls or benches, allow more classes per hall, or select fewer students of the largest classes.`
}

/**
 * Seats students the seat columns left over: a leftover student x takes the seat of a seated
 * student y of another class and the same gender (where x's new bench mate is not of x's class),
 * and y moves to an empty seat for that gender on another bench whose bench mate is not of y's class. Changes
 * `seats` and `pools` in place.
 */
function repairLeftovers(students: SeatStudent[], config: SeatingConfig, hallOf: Map<number, SeatHall>, seats: Seat[], pools: Record<Gender, Map<string, SeatStudent[]>>, most: number) {
  const studentById = new Map(students.map(s => [s.id, s]))
  // How many students of each class each hall holds, to keep every hall within its class limit.
  const inHall = new Map<number, Map<string, number>>()
  const count = (hallId: number, cls: string, by: number) => {
    const m = inHall.get(hallId) ?? new Map<string, number>()
    const n = (m.get(cls) ?? 0) + by
    if (n > 0) m.set(cls, n); else m.delete(cls)
    inHall.set(hallId, m)
  }
  for (const x of seats) count(x.hallId, classOf(studentById.get(x.studentId)!), 1)
  /** Whether a student of `cls` may join the hall without passing its limit (`leaving`: a class losing one student there). */
  const fits = (hallId: number, cls: string, leaving?: string) => {
    const m = inHall.get(hallId) ?? new Map<string, number>()
    if (m.has(cls) && !(cls === leaving && m.get(cls) === 1)) return true
    const size = m.size - (leaving && m.get(leaving) === 1 && leaving !== cls ? 1 : 0)
    return size < most
  }
  const seatKey = (hallId: number, benchNo: number, side: "L" | "R") => `${hallId}/${benchNo}/${side}`
  const at = new Map(seats.map(x => [seatKey(x.hallId, x.benchNo, x.seat), x]))
  // With subjects entered, the students beside a seat across the aisle count as well as the bench mate.
  const sides = bySubject(students)
  const finders = new Map(config.halls.map(c => [c.hallId, benchFinder(enabledBenches(hallOf.get(c.hallId)!))]))
  const classAt = (hallId: number, benchNo: number, side: "L" | "R") => {
    const m = at.get(seatKey(hallId, benchNo, side))
    return m ? classOf(studentById.get(m.studentId)!) : null
  }
  /** The classes a student in this seat must not share: the bench mate's and, with subjects, the side neighbours'. */
  const mateClass = (x: { hallId: number; row: number; col: number; benchNo: number; seat: "L" | "R" }): (string | null)[] => {
    const out = [classAt(x.hallId, x.benchNo, x.seat === "L" ? "R" : "L")]
    if (sides) {
      const find = finders.get(x.hallId)!
      for (const n of sideNeighbours(find, x.row, x.col, x.seat)) out.push(classAt(x.hallId, find(n.row, n.col)!.benchNo, n.side))
    }
    return out
  }
  // Every empty seat, with the gender its pattern gives it.
  const empty: { hallId: number; row: number; col: number; benchNo: number; seat: "L" | "R"; gender: Gender }[] = []
  for (const c of config.halls) {
    if (!c.pattern.length) continue
    enabledBenches(hallOf.get(c.hallId)!).forEach((b, i) => {
      for (const side of sidesOf(b)) {
        if (!at.has(seatKey(c.hallId, b.benchNo, side))) empty.push({ hallId: c.hallId, row: b.row, col: b.col, benchNo: b.benchNo, seat: side, gender: seatGender(c.pattern, i, side) })
      }
    })
  }
  for (const g of GENDERS) {
    for (const [cls, left] of pools[g]) {
      while (left.length) {
        const x = left[0]
        // Directly into an empty seat beside another class.
        const direct = empty.findIndex(e => e.gender === g && !mateClass(e).includes(cls) && fits(e.hallId, cls))
        if (direct >= 0) {
          const [e] = empty.splice(direct, 1)
          const seat: Seat = { studentId: x.id, hallId: e.hallId, row: e.row, col: e.col, benchNo: e.benchNo, seat: e.seat }
          seats.push(seat); at.set(seatKey(e.hallId, e.benchNo, e.seat), seat); left.shift(); count(e.hallId, cls, 1)
          continue
        }
        // By a swap: y (another class) moves to an empty seat beside neither class; x takes y's seat.
        let done = false
        for (const y of seats) {
          const ys = studentById.get(y.studentId)!, ycls = classOf(ys)
          if (ys.gender !== g || ycls === cls || mateClass(y).includes(cls)) continue
          // Within the hall limits: if y stays in its hall, x's class must fit beside y's; if y moves to
          // another hall, y's class leaves its hall and must fit in the new one.
          const e = empty.findIndex(e => e.gender === g && !mateClass(e).includes(ycls) && !(e.hallId === y.hallId && e.benchNo === y.benchNo)
            && (e.hallId === y.hallId ? fits(y.hallId, cls) : fits(y.hallId, cls, ycls) && fits(e.hallId, ycls)))
          if (e < 0) continue
          const [to] = empty.splice(e, 1)
          const moved: Seat = { studentId: y.studentId, hallId: to.hallId, row: to.row, col: to.col, benchNo: to.benchNo, seat: to.seat }
          seats.push(moved); at.set(seatKey(to.hallId, to.benchNo, to.seat), moved)
          count(y.hallId, ycls, -1); count(to.hallId, ycls, 1); count(y.hallId, cls, 1)
          y.studentId = x.id
          left.shift(); done = true
          break
        }
        if (!done) break
      }
    }
  }
}

/** Seats each hall's pattern gives each group, by hall id. */
function hallSeats(config: SeatingConfig, hallOf: Map<number, SeatHall>) {
  return new Map(config.halls.map(c => [c.hallId, patternSeats(c.pattern, enabledBenches(hallOf.get(c.hallId)!))]))
}

/**
 * Problems that stop a configuration from being used (errors) and shortfalls to know about
 * (warnings). The screen shows them while the administrator edits.
 */
export function checkConfig(rawConfig: Partial<SeatingConfig> | null | undefined, halls: SeatHall[], students: SeatStudent[]): { errors: string[]; warnings: string[] } {
  const config = normalizeConfig(rawConfig, halls)
  const errors: string[] = [], warnings: string[] = []
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const seatsIn = hallSeats(config, hallOf)
  for (const c of config.halls) {
    const hall = hallOf.get(c.hallId)!
    if (c.pattern.length && seatsOf(hall) === 0) errors.push(`Hall ${hall.hall_code} has no bench layout. Set its rows and columns in Master Data → Halls, or mark it Not used.`)
  }
  if (config.mixGenders) {
    const seats = [...seatsIn.values()].reduce((sum, x) => sum + x.M + x.F, 0)
    if (students.length > seats) warnings.push(`${students.length} students are selected, but the halls used have only ${seats} seats: ${students.length - seats} will be unallocated.`)
    return { errors, warnings }
  }
  for (const g of GENDERS) {
    const n = students.filter(s => s.gender === g).length
    if (n === 0) continue
    const seats = [...seatsIn.values()].reduce((sum, x) => sum + x[g], 0)
    if (seats === 0) warnings.push(`${n} ${groupWordOf(g)} are selected, but no hall has seats for ${groupWordOf(g)}.`)
    else if (n > seats) warnings.push(`${n} ${groupWordOf(g)} are selected, but the halls have only ${seats} seats for ${groupWordOf(g)}: ${n - seats} will be unallocated.`)
  }
  return { errors, warnings }
}

// ── Planning ────────────────────────────────────────────────

/**
 * The seating plan: halls in order, benches in order, left seat then right seat; each seat takes
 * the next student of the gender its bench pattern gives it, or stays empty when that group has
 * run out. `academicYear` is only used to name each student's year in summaries and reasons.
 */
export function planSeating(students: SeatStudent[], halls: SeatHall[], rawConfig: Partial<SeatingConfig> | null | undefined, academicYear: unknown, together = false): SeatingPlan {
  const config = normalizeConfig(rawConfig, halls)
  if (config.mixGenders) return planTogether(students, halls, config, academicYear)
  const groupWord = together ? () => "students" : groupWordOf
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const seatsIn = hallSeats(config, hallOf)
  const sides = bySubject(students)
  // Each group's students by class, each class in seating order.
  let pools: Record<Gender, Map<string, SeatStudent[]>> = { M: new Map(), F: new Map() }
  for (const s of [...students].sort(seatingOrder)) pools[s.gender].set(classOf(s), [...(pools[s.gender].get(classOf(s)) ?? []), s])
  // The classes take the seat columns in turn (largest first; equal sizes keep batch order).
  const bySize = (g: Gender) => [...pools[g].keys()].sort((a, b) => pools[g].get(b)!.length - pools[g].get(a)!.length)
  const order: Record<Gender, string[]> = { M: bySize("M"), F: bySize("F") }
  const limit = config.classLimit!
  /** What is still waiting: each class's students, and per gender the next class in turn. */
  type State = { pools: Record<Gender, Map<string, SeatStudent[]>>; turn: Record<Gender, number> }
  const copy = (st: State): State => ({
    pools: { M: new Map([...st.pools.M].map(([k, v]) => [k, [...v]])), F: new Map([...st.pools.F].map(([k, v]) => [k, [...v]])) },
    turn: { ...st.turn }
  })
  const seats: Seat[] = []
  const hallGender: Record<number, HallGroup> = {}
  const warnings: string[] = []

  /** Fills one hall from `st` with at most `most` different classes; returns its seats and the seats wasted. */
  const fillHall = (c: HallSeatingConfig, hall: SeatHall, st: State, most: number) => {
    const benches = enabledBenches(hall)
    const out: Seat[] = []
    const classes = new Set<string>()
    let empty = 0
    /** The next class in turn with students, not one of `avoid` (the bench mate's; with subjects also the side neighbours'), and within the hall's limit. */
    const nextClass = (g: Gender, avoid: (string | null)[]): string | null => {
      const list = order[g]
      for (let k = 0; k < list.length; k++) {
        const i = (st.turn[g] + k) % list.length, cls = list[i]
        if (st.pools[g].get(cls)!.length && !avoid.includes(cls) && (classes.has(cls) || classes.size < most)) {
          st.turn[g] = (i + 1) % list.length
          classes.add(cls)
          return cls
        }
      }
      return null
    }
    // Benches are numbered column by column, front to back (hall-layout.ts).
    const columns = new Map<number, number[]>()
    benches.forEach((b, i) => columns.set(b.col, [...(columns.get(b.col) ?? []), i]))
    const leftClass = new Map<number, string>()
    // With subjects entered: the class placed at each seat, to keep side neighbours apart.
    const find = benchFinder(benches)
    const placed = new Map<string, string>()
    for (const column of columns.values()) {
      for (const side of ["L", "R"] as const) {
        // The class of this seat column, per gender; chosen when its first seat is filled.
        const seatColumn: Record<Gender, string | null> = { M: null, F: null }
        for (const i of column) {
          const b = benches[i]
          if (side === "R" && b.seats === 1) continue // a chair has only the one seat
          const g = seatGender(c.pattern, i, side)
          const mate = side === "R" ? leftClass.get(i) ?? null : null
          const avoid = [mate, ...(sides ? sideNeighbours(find, b.row, b.col, side).map(n => placed.get(`${n.row}-${n.col}-${n.side}`) ?? null) : [])]
          let cls = seatColumn[g]
          if (!cls || !st.pools[g].get(cls)!.length || avoid.includes(cls)) cls = seatColumn[g] = nextClass(g, avoid)
          if (!cls) { empty++; continue }
          const s = st.pools[g].get(cls)!.shift()!
          if (side === "L") leftClass.set(i, cls)
          if (sides) placed.set(`${b.row}-${b.col}-${side}`, cls)
          out.push({ studentId: s.id, hallId: hall.id, row: b.row, col: b.col, benchNo: b.benchNo, seat: side })
        }
      }
    }
    // Seats left empty although students of that gender are still waiting.
    const waiting = GENDERS.some(g => [...st.pools[g].values()].some(l => l.length))
    return { out, wasted: waiting ? empty : 0 }
  }

  /**
   * Every hall filled in turn. Without `relax`, each hall holds at most the preferred number of
   * classes. With it, a hall the preferred number would leave with empty seats while students wait
   * tries one class more, and so on up to the maximum, keeping the first that fills it.
   */
  const attempt = (relax: boolean) => {
    let state = copy({ pools, turn: { M: 0, F: 0 } })
    const out: Seat[] = []
    for (const c of config.halls) {
      if (!c.pattern.length) continue
      const hall = hallOf.get(c.hallId)!
      let best: { st: State; out: Seat[]; wasted: number } | null = null
      for (let most = limit.preferred; most <= (relax ? limit.max : limit.preferred); most++) {
        const st = copy(state)
        const filled = fillHall(c, hall, st, most)
        if (!best || filled.wasted < best.wasted) best = { st, out: filled.out, wasted: filled.wasted }
        if (filled.wasted === 0) break
      }
      state = best!.st
      out.push(...best!.out)
    }
    repairLeftovers(students, config, hallOf, out, state.pools, relax ? limit.max : limit.preferred)
    const left = GENDERS.reduce((n, g) => n + [...state.pools[g].values()].reduce((m, l) => m + l.length, 0), 0)
    return { out, pools: state.pools, left }
  }
  // The preferred number of classes in every hall, unless that leaves students without a seat.
  let result = attempt(false)
  if (result.left > 0 && limit.max > limit.preferred) {
    const relaxed = attempt(true)
    if (relaxed.left < result.left) result = relaxed
  }
  seats.push(...result.out)
  pools = result.pools

  const studentById = new Map(students.map(s => [s.id, s]))
  const summaries: HallSummary[] = config.halls.map(c => {
    const hall = hallOf.get(c.hallId)!
    const benches = enabledBenches(hall)
    hallGender[hall.id] = patternGroup(c.pattern)
    const list = seats.filter(x => x.hallId === hall.id).map(x => studentById.get(x.studentId)!)
    const counts = new Map<string, { key: string; label: string; count: number }>()
    for (const s of list) {
      const cat = studentCategory(s, academicYear)
      const e = counts.get(cat.key) ?? { ...cat, count: 0 }
      e.count++; counts.set(cat.key, e)
    }
    if (c.pattern.length && benches.length === 0) warnings.push(`Hall ${hall.hall_code} has no bench layout, so no students were seated there. Set its rows and columns in Master Data → Halls.`)
    else if (c.pattern.length && list.length === 0) warnings.push(`Hall ${hall.hall_code}: no students in this hall.`)
    return {
      hallId: hall.id, hall_code: hall.hall_code, gender: hallGender[hall.id], pattern: c.pattern, benches: benches.length, capacity: seatsOf(hall),
      seatsFor: seatsIn.get(hall.id)!, occupied: list.length, empty: seatsOf(hall) - list.length, categories: [...counts.values()]
    }
  })

  const unallocated: UnallocatedStudent[] = []
  const groups = {} as SeatingPlan["groups"]
  for (const g of GENDERS) {
    const capacity = summaries.reduce((n, h) => n + h.seatsFor[g], 0)
    const total = students.filter(s => s.gender === g).length
    const left = [...pools[g].values()].flat().sort(seatingOrder)
    const seated = total - left.length
    const reason = capacity === 0 ? `No hall has seats for ${groupWord(g)}.`
      : seated < capacity ? `No free seat beside a student of another class: two students of the same class never share a bench and each hall holds only a few different classes, so some ${groupWord(g)}' seats had to stay empty. Add halls or benches for ${groupWord(g)}, or allow more classes per hall.`
      : `Not enough seats: every seat for ${groupWord(g)} is taken.`
    for (const s of left) {
      const cat = studentCategory(s, academicYear)
      unallocated.push({ studentId: s.id, roll_no: s.roll_no, name: s.name, gender: g, categoryKey: cat.key, category: cat.label, reason })
    }
    groups[g] = { students: total, seated, unallocated: left.length, halls: summaries.filter(h => h.seatsFor[g] > 0).length, seats: capacity }
  }
  return { seats, hallGender, halls: summaries, unallocated, warnings, groups }
}

/**
 * Roll number order: the students are seated as one group (gender ignored), then each keeps their
 * own gender in the result: who each hall holds, the unallocated list and each group's totals.
 */
function planTogether(students: SeatStudent[], halls: SeatHall[], config: SeatingConfig, academicYear: unknown): SeatingPlan {
  const plan = planSeating(asOneGroup(students), halls, { ...config, mixGenders: false }, academicYear, true)
  const genderOf = new Map(students.map(s => [s.id, s.gender]))
  const hallGender: Record<number, HallGroup> = {}
  for (const h of plan.halls) {
    const g = new Set(plan.seats.filter(x => x.hallId === h.hallId).map(x => genderOf.get(x.studentId)!))
    hallGender[h.hallId] = h.pattern.length === 0 ? null : g.size === 1 ? [...g][0] : "mixed"
  }
  const unallocated = plan.unallocated.map(u => ({ ...u, gender: genderOf.get(u.studentId)! }))
  const capacity = plan.halls.reduce((n, h) => n + (h.pattern.length ? h.capacity : 0), 0)
  const groups = {} as SeatingPlan["groups"]
  for (const g of GENDERS) {
    const total = students.filter(s => s.gender === g).length, left = unallocated.filter(u => u.gender === g).length
    groups[g] = { students: total, seated: total - left, unallocated: left, halls: plan.halls.filter(h => h.pattern.length).length, seats: capacity }
  }
  return { ...plan, hallGender, halls: plan.halls.map(h => ({ ...h, gender: hallGender[h.hallId] })), unallocated, groups }
}

// ── Validation ──────────────────────────────────────────────

/**
 * Checks a plan against the rules, independently of how it was made. Any error means the plan
 * must not be saved.
 */
export function validateSeatingPlan(plan: Pick<SeatingPlan, "seats" | "unallocated">, students: SeatStudent[], halls: SeatHall[], rawConfig: Partial<SeatingConfig> | null | undefined): { errors: string[] } {
  const config = normalizeConfig(rawConfig, halls)
  const errors: string[] = []
  const studentOf = new Map(students.map(s => [s.id, s]))
  const hallOf = new Map(halls.map(h => [h.id, h]))
  const patternOf = new Map(config.halls.map(c => [c.hallId, c.pattern]))

  // Every selected student exactly once, either seated or listed as unallocated.
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
    const hall = hallOf.get(seat.hallId)
    if (!hall) { errors.push(`A student is seated in hall #${seat.hallId}, which is not one of this session's halls.`); continue }
    byHall.set(hall.id, [...(byHall.get(hall.id) ?? []), seat])
  }

  for (const [hallId, list] of byHall) {
    const hall = hallOf.get(hallId)!, code = hall.hall_code
    const pattern = patternOf.get(hallId) ?? []
    if (pattern.length === 0) { errors.push(`Hall ${code} is not used in this session but has students.`); continue }
    // Every seat holds the gender its bench pattern gives it.
    const hallBenches = enabledBenches(hall)
    const index = new Map(hallBenches.map((b, i) => [`${b.row}-${b.col}-${b.benchNo}`, i]))
    for (const x of list) {
      const i = index.get(`${x.row}-${x.col}-${x.benchNo}`)
      if (i === undefined) { errors.push(`Hall ${code}: bench ${x.benchNo} does not exist.`); continue }
      if (x.seat === "R" && hallBenches[i].seats === 1) { errors.push(`Hall ${code}, seat ${x.benchNo} is a single chair but has a student in a right seat.`); continue }
      if (config.mixGenders) continue // roll number order: any seat for anyone
      const s = studentOf.get(x.studentId), want = seatGender(pattern, i, x.seat)
      if (s && s.gender !== want) errors.push(`Hall ${code}, bench ${x.benchNo}: ${s.roll_no} sits in the ${x.seat === "L" ? "left" : "right"} seat, which the bench pattern gives to a ${want === "M" ? "boy" : "girl"}.`)
    }
    // No more different classes than the limit.
    const classes = new Set(list.map(x => studentOf.get(x.studentId)).filter((x): x is SeatStudent => !!x).map(classOf))
    if (classes.size > config.classLimit!.max) errors.push(`Hall ${code} has ${classes.size} different classes, more than the limit of ${config.classLimit!.max}.`)
    // At most two students per bench, one per seat.
    const benches = new Map<number, Seat[]>()
    for (const x of list) benches.set(x.benchNo, [...(benches.get(x.benchNo) ?? []), x])
    const seatsAt = new Map(hallBenches.map(b => [b.benchNo, b.seats]))
    for (const [no, b] of benches) {
      const most = seatsAt.get(no) ?? 2
      if (b.length > most) errors.push(`Hall ${code}, ${most === 1 ? "chair" : "bench"} ${no} has ${b.length} students (at most ${most}).`)
      if (new Set(b.map(x => x.seat)).size !== b.length) errors.push(`Hall ${code}, bench ${no}: two students in the same seat.`)
      const mates = b.map(x => studentOf.get(x.studentId)).filter((x): x is SeatStudent => !!x)
      if (mates.length === 2 && classOf(mates[0]) === classOf(mates[1])) {
        errors.push(mates[0].paper !== undefined
          ? `Hall ${code}, bench ${no}: ${mates[0].roll_no} and ${mates[1].roll_no} write the same subject.`
          : `Hall ${code}, bench ${no}: ${mates[0].roll_no} and ${mates[1].roll_no} are from the same class.`)
      }
    }
    // With subjects entered: students side by side across the aisle never write the same subject.
    if (bySubject(students)) {
      const find = benchFinder(hallBenches)
      const byPos = new Map(list.map(x => [`${x.row}-${x.col}-${x.seat}`, x]))
      for (const x of list) {
        const s = studentOf.get(x.studentId)
        if (!s?.paper) continue
        for (const n of sideNeighbours(find, x.row, x.col, x.seat)) {
          if (n.col < x.col) continue // each pair once, from its left-hand seat
          const y = byPos.get(`${n.row}-${n.col}-${n.side}`), t = y && studentOf.get(y.studentId)
          if (t && t.paper === s.paper) errors.push(`Hall ${code}, row ${x.row}: ${s.roll_no} and ${t.roll_no} sit side by side and write the same subject.`)
        }
      }
    }
  }
  return { errors }
}

/** A short message naming how many students are unallocated, or null when everyone is seated. */
export function unallocatedMessage(plan: Pick<SeatingPlan, "unallocated">): string | null {
  const parts = GENDERS.map(g => [g, plan.unallocated.filter(u => u.gender === g).length] as const).filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${g === "M" ? "boy" : "girl"}${n === 1 ? "" : "s"}`)
  return parts.length ? `${parts.join(" and ")} could not be seated: not enough seats for them in the halls.` : null
}
