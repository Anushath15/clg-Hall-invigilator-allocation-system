/**
 * Reads a duty list (the rows of an uploaded Excel/CSV sheet) and works out which
 * invigilators, and optionally which halls, it names. Pure logic, no file or DOM
 * access, so it can be unit-tested; the modal reads the file with SheetJS.
 *
 * Accepted layouts:
 *  - A header row with a Staff ID column (or, failing that, a Name column), and
 *    optionally a Hall column with hall codes.
 *  - No header at all: the first column is taken as Staff IDs.
 */

export interface DutyListStaff { id: number; staff_id: string; name: string }
export interface DutyListHall { id: number; hall_code: string }

export interface DutyListResult {
  userIds: number[]
  hallIds: number[]
  /** true when the sheet has a Hall column, so the hall selection should be replaced too */
  hasHallColumn: boolean
  matchedBy: "staff id" | "name"
  /** values in the sheet that match no active invigilator */
  notFound: string[]
  /** names that match more than one invigilator (use Staff IDs instead) */
  ambiguous: string[]
  /** hall codes in the sheet that match no active hall */
  hallsNotFound: string[]
  /** staff listed more than once (counted once) */
  duplicates: string[]
}

const STAFF_ID_HEADERS = ["staff id", "staff_id", "staffid", "staff no", "staff number", "emp id", "employee id", "id", "reg no"]
const NAME_HEADERS = ["name", "staff name", "full name", "invigilator", "invigilator name"]
const HALL_HEADERS = ["hall", "hall code", "hall_code", "hall no", "room"]

const norm = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase()

export function readDutyList(rows: unknown[][], staff: DutyListStaff[], halls: DutyListHall[]): DutyListResult {
  const nonEmpty = rows.filter(r => Array.isArray(r) && r.some(c => norm(c) !== ""))

  // Header row: the first of the first five rows that names a known column.
  let headerIndex = -1, idCol = -1, nameCol = -1, hallCol = -1
  for (let i = 0; i < Math.min(5, nonEmpty.length); i++) {
    const cells = nonEmpty[i].map(norm)
    const find = (names: string[]) => cells.findIndex(c => names.includes(c))
    const [a, b, c] = [find(STAFF_ID_HEADERS), find(NAME_HEADERS), find(HALL_HEADERS)]
    if (a !== -1 || b !== -1) { headerIndex = i; idCol = a; nameCol = b; hallCol = c; break }
  }
  if (headerIndex === -1) idCol = 0 // no header: first column holds Staff IDs
  const body = nonEmpty.slice(headerIndex + 1)
  const matchedBy: DutyListResult["matchedBy"] = idCol !== -1 ? "staff id" : "name"

  const byId = new Map(staff.map(s => [norm(s.staff_id), s]))
  const byName = new Map<string, DutyListStaff[]>()
  for (const s of staff) byName.set(norm(s.name), [...(byName.get(norm(s.name)) ?? []), s])
  const hallByCode = new Map(halls.map(h => [norm(h.hall_code), h]))

  const userIds: number[] = [], hallIds: number[] = []
  const notFound: string[] = [], ambiguous: string[] = [], hallsNotFound: string[] = [], duplicates: string[] = []

  for (const row of body) {
    const key = norm(row[matchedBy === "staff id" ? idCol : nameCol])
    if (key) {
      const shown = String(row[matchedBy === "staff id" ? idCol : nameCol]).trim()
      let match: DutyListStaff | undefined
      if (matchedBy === "staff id") match = byId.get(key)
      else {
        const candidates = byName.get(key) ?? []
        if (candidates.length > 1) { ambiguous.push(shown); continue }
        match = candidates[0]
      }
      if (!match) notFound.push(shown)
      else if (userIds.includes(match.id)) duplicates.push(shown)
      else userIds.push(match.id)
    }
    if (hallCol !== -1) {
      const code = norm(row[hallCol])
      if (!code) continue
      const hall = hallByCode.get(code)
      if (!hall) hallsNotFound.push(String(row[hallCol]).trim())
      else if (!hallIds.includes(hall.id)) hallIds.push(hall.id)
    }
  }

  return { userIds, hallIds, hasHallColumn: hallCol !== -1, matchedBy, notFound, ambiguous, hallsNotFound, duplicates }
}
