/**
 * SUBJECTS: the subject master, the staff who handle each subject, and the subject clashes of a
 * session's invigilators.
 *
 * Each session's seating configuration records the subject each class writes (SeatingConfig.subjects,
 * entered on the seating configuration screen). From it and the saved seats, each hall's subjects are
 * known; an invigilator who handles one of them is a clash. The hall assignment keeps such a person
 * out of that hall whenever the rotation allows (shared/assignment.ts).
 *
 * Like students.ts this module reads and writes the database through the `StudentDb` interface, so
 * the desktop IPC handlers and web-api.ts call the same functions.
 */
import type { StudentDb } from "./students"
import type { SubjectConflict } from "./assignment"
import { sessionSubjectOf } from "./seating"

// ── Schema ──────────────────────────────────────────────────

/** Migration 012 (both builds): the subjects table and which staff handle each subject. Only adds tables. */
export function migrateSubjects(db: Pick<StudentDb, "run" | "query">): void {
  db.run(`CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS staff_subjects (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, subject_id)
  )`)
}

/** Migration 013 (both builds): which students study each subject. Only adds a table. */
export function migrateStudentSubjects(db: Pick<StudentDb, "run" | "query">): void {
  db.run(`CREATE TABLE IF NOT EXISTS student_subjects (
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    PRIMARY KEY (student_id, subject_id)
  )`)
  db.run("CREATE INDEX IF NOT EXISTS idx_student_subjects_subject ON student_subjects(subject_id)")
}

// ── Subject master ──────────────────────────────────────────

export interface SubjectInput { id?: number; code: string; name: string; department_id?: number | null; is_active?: boolean; staff_ids?: number[] }

const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/** Every subject with its department, the staff who handle it and the students who study it, by code. */
export function listSubjects(db: StudentDb) {
  const subjects = db.query<any>(
    `SELECT sb.id, sb.code, sb.name, sb.department_id, sb.is_active, d.code as department_code
     FROM subjects sb LEFT JOIN departments d ON d.id = sb.department_id`)
  const staff = db.query<any>(
    `SELECT ss.subject_id, u.id, u.name, u.staff_id FROM staff_subjects ss JOIN users u ON u.id = ss.user_id ORDER BY u.name COLLATE NOCASE`)
  const students = new Map<number, number[]>()
  for (const r of db.query<any>("SELECT subject_id, student_id FROM student_subjects")) students.set(r.subject_id, [...(students.get(r.subject_id) ?? []), r.student_id])
  return subjects
    .map(s => ({ ...s, staff: staff.filter(x => x.subject_id === s.id).map(({ subject_id: _, ...u }) => u), student_ids: students.get(s.id) ?? [] }))
    .sort((a, b) => order.compare(a.code, b.code))
}

export function validateSubject(data: Partial<SubjectInput>): string | null {
  const code = String(data?.code ?? "").trim(), name = String(data?.name ?? "").trim()
  if (!code) return "Subject Code is required."
  if (code.length > 20) return "Subject Code must be at most 20 characters."
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(code)) return "Subject Code may contain only letters, digits, spaces and . _ / -"
  if (!name) return "Subject Name is required."
  if (name.length > 120) return "Subject Name must be at most 120 characters."
  return null
}

/** Saves a subject and replaces the staff who handle it with `staff_ids` (when given). */
export function saveSubject(db: StudentDb, data: SubjectInput): { success: true; id: number } | { success: false; error: string } {
  const problem = validateSubject(data ?? {} as SubjectInput)
  if (problem) return { success: false, error: problem }
  const code = String(data.code).trim().replace(/\s+/g, " "), name = String(data.name).trim().replace(/\s+/g, " ")
  const departmentId = data.department_id ? Number(data.department_id) : null
  const clash = db.queryOne<any>("SELECT code, name FROM subjects WHERE code = ? COLLATE NOCASE AND id != ?", [code, data.id ?? 0])
  if (clash) return { success: false, error: `Subject Code ${clash.code} is already used by ${clash.name}.` }
  let id = Number(data.id ?? 0)
  if (id) {
    db.run("UPDATE subjects SET code=?, name=?, department_id=?, is_active=?, updated_at=datetime('now') WHERE id=?",
      [code, name, departmentId, data.is_active === false ? 0 : 1, id])
  } else {
    id = db.run("INSERT INTO subjects(code, name, department_id, is_active) VALUES(?,?,?,1)", [code, name, departmentId]).lastInsertRowid
  }
  if (Array.isArray(data.staff_ids)) setSubjectStaff(db, id, data.staff_ids)
  return { success: true, id }
}

