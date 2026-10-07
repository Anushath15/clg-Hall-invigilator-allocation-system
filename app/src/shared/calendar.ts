/**
 * The month view of the calendar: every day of the month plus the days that complete its first
 * and last week (weeks run Sunday to Saturday). Uses the computer's own calendar rules, so leap
 * years (2028, 2400; not 2100) and daylight-saving changes are handled by the platform, not by
 * hand-written arithmetic.
 */
import { eachDayOfInterval, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns"

export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month)
  return eachDayOfInterval({ start: startOfWeek(first, { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(first), { weekStartsOn: 0 }) })
}
