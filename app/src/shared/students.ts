/**
 * STUDENTS AND SEATING: the student master list and each session's seating plan.
 *
 * Unlike the rest of src/shared/ this module reads and writes the database, through the small
 * `StudentDb` interface that both the desktop database (src/main/db/database.ts) and the browser
 * one (web-db.ts) provide. The desktop IPC handlers and web-api.ts call the same functions, so the
 * rules live in one place.
 */
import { validateStudent, parseGender, normalizeStudentBatch, normalizeStudentSection } from "./validation"
import { hallLayout, cleanDisabled, cleanKinds, benchCount, seatCount, validateHallLayout, enabledBenches, benchKey } from "./hall-layout"
import {
  planSeating, validateSeatingPlan, checkConfig, normalizeConfig, autoConfigure, studentCategory, unallocatedMessage, seatingShortfall, applySessionSubjects, sessionSubjectOf,
  type SeatStudent, type SeatHall, type SeatingConfig, type UnallocatedStudent, type ClassLimit
} from "./seating"
import { yearOfStudy, categoryLabel } from "./categories"

export interface StudentDb {
  run(sql: string, params?: any[]): { lastInsertRowid: number; changes: number }
  query<T = any>(sql: string, params?: any[]): T[]
  queryOne<T = any>(sql: string, params?: any[]): T | undefined
  runTransaction<T>(fn: () => Promise<T> | T): Promise<T>
}

// ── Schema ──────────────────────────────────────────────────

/**
 * Migration 008 (both builds): bench layout on halls, the students table and seat_allocations.
 * It only adds columns and tables, so existing data is untouched.
 */
export function migrateStudentsAndSeating(db: Pick<StudentDb, "run" | "query">): void {
  const cols = db.query<any>("PRAGMA table_info(halls)").map((c: any) => c.name)
  if (!cols.includes("bench_rows")) db.run("ALTER TABLE halls ADD COLUMN bench_rows INTEGER DEFAULT 0")
  if (!cols.includes("bench_cols")) db.run("ALTER TABLE halls ADD COLUMN bench_cols INTEGER DEFAULT 0")
  if (!cols.includes("disabled_benches")) db.run("ALTER TABLE halls ADD COLUMN disabled_benches TEXT DEFAULT '[]'")

  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roll_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    register_no TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('M','F')),
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    batch TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
  db.run("CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch)")

  db.run(`CREATE TABLE IF NOT EXISTS seat_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    bench_row INTEGER NOT NULL,
    bench_col INTEGER NOT NULL,
    bench_no INTEGER NOT NULL,
    seat TEXT NOT NULL CHECK (seat IN ('L','R')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, student_id),
    UNIQUE(session_id, hall_id, bench_row, bench_col, seat)
  )`)
  db.run("CREATE INDEX IF NOT EXISTS idx_seat_allocations_session ON seat_allocations(session_id)")
}

/**
 * Migration 009 (both builds): an optional default category limit on halls, and each session's
 * seating configuration with the students selected and the list of those left unallocated.
 */
