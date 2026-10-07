/**
 * Field rules for every form. HIAS is fully offline, so these are format checks the app applies
 * itself (nothing is looked up online: an e-mail address is checked for its shape, not whether
 * the mailbox exists). Each function returns an error message, or null when the value is fine.
 * Used by the screens (before saving), by the save code (so no screen can bypass them) and by
 * the Excel import (row by row).
 */

const hasLetter = (s: string) => /\p{L}/u.test(s)
const onlyDigitsOrSymbols = (s: string) => !hasLetter(s)

/** Staff ID: letters, digits and - _ . / only, no spaces, up to 20 characters ("STF001", "101", "CSE-12"). */
export function validateStaffId(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Staff ID is required."
  if (v.length > 20) return "Staff ID can be at most 20 characters."
  if (!/^[A-Za-z0-9._\/-]+$/.test(v)) return "Staff ID can contain only letters, digits and - _ . / (no spaces)."
  return null
}

/** Name: must contain a letter (so "1010" or "---" is refused); letters, digits, spaces and . ' - ( ) , & are allowed. */
export function validateStaffName(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Full Name is required."
  if (v.length < 2) return "Full Name is too short."
  if (v.length > 80) return "Full Name can be at most 80 characters."
  if (onlyDigitsOrSymbols(v)) return "Full Name must contain letters, not only numbers or symbols."
  if (!/^[\p{L}\p{M}0-9 .'’,&()-]+$/u.test(v)) return "Full Name contains a character that is not allowed. Use letters, digits, spaces and . ' - ( ) , &"
  return null
}

/** Designation (optional): must contain a letter, so "Professor" and "Prof101" pass but "1010" does not. */
export function validateDesignation(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return null
  if (v.length > 60) return "Designation can be at most 60 characters."
  if (onlyDigitsOrSymbols(v)) return "Designation must contain letters, not only numbers or symbols (for example Assistant Professor)."
  return null
}

/** E-mail (optional): name@domain.ext, no spaces. A format check only; HIAS never contacts a mail server. */
export function validateEmail(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return null
  if (v.length > 120) return "E-mail can be at most 120 characters."
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(v)) return "E-mail is not valid. Use the form name@example.com."
  return null
}

/** The first problem with a staff record, or null. */
export function validateStaff(d: { staff_id?: unknown; name?: unknown; designation?: unknown; email?: unknown }): string | null {
  return validateStaffId(d.staff_id) ?? validateStaffName(d.name) ?? validateDesignation(d.designation) ?? validateEmail(d.email)
}

/** Department code: letters and digits (and -), up to 12 characters, with at least one letter ("CSE", "Mech", "S&H" is not allowed). */
export function validateDepartmentCode(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Code is required."
  if (v.length > 12) return "Code can be at most 12 characters."
  if (!/^[A-Za-z0-9-]+$/.test(v) || onlyDigitsOrSymbols(v)) return "Code must be letters and digits (for example CSE), with at least one letter."
  return null
}

export function validateDepartmentName(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Name is required."
  if (v.length > 80) return "Name can be at most 80 characters."
  if (onlyDigitsOrSymbols(v)) return "Name must contain letters, not only numbers or symbols."
  return null
}

/** Hall block/building and floor (both optional): up to 40 characters. */
export function validateHallPlace(label: "Block" | "Floor", value: unknown): string | null {
  const v = String(value ?? "").trim()
  return v.length > 40 ? `${label} can be at most 40 characters.` : null
}

/** Batch name: required, with a letter, up to 100 characters. */
export function validateBatchName(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Batch name is required."
  if (v.length > 100) return "Batch name can be at most 100 characters."
  if (onlyDigitsOrSymbols(v)) return "Batch name must contain letters, not only numbers or symbols."
  return null
}

/** Academic year: 2026-27 or 2026-2027, the second year being the one after the first. */
export function validateAcademicYear(value: unknown): string | null {
  const v = String(value ?? "").trim()
  const m = /^(\d{4})-(\d{2}|\d{4})$/.exec(v)
  if (!m) return "Academic year must look like 2026-27 or 2026-2027."
  const first = Number(m[1]), next = first + 1
  // 2026-27 and 2026-2027; the two-digit form compares the last two digits, so 1999-00 (century change) works.
  const ok = m[2].length === 2 ? Number(m[2]) === next % 100 : Number(m[2]) === next
  if (!ok) return `Academic year must span two consecutive years (for example ${first}-${String(first + 1).slice(2)}).`
  return null
}

/** College full name and short name (Settings): required; the short name at most 12 characters. */
export function validateCollegeName(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "College Full Name is required."
  if (v.length > 120) return "College Full Name can be at most 120 characters."
  return null
}
export function validateCollegeShortName(value: unknown): string | null {
  const v = String(value ?? "").trim()
  if (!v) return "Short Name is required."
  if (v.length > 12) return "Short Name can be at most 12 characters."
  return null
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** One time of day: a valid 24-hour HH:MM. */
export function validateTimeOfDay(value: unknown): string | null {
  return HHMM.test(String(value ?? "").trim()) ? null : "Times must be valid, for example 09:30."
}

/** A session's times: each a valid 24-hour HH:MM, with reporting at or before the start and the end after the start. */
export function validateSessionTimes(reporting: unknown, start: unknown, end: unknown): string | null {
  const [r, s, e] = [reporting, start, end].map(x => String(x ?? "").trim())
  if (!r || !s || !e) return "Reporting time, exam start and exam end are all required."
  if (![r, s, e].every(t => HHMM.test(t))) return "Times must be valid, for example 09:30."
  if (r > s) return "Reporting time must be at or before the exam start."
  if (e <= s) return "Exam end must be after the exam start."
  return null
}
