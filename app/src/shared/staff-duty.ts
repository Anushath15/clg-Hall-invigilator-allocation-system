/**
 * STAFF DUTY HISTORY: the one data contract for getStaffDutyHistory, used by the desktop
 * service (allocation.service.ts), the web build (web-api.ts), the Staff Duty page and the
 * rotation history timeline. Both builds run the same SQL, so they return the same fields.
 */

/** One confirmed or published duty of a staff member. */
export interface StaffDutyRow {
  exam_date: string
  session_type: "FN" | "AN"
  status: "confirmed" | "published"
  reporting_time: string | null
  exam_start: string | null
  exam_end: string | null
  hallId: number
  hall_code: string
  hallName: string | null
  hallBlock: string | null
  hallFloor: string | null
  cycleName: string
  academic_year: string
  is_manually_edited: number
}

/** Every field of StaffDutyRow, for tests that check the query returns exactly these. */
export const STAFF_DUTY_FIELDS: (keyof StaffDutyRow)[] = [
  "exam_date", "session_type", "status", "reporting_time", "exam_start", "exam_end",
  "hallId", "hall_code", "hallName", "hallBlock", "hallFloor", "cycleName", "academic_year", "is_manually_edited"
]

/** A staff member's confirmed and published duties, newest first. Parameter: user id. */
export const STAFF_DUTY_HISTORY_SQL = `
  SELECT es.exam_date, es.session_type, es.status, es.reporting_time, es.exam_start, es.exam_end,
         h.id as hallId, h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor,
         ec.name as cycleName, ec.academic_year,
         a.is_manually_edited
  FROM allocations a
  JOIN exam_sessions es ON a.session_id = es.id
  JOIN halls h ON a.hall_id = h.id
  JOIN exam_cycles ec ON es.cycle_id = ec.id
  WHERE a.user_id = ? AND es.status IN ('confirmed','published')
  ORDER BY es.exam_date DESC, es.session_type ASC`

const byTimeAsc = (a: StaffDutyRow, b: StaffDutyRow) =>
  a.exam_date.localeCompare(b.exam_date) || (a.session_type === b.session_type ? 0 : a.session_type === "FN" ? -1 : 1)

/**
 * What a staff member sees: every confirmed or published duty (Confirm is the final step
 * since Publish was replaced by Export PDF). Upcoming ones soonest first (FN before AN on the
 * same day), past ones newest first. `today` is YYYY-MM-DD.
 */
export function splitStaffDuties(rows: StaffDutyRow[], today: string) {
  const upcoming = rows.filter(r => r.exam_date >= today).sort(byTimeAsc)
  const past = rows.filter(r => r.exam_date < today).sort((a, b) => byTimeAsc(b, a))
  return { next: upcoming[0] as StaffDutyRow | undefined, upcoming, past }
}