export function migrateSeatingConfig(db: Pick<StudentDb, "run" | "query">): void {
  const cols = db.query<any>("PRAGMA table_info(halls)").map((c: any) => c.name)
  if (!cols.includes("default_max_categories")) db.run("ALTER TABLE halls ADD COLUMN default_max_categories INTEGER")
  db.run(`CREATE TABLE IF NOT EXISTS seating_configs (
    session_id INTEGER PRIMARY KEY REFERENCES exam_sessions(id) ON DELETE CASCADE,
    config TEXT NOT NULL,
    student_ids TEXT NOT NULL DEFAULT '[]',
    unallocated TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
}

/**
 * Migration 010 (both builds): the student's section (A, B, ...), so CSE + section A + 2023-2027
 * names one class. Students saved before this have an empty section until they are edited.
 */
export function migrateStudentSection(db: Pick<StudentDb, "run" | "query">): void {
  const cols = db.query<any>("PRAGMA table_info(students)").map((c: any) => c.name)
  if (!cols.includes("section")) db.run("ALTER TABLE students ADD COLUMN section TEXT NOT NULL DEFAULT ''")
}

/**
 * Migration 011 (both builds): what stands at each seating position of a hall — a bench (two
 * students) or a chair (one student). Existing halls keep all benches.
 */
export function migrateSeatKinds(db: Pick<StudentDb, "run" | "query">): void {
  const cols = db.query<any>("PRAGMA table_info(halls)").map((c: any) => c.name)
  if (!cols.includes("seat_kinds")) db.run("ALTER TABLE halls ADD COLUMN seat_kinds TEXT DEFAULT '{}'")
}

// ── Hall bench layout ───────────────────────────────────────

export interface HallLayoutInput { bench_rows?: unknown; bench_cols?: unknown; disabled_benches?: unknown; seat_kinds?: unknown; capacity?: unknown }

/**
 * The bench layout columns to save with a hall, or the problem with them. When a layout is given, the hall's capacity becomes its seats (two per bench,
 * one per chair) so the two can never disagree.
 */
export function hallLayoutColumns(data: HallLayoutInput): { error: string } | { bench_rows: number; bench_cols: number; disabled_benches: string; seat_kinds: string; capacity: number | null } {
  const problem = validateHallLayout(data.bench_rows, data.bench_cols)
  if (problem) return { error: problem }
  const layout = hallLayout(data)
  const disabled = cleanDisabled(layout)
  const kinds = cleanKinds({ ...layout, disabled })
  const benches = benchCount({ ...layout, disabled })
  if (layout.rows > 0 && benches === 0) return { error: "Every bench is switched off. Keep at least one bench or chair, or set rows and columns to 0." }
  return {
    bench_rows: layout.rows, bench_cols: layout.cols, disabled_benches: JSON.stringify(disabled), seat_kinds: JSON.stringify(kinds),
    capacity: layout.rows > 0 ? seatCount({ ...layout, disabled, kinds }) : null
  }
}

// ── Student master ──────────────────────────────────────────

export interface StudentInput {
  id?: number; roll_no: string; register_no: string; name: string; gender: string
  department_id?: number | null; section: string; batch: string; is_active?: boolean
}

const STUDENT_SELECT = `SELECT s.id, s.roll_no, s.register_no, s.name, s.gender, s.department_id, s.section, s.batch, s.is_active,
  d.code as department_code, d.name as department_name
  FROM students s LEFT JOIN departments d ON s.department_id = d.id`

export function listStudents(db: StudentDb, filters: { batch?: string; department_id?: number; section?: string; gender?: string; is_active?: boolean } = {}) {
  let sql = `${STUDENT_SELECT} WHERE 1=1`
  const params: any[] = []
  if (filters.batch) { sql += " AND s.batch = ?"; params.push(filters.batch) }
  if (filters.department_id) { sql += " AND s.department_id = ?"; params.push(filters.department_id) }
  if (filters.section) { sql += " AND s.section = ?"; params.push(normalizeStudentSection(filters.section)) }
  if (filters.gender) { sql += " AND s.gender = ?"; params.push(filters.gender) }
  if (filters.is_active !== undefined) { sql += " AND s.is_active = ?"; params.push(filters.is_active ? 1 : 0) }
  sql += " ORDER BY s.batch, d.code COLLATE NOCASE, s.roll_no"
  const rows = db.query<any>(sql, params)
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  return rows.sort((a, b) => a.batch.localeCompare(b.batch) || order.compare(a.roll_no, b.roll_no))
}

/** The batches students belong to, oldest first. */
export function listStudentBatches(db: StudentDb): string[] {
  return db.query<any>("SELECT DISTINCT batch FROM students ORDER BY batch").map(r => r.batch)
}

/** Roll and register numbers are unique ignoring letter case; the clash is reported by name. */
function studentClash(db: StudentDb, rollNo: string, registerNo: string, id: number): string | null {
  const roll = db.queryOne<any>("SELECT roll_no, name FROM students WHERE roll_no = ? COLLATE NOCASE AND id != ?", [rollNo, id])
  if (roll) return `Roll Number ${roll.roll_no} is already used by ${roll.name}.`
  const reg = db.queryOne<any>("SELECT register_no, name FROM students WHERE register_no = ? COLLATE NOCASE AND id != ?", [registerNo, id])
  if (reg) return `Register Number ${reg.register_no} is already used by ${reg.name}.`
  return null
}

export function saveStudent(db: StudentDb, data: StudentInput): { success: true; student: any } | { success: false; error: string } {
  const problem = validateStudent(data ?? {})
  if (problem) return { success: false, error: problem }
  const rollNo = String(data.roll_no).trim(), registerNo = String(data.register_no).trim(), name = String(data.name).trim().replace(/\s+/g, " ")
  const gender = parseGender(data.gender)!, section = normalizeStudentSection(data.section), batch = normalizeStudentBatch(data.batch)
  const departmentId = data.department_id ? Number(data.department_id) : null
  if (!departmentId) return { success: false, error: "Department is required." }
  const clash = studentClash(db, rollNo, registerNo, data.id ?? 0)
  if (clash) return { success: false, error: clash }
  if (data.id) {
    db.run(`UPDATE students SET roll_no=?, register_no=?, name=?, gender=?, department_id=?, section=?, batch=?, is_active=?, updated_at=datetime('now') WHERE id=?`,
      [rollNo, registerNo, name, gender, departmentId, section, batch, data.is_active === false ? 0 : 1, data.id])
    return { success: true, student: db.queryOne(`${STUDENT_SELECT} WHERE s.id = ?`, [data.id]) }
  }
  const { lastInsertRowid } = db.run("INSERT INTO students(roll_no, register_no, name, gender, department_id, section, batch, is_active) VALUES(?,?,?,?,?,?,?,1)",
    [rollNo, registerNo, name, gender, departmentId, section, batch])
  return { success: true, student: db.queryOne(`${STUDENT_SELECT} WHERE s.id = ?`, [lastInsertRowid]) }
}

/** Removes a student who has never been seated; one with seating records can only be deactivated. */
export function deleteStudent(db: StudentDb, id: number): { success: boolean; error?: string } {
  if (db.queryOne("SELECT id FROM seat_allocations WHERE student_id = ? LIMIT 1", [id])) {
    return { success: false, error: "This student has seating records, so they cannot be deleted. Edit them and untick Active instead." }
  }
  db.run("DELETE FROM students WHERE id = ?", [id])
  return { success: true }
}

// Column names accepted in the student import sheet (header row), ignoring case.
const ROLL_HEADERS = ["roll no", "roll number", "roll_no", "rollno", "roll"]
const REGISTER_HEADERS = ["register no", "register number", "register_no", "registerno", "reg no", "reg number", "reg_no", "regno"]
const NAME_HEADERS = ["name", "student name", "full name"]
const GENDER_HEADERS = ["gender", "sex"]
const DEPT_HEADERS = ["department", "department code", "dept", "dept code", "department_code"]
const SECTION_HEADERS = ["section", "sec", "class section"]
const BATCH_HEADERS = ["batch", "student batch", "batch year", "batch years"]
export const STUDENT_IMPORT_COLUMNS = ["Roll No", "Register No", "Name", "Gender", "Department", "Section", "Batch"]

/**
 * Imports students from a sheet's rows (the first row is the header; the screen reads the file
 * with SheetJS, `header: 1`). Every skipped row gets a reason, as in the staff import.
 */
export function importStudents(db: StudentDb, rows: unknown[][]) {
  const header = (rows[0] ?? []).map(h => String(h ?? "").trim().toLowerCase())
  const col = (names: string[]) => header.findIndex(h => names.includes(h))
  const idx = { roll: col(ROLL_HEADERS), reg: col(REGISTER_HEADERS), name: col(NAME_HEADERS), gender: col(GENDER_HEADERS), dept: col(DEPT_HEADERS), section: col(SECTION_HEADERS), batch: col(BATCH_HEADERS) }
  const missing = STUDENT_IMPORT_COLUMNS.filter((_, i) => Object.values(idx)[i] === -1)
  if (missing.length) {
    return { success: false as const, missingColumns: missing,
      error: `This Excel file is missing required column(s): ${missing.join(", ")}. The first row must name the columns ${STUDENT_IMPORT_COLUMNS.join(", ")}.` }
  }
  const body = rows.slice(1).map((r, i) => ({ r: r ?? [], excelRow: i + 2 })).filter(({ r }) => r.some(c => String(c ?? "").trim() !== ""))
  if (body.length === 0) return { success: false as const, error: "This Excel file has no data rows below the header." }

  let inserted = 0
  const issues: { row: number; reason: string }[] = []
  for (const { r, excelRow } of body) {
    const cell = (i: number) => String(r[i] ?? "").trim()
    const deptValue = cell(idx.dept)
    if (!deptValue) { issues.push({ row: excelRow, reason: "Missing Department" }); continue }
    const dept = db.queryOne<any>("SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE ORDER BY (code = ? COLLATE NOCASE) DESC, id LIMIT 1", [deptValue, deptValue, deptValue])
    if (!dept) { issues.push({ row: excelRow, reason: `Department "${deptValue}" does not match any existing department (check Master Data → Departments).` }); continue }
    const r2 = saveStudent(db, { roll_no: cell(idx.roll), register_no: cell(idx.reg), name: cell(idx.name), gender: cell(idx.gender), department_id: dept.id, section: cell(idx.section), batch: cell(idx.batch) })
    if (r2.success) inserted++
    else issues.push({ row: excelRow, reason: `${r2.error}${cell(idx.roll) ? ` (Roll No "${cell(idx.roll)}")` : ""}` })
  }
  return { success: true as const, inserted, skipped: issues.length, issues }
}

// ── Session seating ─────────────────────────────────────────

/** The session's halls (those of its invigilator allocation), in hall order, with their layouts. */
function sessionHalls(db: StudentDb, sessionId: number): SeatHall[] {
  return db.query<any>(
    `SELECT DISTINCT h.* FROM allocations a JOIN halls h ON h.id = a.hall_id WHERE a.session_id = ? ORDER BY h.sort_order, h.id`, [sessionId]
  ).map(h => ({ id: h.id, hall_code: h.hall_code, ...hallLayout(h) }))
}

/** The academic year of the session's exam cycle ("2025-2026"), from which students' years are worked out. */
function sessionAcademicYear(db: StudentDb, sessionId: number): string | null {
  return db.queryOne<any>("SELECT ec.academic_year FROM exam_sessions es JOIN exam_cycles ec ON ec.id = es.cycle_id WHERE es.id = ?", [sessionId])?.academic_year ?? null
}

type SeatingInput = { academicYear: string; halls: SeatHall[]; students: SeatStudent[] }

/** Everything a plan needs, or the reason it cannot be made. */
function seatingInput(db: StudentDb, sessionId: number, studentIds: number[]): { error: string } | SeatingInput {
  if (!db.queryOne<any>("SELECT id FROM exam_sessions WHERE id = ?", [sessionId])) return { error: "Exam session not found." }
  const ids = [...new Set((studentIds ?? []).map(Number))]
  if (ids.length === 0) return { error: "Select the students writing this session." }
  const halls = sessionHalls(db, sessionId)
  if (halls.length === 0) return { error: "Generate the invigilator allocation first: students are seated in the same halls." }
  const students = db.query<any>(
    `SELECT s.id, s.roll_no, s.name, s.gender, s.batch, s.department_id, s.is_active, d.code as dept_code
     FROM students s LEFT JOIN departments d ON d.id = s.department_id WHERE s.id IN (${ids.map(() => "?").join(",")})`, ids)
  if (students.length !== ids.length) return { error: "Some of the selected students no longer exist. Reopen the selection and try again." }
  const inactive = students.filter((s: any) => !s.is_active)
  if (inactive.length) return { error: `Inactive students cannot be seated: ${inactive.slice(0, 5).map((s: any) => s.roll_no).join(", ")}${inactive.length > 5 ? "…" : ""}.` }
  // The subjects each student is mapped to (Master Data → Subjects → Students).
  const mapped = new Map<number, number[]>()
  for (const r of db.query<any>(`SELECT student_id, subject_id FROM student_subjects WHERE student_id IN (${ids.map(() => "?").join(",")})`, ids)) {
    mapped.set(r.student_id, [...(mapped.get(r.student_id) ?? []), r.subject_id])
  }
  for (const s of students) if (mapped.has(s.id)) s.subject_ids = mapped.get(s.id)
  return { academicYear: sessionAcademicYear(db, sessionId) ?? "", halls, students: students as SeatStudent[] }
}

/** The session's halls as the configuration screen shows them. */
const hallInfo = (halls: SeatHall[]) => halls.map(h => ({ id: h.id, hall_code: h.hall_code, benches: benchCount(h), capacity: seatCount(h) }))

/** The saved configuration of a session, with the students selected and those left unallocated; null if none. */
export function getSeatingConfig(db: StudentDb, sessionId: number): { config: SeatingConfig; studentIds: number[]; unallocated: UnallocatedStudent[] } | null {
  const row = db.queryOne<any>("SELECT config, student_ids, unallocated FROM seating_configs WHERE session_id = ?", [sessionId])
  if (!row) return null
  const parse = (text: string, fallback: any) => { try { return JSON.parse(text) ?? fallback } catch { return fallback } }
  return { config: parse(row.config, { halls: [] }), studentIds: parse(row.student_ids, []), unallocated: parse(row.unallocated, []) }
}

/**
 * The starting point for the configuration screen: the session's halls, how many boys and girls
 * are selected, and the halls handed to boys and girls automatically (shared/seating.ts).
 */
export interface SubjectOptions { subjects?: Record<string, number>; sessionSubjects?: number[] }

export function autoConfigureSeating(db: StudentDb, sessionId: number, studentIds: number[], classLimit?: Partial<ClassLimit>, subjectOptions: SubjectOptions = {}) {
  const raw = seatingInput(db, sessionId, studentIds)
  if ("error" in raw) return { success: false as const, error: raw.error }
  // The subjects written (entered on the configuration screen), when given.
  const input = { ...raw, students: applySessionSubjects(raw.students, subjectOptions.subjects, subjectOptions.sessionSubjects) }
  const boys = input.students.filter(s => s.gender === "M").length
  return {
    /** The classes of the selected students, for entering the subject each writes. */
    classes: sessionClasses(raw.students, input.academicYear, subjectOptions.sessionSubjects),
    /** The subjects the selected students are mapped to, with how many of them each (to pick the subjects of this exam). */
    mappedSubjects: mappedSubjectCounts(raw.students),
    success: true as const, config: autoConfigure(input.students, input.halls, { classLimit }), academicYear: input.academicYear,
    /** The best split into whole boys' and girls' halls, no hall shared (the "Gender based allocation" method). */
    separateConfig: autoConfigure(input.students, input.halls, { separateOnly: true, classLimit }),
    /** Everyone in roll-number order, boys and girls together (the "Roll number order" method). */
    rollConfig: autoConfigure(input.students, input.halls, { mixGenders: true, classLimit }),
    halls: hallInfo(input.halls), boys, girls: input.students.length - boys,
    shortfall: seatingShortfall(input.students, input.halls, classLimit)
  }
}

/**
 * The classes (department + batch) among the students, with their names, sizes and departments, and
 * how many of each are mapped to one of the session's subjects (they need no class subject).
 */
function sessionClasses(students: SeatStudent[], academicYear: string, sessionSubjects?: number[]) {
  const out = new Map<string, { key: string; label: string; department_id: number | null; batch: string; count: number; mapped: number }>()
  for (const s of students) {
    const cat = studentCategory(s, academicYear)
    const e = out.get(cat.key) ?? { key: cat.key, label: cat.label, department_id: s.department_id, batch: s.batch, count: 0, mapped: 0 }
    e.count++
    if (sessionSubjectOf(s, {}, sessionSubjects)) e.mapped++
    out.set(cat.key, e)
  }
  return [...out.values()].sort((a, b) => a.batch.localeCompare(b.batch) || a.label.localeCompare(b.label))
}

/** How many of the students are mapped to each subject. */
function mappedSubjectCounts(students: SeatStudent[]) {
  const counts = new Map<number, number>()
  for (const s of students) for (const id of s.subject_ids ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({ id, count }))
}

function buildPlan(raw: SeatingInput, rawConfig: SeatingConfig) {
  const config = normalizeConfig(rawConfig, raw.halls)
  const input = { ...raw, students: applySessionSubjects(raw.students, config.subjects, config.sessionSubjects) }
  // A student mapped to two subjects written in the same exam writes the first; say so.
  const twice = raw.students.map(s => ({ s, sub: sessionSubjectOf(s, config.subjects, config.sessionSubjects) })).filter(x => x.sub?.also.length)
  const twiceWarning = twice.length
    ? [`${twice.length} student(s) are mapped to more than one subject of this exam and are seated for the first one chosen: ${twice.slice(0, 5).map(x => x.s.roll_no).join(", ")}${twice.length > 5 ? "…" : ""}. Check their subjects in Master Data → Subjects.`]
    : []
  const plan = planSeating(input.students, input.halls, config, input.academicYear)
  const checked = checkConfig(config, input.halls, input.students)
  const valid = validateSeatingPlan(plan, input.students, input.halls, config)
  const students = input.students.map(s => {
    const y = yearOfStudy(s.batch, input.academicYear)
    return { id: s.id, roll_no: s.roll_no, name: s.name, gender: s.gender, batch: s.batch, deptCode: s.dept_code ?? null, year: y.ok ? y.label : "", category: studentCategory(s, input.academicYear).label }
  })
  return {
    config, plan, students, academicYear: input.academicYear, halls: hallInfo(input.halls),
    errors: [...checked.errors, ...valid.errors], warnings: [...checked.warnings, ...plan.warnings, ...twiceWarning]
  }
}

/**
 * A plan for review, not saved: the seats, each hall's summary, the unallocated students with
 * reasons, and every problem found by the configuration check and the plan validator.
 */
export function previewSeating(db: StudentDb, sessionId: number, studentIds: number[], config: SeatingConfig) {
  const input = seatingInput(db, sessionId, studentIds)
  if ("error" in input) return { success: false as const, error: input.error }
  return { success: true as const, ...buildPlan(input, config) }
}

/**
 * Makes the plan again from the same input, checks it, and saves it, replacing any earlier one.
 * Nothing is saved when a mandatory rule fails. When students would be left unallocated, nothing is
 * saved unless `acceptUnallocated` is set (the screen asks first); their list is saved with the plan.
 */
export async function confirmSeating(db: StudentDb, sessionId: number, studentIds: number[], config: SeatingConfig, options: { acceptUnallocated?: boolean } = {}) {
  const input = seatingInput(db, sessionId, studentIds)
  if ("error" in input) return { success: false as const, error: input.error }
  const built = buildPlan(input, config)
  const { plan, errors } = built
  if (errors.length) return { success: false as const, error: `The seating plan cannot be saved: ${errors[0]}`, errors }
  if (plan.seats.length === 0) return { success: false as const, error: "No student can be seated with this configuration. Give the halls a bench pattern: boys, girls, or both." }
  const shortfall = unallocatedMessage(plan)
  if (shortfall && !options.acceptUnallocated) {
    return { success: false as const, needsConfirmation: true as const, error: shortfall, unallocated: plan.unallocated }
  }
  // The old plan is replaced in one transaction: if any statement fails (the UNIQUE constraints on
  // seat_allocations also refuse a student or seat used twice), everything rolls back and the
  // previous plan stays as it was.
  try {
    await db.runTransaction(() => {
      db.run("DELETE FROM seat_allocations WHERE session_id = ?", [sessionId])
      for (const s of plan.seats) {
        db.run("INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)",
          [sessionId, s.studentId, s.hallId, s.row, s.col, s.benchNo, s.seat])
      }
      db.run("DELETE FROM seating_configs WHERE session_id = ?", [sessionId])
      db.run("INSERT INTO seating_configs(session_id, config, student_ids, unallocated) VALUES(?,?,?,?)",
        [sessionId, JSON.stringify(built.config), JSON.stringify(input.students.map(s => s.id)), JSON.stringify(plan.unallocated)])
    })
  } catch (e: any) {
    return { success: false as const, error: `The seating plan could not be saved, so the previous plan was kept unchanged. (${e?.message ?? e})` }
  }
  return { success: true as const, warnings: plan.warnings, hallGender: plan.hallGender, seated: plan.seats.length, unallocated: plan.unallocated }
}

/**
 * Seats the students with an automatic configuration and saves the plan. Nothing is saved when
 * someone would be left unallocated (the configuration screen is where that can be accepted).
 */
export async function generateSeating(db: StudentDb, sessionId: number, studentIds: number[]) {
  const auto = autoConfigureSeating(db, sessionId, studentIds)
  if (!auto.success) return auto
  return confirmSeating(db, sessionId, studentIds, auto.config)
}

/** The saved seating of a session: one row per student, in hall and bench order, with each student's academic year. */
export function getSessionSeating(db: StudentDb, sessionId: number) {
  const academicYear = sessionAcademicYear(db, sessionId)
  return db.query<any>(
    `SELECT sa.student_id as studentId, st.roll_no, st.register_no, st.name as studentName, st.gender, st.batch,
            d.code as deptCode, d.name as deptName,
            sa.hall_id as hallId, h.hall_code, h.block as hallBlock, h.floor as hallFloor,
            sa.bench_row, sa.bench_col, sa.bench_no, sa.seat
     FROM seat_allocations sa
     JOIN students st ON st.id = sa.student_id
     JOIN halls h ON h.id = sa.hall_id
     LEFT JOIN departments d ON d.id = st.department_id
     WHERE sa.session_id = ?
     ORDER BY h.sort_order, h.id, sa.bench_no, sa.seat`, [sessionId]
  ).map(r => {
    const y = yearOfStudy(r.batch, academicYear)
    const year = y.ok ? y.label : ""
    return { ...r, year, category: categoryLabel(r.deptCode, year || r.batch) }
  })
}

export function clearSeating(db: StudentDb, sessionId: number) {
  db.run("DELETE FROM seat_allocations WHERE session_id = ?", [sessionId])
  db.run("DELETE FROM seating_configs WHERE session_id = ?", [sessionId])
  return { success: true }
}

/**
 * "Same as previous exam": gives this session exactly the seating of another one, every student on
 * the same hall, bench and seat, with no reshuffling. The selected students, configuration and
 * unallocated list are copied too. Allowed only when both sessions' invigilator allocations have
 * exactly the same halls, and refused when a bench used then is no longer in its hall. The copy replaces this session's plan in one transaction.
 */
export async function copySeating(db: StudentDb, sessionId: number, fromSessionId: number) {
  if (sessionId === fromSessionId) return { success: false as const, error: "Choose a different exam to copy the seating from." }
  const rows = db.query<any>("SELECT student_id, hall_id, bench_row, bench_col, bench_no, seat FROM seat_allocations WHERE session_id = ?", [fromSessionId])
  if (rows.length === 0) return { success: false as const, error: "That exam has no seating plan to copy." }
  const hallsOf = (id: number) => db.query<any>(
    "SELECT DISTINCT h.* FROM allocations a JOIN halls h ON h.id = a.hall_id WHERE a.session_id = ? ORDER BY h.hall_code", [id])
  const here = hallsOf(sessionId), there = hallsOf(fromSessionId)
  const codes = (list: any[]) => list.map(h => h.hall_code).join(", ") || "none"
  if (codes(here) !== codes(there)) {
    return { success: false as const, error: `The seating can be copied only between exams with the same halls. The previous exam has ${codes(there)}; this exam has ${codes(here)}.` }
  }
  const halls = new Map(here.map(h => [h.id, h]))
  const usedHalls = [...new Set(rows.map(r => r.hall_id))]
  // Each seat that exists now: "row-col-L", and "row-col-R" on a bench (a chair has one seat).
  const benches = new Map(usedHalls.map(id => [id, new Set(enabledBenches(hallLayout(halls.get(id))).flatMap(b =>
    (b.seats === 2 ? ["L", "R"] : ["L"]).map(side => `${benchKey(b.row, b.col)}-${side}`)))]))
  const gone = rows.filter(r => !benches.get(r.hall_id)!.has(`${benchKey(r.bench_row, r.bench_col)}-${r.seat}`))
  if (gone.length) {
    const codes = [...new Set(gone.map(r => halls.get(r.hall_id).hall_code))]
    return { success: false as const, error: `The bench layout of ${codes.join(", ")} has changed since the previous exam, so its seats cannot be reused. Configure the seating afresh.` }
  }
  const config = db.queryOne<any>("SELECT config, student_ids, unallocated FROM seating_configs WHERE session_id = ?", [fromSessionId])
  try {
    await db.runTransaction(() => {
      db.run("DELETE FROM seat_allocations WHERE session_id = ?", [sessionId])
      for (const r of rows) {
        db.run("INSERT INTO seat_allocations(session_id, student_id, hall_id, bench_row, bench_col, bench_no, seat) VALUES(?,?,?,?,?,?,?)",
          [sessionId, r.student_id, r.hall_id, r.bench_row, r.bench_col, r.bench_no, r.seat])
      }
      db.run("DELETE FROM seating_configs WHERE session_id = ?", [sessionId])
      if (config) {
        db.run("INSERT INTO seating_configs(session_id, config, student_ids, unallocated) VALUES(?,?,?,?)",
          [sessionId, config.config, config.student_ids, config.unallocated])
      }
    })
  } catch (e: any) {
    return { success: false as const, error: `The seating could not be copied, so this exam's plan was kept unchanged. (${e?.message ?? e})` }
  }
  let unallocated: UnallocatedStudent[] = []
  try { unallocated = JSON.parse(config?.unallocated ?? "[]") ?? [] } catch { /* none */ }
  return { success: true as const, seated: rows.length, unallocated, warnings: [] as string[] }
}

