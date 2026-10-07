/**
 * Exam dates: Sundays are the only holiday, in every year (calculated, so there is no list to
 * maintain). Public holidays are not tracked: a session may be scheduled on any other day.
 */

export interface HolidayInfo {
  name: string
  type: "gazetted" | "restricted" | "college"
  description?: string
}

/** No public-holiday data is kept; only Sundays are treated as holidays (see isSundayDate). */
export const TN_HOLIDAYS: Record<string, HolidayInfo> = {}

/**
 * Returns holiday details for a given ISO date string (yyyy-MM-dd)
 */
export function getHoliday(dateStr: string): HolidayInfo | null {
  return TN_HOLIDAYS[dateStr] ?? null
}

/**
 * Checks if a date is a Sunday
 */
export function isSundayDate(date: Date): boolean {
  return date.getDay() === 0
}

/**
 * Validates if an exam can be conducted on this date
 */
export function getExamDateStatus(dateStr: string, date: Date): {
  isExamDay: boolean
  isHoliday: boolean
  isSunday: boolean
  holidayName?: string
} {
  const isSunday = isSundayDate(date)
  const holiday = getHoliday(dateStr)
  const isHoliday = !!holiday

  return {
    isExamDay: !isSunday && !isHoliday,
    isHoliday,
    isSunday,
    holidayName: holiday?.name
  }
}