/** The staff who handle a subject, replaced by `userIds`. */
export function setSubjectStaff(db: StudentDb, subjectId: number, userIds: number[]) {
  db.run("DELETE FROM staff_subjects WHERE subject_id = ?", [subjectId])
  for (const userId of [...new Set(userIds.map(Number).filter(n => n > 0))]) {
    db.run("INSERT OR IGNORE INTO staff_subjects(user_id, subject_id) VALUES(?,?)", [userId, subjectId])
  }
}

/** The students who study a subject, replaced by `studentIds`. */
export function setSubjectStudents(db: StudentDb, subjectId: number, studentIds: number[]): { success: boolean; error?: string; count?: number } {
  if (!db.queryOne("SELECT id FROM subjects WHERE id = ?", [subjectId])) return { success: false, error: "Subject not found." }
  const ids = [...new Set((studentIds ?? []).map(Number).filter(n => n > 0))]
  db.run("DELETE FROM student_subjects WHERE subject_id = ?", [subjectId])
  for (const id of ids) db.run("INSERT OR IGNORE INTO student_subjects(student_id, subject_id) SELECT id, ? FROM students WHERE id = ?", [subjectId, id])
  return { success: true, count: ids.length }
}

const ROLL_HEADERS = ["roll no", "roll number", "roll_no", "rollno", "roll"]
const REGISTER_HEADERS = ["register no", "register number", "register_no", "registerno", "reg no", "reg_no", "regno"]
const SUBJECTS_HEADERS = ["subject code", "subject codes", "subjects", "subject", "code", "codes", "subject_code"]
export const STUDENT_SUBJECT_IMPORT_COLUMNS = ["Roll No (or Register No)", "Subject Codes (separated by , or ;)"]

/**
 * Maps students to subjects from a sheet: one row per student, with their Roll No or Register No
 * and the codes of the subjects they study (one or several). The mapping is added to what is there.
 */
export function importStudentSubjects(db: StudentDb, rows: unknown[][]) {
  const header = (rows[0] ?? []).map(h => String(h ?? "").trim().toLowerCase())
  const col = (names: string[]) => header.findIndex(h => names.includes(h))
  const idx = { roll: col(ROLL_HEADERS), reg: col(REGISTER_HEADERS), subjects: col(SUBJECTS_HEADERS) }
  if ((idx.roll === -1 && idx.reg === -1) || idx.subjects === -1) {
    return { success: false as const, error: `The first row must name the columns ${STUDENT_SUBJECT_IMPORT_COLUMNS.join(" and ")}.` }
  }
  const body = rows.slice(1).map((r, i) => ({ r: r ?? [], excelRow: i + 2 })).filter(({ r }) => r.some(c => String(c ?? "").trim() !== ""))
  if (body.length === 0) return { success: false as const, error: "This Excel file has no data rows below the header." }
  let mapped = 0
  const issues: { row: number; reason: string }[] = []
  for (const { r, excelRow } of body) {
    const cell = (i: number) => (i < 0 ? "" : String(r[i] ?? "").trim())
    const roll = cell(idx.roll), reg = cell(idx.reg)
    const student = (roll && db.queryOne<any>("SELECT id FROM students WHERE roll_no = ? COLLATE NOCASE", [roll]))
      || (reg && db.queryOne<any>("SELECT id FROM students WHERE register_no = ? COLLATE NOCASE", [reg]))
    if (!student) { issues.push({ row: excelRow, reason: `No student with ${roll ? `Roll No "${roll}"` : `Register No "${reg}"`}.` }); continue }
    const codes = cell(idx.subjects).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean)
    if (codes.length === 0) { issues.push({ row: excelRow, reason: "No subject code given." }); continue }
    const unknown: string[] = []
    for (const code of codes) {
      const sub = db.queryOne<any>("SELECT id FROM subjects WHERE code = ? COLLATE NOCASE", [code])
      if (!sub) { unknown.push(code); continue }
      db.run("INSERT OR IGNORE INTO student_subjects(student_id, subject_id) VALUES(?,?)", [student.id, sub.id])
      mapped++
    }
    if (unknown.length) issues.push({ row: excelRow, reason: `Subject code(s) not found: ${unknown.join(", ")}` })
  }
  return { success: true as const, inserted: mapped, skipped: issues.length, issues }
}