/**
 * Sessions that have a seating plan (to copy their student selection, hall settings or whole
 * seating), newest first, with the halls of their invigilator allocation. `studentCount` counts everyone selected, seated or not.
 */
export function getSeatingSelections(db: StudentDb) {
  return db.query<any>(
    `SELECT es.id, es.cycle_id as cycleId, ec.name as cycleName, es.exam_date, es.session_type,
            COUNT(sa.id) as seated, sc.student_ids,
            (SELECT GROUP_CONCAT(DISTINCT a.hall_id) FROM allocations a WHERE a.session_id = es.id) as halls
     FROM exam_sessions es
     JOIN exam_cycles ec ON es.cycle_id = ec.id
     LEFT JOIN seat_allocations sa ON sa.session_id = es.id
     LEFT JOIN seating_configs sc ON sc.session_id = es.id
     WHERE sa.id IS NOT NULL OR sc.session_id IS NOT NULL
     GROUP BY es.id
     ORDER BY es.exam_date DESC, CASE es.session_type WHEN 'FN' THEN 1 ELSE 0 END, es.id DESC`
  ).map(({ seated, student_ids, halls, ...r }) => {
    let selected: unknown = null
    try { selected = JSON.parse(student_ids ?? "null") } catch { /* an unreadable list counts the seated students */ }
    /** The halls of its invigilator allocation ("Same as previous exam" needs exactly the same). */
    const hallIds = String(halls ?? "").split(",").filter(Boolean).map(Number).sort((a, b) => a - b)
    return { ...r, studentCount: Array.isArray(selected) ? selected.length : seated, hallIds }
  })
}

/**
 * After the invigilator allocation of a session is regenerated: if its halls changed, the seating
 * (which used the old halls) no longer fits and is removed. Returns true when it was removed.
 */
export function dropSeatingIfHallsChanged(db: StudentDb, sessionId: number): boolean {
  const seatHalls = db.query<any>("SELECT DISTINCT hall_id FROM seat_allocations WHERE session_id = ?", [sessionId]).map(r => r.hall_id)
  if (seatHalls.length === 0) return false
  const halls = new Set(db.query<any>("SELECT hall_id FROM allocations WHERE session_id = ?", [sessionId]).map(r => r.hall_id))
  if (seatHalls.every(h => halls.has(h))) return false
  clearSeating(db, sessionId)
  return true
}
