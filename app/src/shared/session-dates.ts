/**
 * Sessions cannot be created on, or moved to, a day that has already passed (today is allowed).
 * Used by the desktop service and by the screens that pick a date.
 */
export const PAST_DATE_MESSAGE = "That date has already passed. Choose today or a later date."

/** Today's date on this computer, as YYYY-MM-DD (local time, not UTC). */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/** The time of day on this computer, as HH:MM (24-hour, local time). */
export function timeNowLocal(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
}

/** True when `date` (YYYY-MM-DD) is before today. */
export function isPastDate(date: string, today: string = todayLocal()): boolean {
  return date < today
}