/** Removes a subject and its staff and student mapping. Sessions that used it keep seating; it is just no longer named. */
export function deleteSubject(db: StudentDb, id: number): { success: boolean; error?: string } {
  db.run("DELETE FROM student_subjects WHERE subject_id = ?", [id])
  db.run("DELETE FROM staff_subjects WHERE subject_id = ?", [id])
  db.run("DELETE FROM subjects WHERE id = ?", [id])
  return { success: true }
}

const CODE_HEADERS = ["subject code", "code", "subject_code", "course code", "paper code"]
const NAME_HEADERS = ["subject name", "name", "subject", "subject_name", "course name", "paper name", "title"]
const DEPT_HEADERS = ["department", "dept", "department code", "dept code"]
const STAFF_HEADERS = ["staff ids", "staff id", "staff", "handled by", "staff_ids", "faculty", "faculty ids"]
export const SUBJECT_IMPORT_COLUMNS = ["Subject Code", "Subject Name", "Department (optional)", "Staff IDs (optional, separated by , or ;)"]

/**
 * Imports subjects from a sheet's rows (first row the header). A subject whose code already exists
 * is updated; the Staff IDs listed are added to the staff who handle it. Every skipped row gets a reason.
 */
export function importSubjects(db: StudentDb, rows: unknown[][]) {
  const header = (rows[0] ?? []).map(h => String(h ?? "").trim().toLowerCase())
  const col = (names: string[]) => header.findIndex(h => names.includes(h))
  const idx = { code: col(CODE_HEADERS), name: col(NAME_HEADERS), dept: col(DEPT_HEADERS), staff: col(STAFF_HEADERS) }
  const missing = [idx.code === -1 && "Subject Code", idx.name === -1 && "Subject Name"].filter(Boolean)
  if (missing.length) {
    return { success: false as const, error: `This Excel file is missing required column(s): ${missing.join(", ")}. The first row must name the columns ${SUBJECT_IMPORT_COLUMNS.join(", ")}.` }
  }
  const body = rows.slice(1).map((r, i) => ({ r: r ?? [], excelRow: i + 2 })).filter(({ r }) => r.some(c => String(c ?? "").trim() !== ""))
  if (body.length === 0) return { success: false as const, error: "This Excel file has no data rows below the header." }
  let saved = 0
  const issues: { row: number; reason: string }[] = []
  for (const { r, excelRow } of body) {
    const cell = (i: number) => (i < 0 ? "" : String(r[i] ?? "").trim())
    let departmentId: number | null = null
    if (cell(idx.dept)) {
      const d = db.queryOne<any>("SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE LIMIT 1", [cell(idx.dept), cell(idx.dept)])
      if (!d) { issues.push({ row: excelRow, reason: `Department "${cell(idx.dept)}" does not match any existing department.` }); continue }
      departmentId = d.id
    }
    const staffIds: number[] = [], unknown: string[] = []
    for (const sid of cell(idx.staff).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean)) {
      const u = db.queryOne<any>("SELECT id FROM users WHERE staff_id = ? COLLATE NOCASE", [sid])
      if (u) staffIds.push(u.id); else unknown.push(sid)
    }
    const existing = db.queryOne<any>("SELECT id FROM subjects WHERE code = ? COLLATE NOCASE", [cell(idx.code)])
    const before = existing ? db.query<any>("SELECT user_id FROM staff_subjects WHERE subject_id = ?", [existing.id]).map(x => x.user_id) : []
    const res = saveSubject(db, { id: existing?.id, code: cell(idx.code), name: cell(idx.name), department_id: departmentId, staff_ids: [...before, ...staffIds] })
    if (!res.success) { issues.push({ row: excelRow, reason: res.error }); continue }
    saved++
    if (unknown.length) issues.push({ row: excelRow, reason: `Saved, but Staff ID(s) not found: ${unknown.join(", ")}` })
  }
  return { success: true as const, inserted: saved, skipped: issues.filter(i => !i.reason.startsWith("Saved")).length, issues }
}

