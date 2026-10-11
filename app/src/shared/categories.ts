/**
 * STUDENT CATEGORIES for seating: a category is a department together with a student batch
 * ("CSE, 2022-2026"). Its academic year (year of study) is not stored; it comes from the batch and
 * the exam cycle's academic year, so it is always right for the exam being seated:
 *
 *   batch 2022-2026 in academic year 2025-2026 → 4th of 4 years → "Final Year"
 *   batch 2024-2028 in academic year 2025-2026 → 2nd of 4 years → "Second Year"
 *
 * The last year of any batch is "Final Year", whatever the course length, so a 3-year batch in its
 * third year and a 4-year batch in its fourth are the same academic year. Pure logic.
 */

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"]

/** The key of a category: department id and batch. */
export const categoryKey = (departmentId: number | null | undefined, batch: string) => `${departmentId ?? 0}|${batch}`

/** The year an academic year starts in: "2025-2026" and "2025-26" both give 2025; null if unreadable. */
export function academicStartYear(academicYear: unknown): number | null {
  const m = String(academicYear ?? "").match(/(\d{4})/)
  return m ? Number(m[1]) : null
}

/** The batch's start and end years, or null when it is not "YYYY-YYYY". */
export function batchYears(batch: string): { start: number; end: number } | null {
  const m = String(batch ?? "").trim().match(/^(\d{4})\s*-\s*(\d{4})$/)
  if (!m || Number(m[2]) <= Number(m[1])) return null
  return { start: Number(m[1]), end: Number(m[2]) }
}

export type YearOfStudy =
  | { ok: true; year: number; span: number; label: string }
  | { ok: false; reason: string }

/** Which year of study a batch is in during an academic year, with its label ("Final Year"). */
export function yearOfStudy(batch: string, academicYear: unknown): YearOfStudy {
  const b = batchYears(batch)
  if (!b) return { ok: false, reason: `Batch "${batch}" is not in the form 2022-2026.` }
  const start = academicStartYear(academicYear)
  if (start === null) return { ok: false, reason: `The exam cycle's academic year "${academicYear ?? ""}" is not in the form 2025-2026.` }
  const span = b.end - b.start, year = start - b.start + 1
  if (year < 1) return { ok: false, reason: `Batch ${batch} has not started in academic year ${academicYear}.` }
  if (year > span) return { ok: false, reason: `Batch ${batch} has already finished by academic year ${academicYear}.` }
  return { ok: true, year, span, label: yearLabel(year, span) }
}

/** "Final Year" for the last year of the batch, otherwise "First Year", "Second Year", … */
export function yearLabel(year: number, span: number): string {
  if (year === span) return "Final Year"
  return ORDINALS[year - 1] ? `${ORDINALS[year - 1]} Year` : `Year ${year}`
}

/** A category's name on screen and in print: "CSE – Final Year". */
export const categoryLabel = (deptCode: string | null | undefined, yearText: string) => `${deptCode || "—"} – ${yearText}`
