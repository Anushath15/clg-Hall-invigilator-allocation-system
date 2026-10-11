/**
 * Reads an uploaded list of the students writing a session (the rows of an Excel/CSV sheet) and
 * works out which students it names. Pure logic, no file or DOM access; the dialog reads the file.
 *
 * Accepted layouts: a header row with a Register No or Roll No column (the first of the first five
 * rows that names one), or no header at all, the first column then holding register or roll numbers.
 * Each value is matched against register numbers first, then roll numbers, ignoring case.
 */

export interface ListStudent { id: number; roll_no: string; register_no: string }
export interface StudentListResult { studentIds: number[]; notFound: string[]; duplicates: string[] }

const HEADERS = ["register no", "register number", "register_no", "reg no", "regno", "roll no", "roll number", "roll_no", "rollno", "roll"]
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase()

export function readStudentList(rows: unknown[][], students: ListStudent[]): StudentListResult {
  const nonEmpty = rows.filter(r => Array.isArray(r) && r.some(c => norm(c) !== ""))
  let headerIndex = -1, col = 0
  for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
    const c = nonEmpty[i].map(norm).findIndex(v => HEADERS.includes(v))
    if (c !== -1) { headerIndex = i; col = c; break }
  }
  const byReg = new Map(students.map(s => [norm(s.register_no), s]))
  const byRoll = new Map(students.map(s => [norm(s.roll_no), s]))
  const studentIds: number[] = [], notFound: string[] = [], duplicates: string[] = []
  for (const row of nonEmpty.slice(headerIndex + 1)) {
    const key = norm(row[col])
    if (!key) continue
    const shown = String(row[col]).trim()
    const s = byReg.get(key) ?? byRoll.get(key)
    if (!s) notFound.push(shown)
    else if (studentIds.includes(s.id)) duplicates.push(shown)
    else studentIds.push(s.id)
  }
  return { studentIds, notFound, duplicates }
}