// ── Subject clashes of a session ────────────────────────────

/** The subjects written in each hall of a session, from its saved seating and the subject of each class. */
function hallSubjects(db: StudentDb, sessionId: number): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>()
  const row = db.queryOne<any>("SELECT config FROM seating_configs WHERE session_id = ?", [sessionId])
  let config: any = {}
  try { config = JSON.parse(row?.config ?? "{}") ?? {} } catch { /* no subjects */ }
  if (!config.subjects && !config.sessionSubjects) return out
  const seats = db.query<any>(
    `SELECT sa.hall_id, st.id, st.department_id, st.batch, (SELECT GROUP_CONCAT(ss.subject_id) FROM student_subjects ss WHERE ss.student_id = st.id) as subject_ids
     FROM seat_allocations sa JOIN students st ON st.id = sa.student_id WHERE sa.session_id = ?`, [sessionId])
  for (const s of seats) {
    const subject_ids = String(s.subject_ids ?? "").split(",").filter(Boolean).map(Number)
    const sub = sessionSubjectOf({ ...s, subject_ids }, config.subjects, config.sessionSubjects)
    if (!sub) continue
    out.set(s.hall_id, (out.get(s.hall_id) ?? new Set()).add(sub.id))
  }
  return out
}

/**
 * Whether a person handles a subject written in a hall of the session; undefined when the session
 * has no subjects entered or no seating yet (the assignment is then made as before). With `hallIds`
 * (the halls being allocated), also undefined when the seating uses a hall not among them: that
 * seating is removed with the old halls, so it says nothing about the new ones.
 */
export function subjectConflictOf(db: StudentDb, sessionId: number, hallIds?: number[]): SubjectConflict | undefined {
  const inHall = hallSubjects(db, sessionId)
  if (inHall.size === 0) return undefined
  if (hallIds) {
    const pool = new Set(hallIds)
    const seated = db.query<any>("SELECT DISTINCT hall_id FROM seat_allocations WHERE session_id = ?", [sessionId]).map(r => r.hall_id)
    if (seated.some(h => !pool.has(h))) return undefined
  }
  const handles = new Map<number, Set<number>>()
  for (const r of db.query<any>("SELECT user_id, subject_id FROM staff_subjects")) {
    handles.set(r.user_id, (handles.get(r.user_id) ?? new Set()).add(r.subject_id))
  }
  return (userId, hallId) => {
    const mine = handles.get(userId), there = inHall.get(hallId)
    return !!mine && !!there && [...there].some(s => mine.has(s))
  }
}

/** The invigilators of a session placed in a hall where a subject they handle is written. */
export function getSubjectConflicts(db: StudentDb, sessionId: number) {
  const inHall = hallSubjects(db, sessionId)
  if (inHall.size === 0) return []
  const rows = db.query<any>(
    `SELECT a.user_id as userId, u.name as userName, u.staff_id as staffId, a.hall_id as hallId, h.hall_code,
            sb.id as subjectId, sb.code as subjectCode, sb.name as subjectName
     FROM allocations a
     JOIN users u ON u.id = a.user_id
     JOIN halls h ON h.id = a.hall_id
     JOIN staff_subjects ss ON ss.user_id = a.user_id
     JOIN subjects sb ON sb.id = ss.subject_id
     WHERE a.session_id = ?
     ORDER BY h.sort_order, h.id`, [sessionId])
  return rows.filter(r => inHall.get(r.hallId)?.has(r.subjectId))
}
