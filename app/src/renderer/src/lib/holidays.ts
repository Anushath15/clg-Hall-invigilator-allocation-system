/**
 * Tamil Nadu Government Gazetted Public Holidays & College Academic Holidays
 * for St. Xavier's Catholic College of Engineering (SXCCE), Nagercoil (Kanyakumari Dist).
 */

export interface HolidayInfo {
  name: string
  type: "gazetted" | "restricted" | "college"
  description?: string
}

export const TN_HOLIDAYS: Record<string, HolidayInfo> = {
  // 2026 Tamil Nadu Public & Gazetted Holidays
  "2026-01-01": { name: "New Year's Day", type: "gazetted" },
  "2026-01-15": { name: "Pongal", type: "gazetted" },
  "2026-01-16": { name: "Thiruvalluvar Day", type: "gazetted" },
  "2026-01-17": { name: "Uzhavar Thirunal", type: "gazetted" },
  "2026-01-26": { name: "Republic Day", type: "gazetted" },
  "2026-02-01": { name: "Thai Poosam", type: "gazetted" },
  "2026-03-21": { name: "Telugu New Year (Ugadi)", type: "gazetted" },
  "2026-03-31": { name: "Mahaveer Jayanthi", type: "gazetted" },
  "2026-04-03": { name: "Good Friday", type: "gazetted" },
  "2026-04-14": { name: "Tamil New Year / Dr. Ambedkar Jayanthi", type: "gazetted" },
  "2026-05-01": { name: "May Day", type: "gazetted" },
  "2026-06-17": { name: "Bakrid / Eid al-Adha", type: "gazetted" },
  "2026-07-17": { name: "Muharram", type: "gazetted" },
  "2026-08-15": { name: "Independence Day", type: "gazetted" },
  "2026-08-28": { name: "Milad-un-Nabi", type: "gazetted" },
  "2026-09-04": { name: "Krishna Jayanthi", type: "gazetted" },
  "2026-09-14": { name: "Vinayagar Chathurthi", type: "gazetted" },
  "2026-10-02": { name: "Gandhi Jayanthi", type: "gazetted" },
  "2026-10-19": { name: "Ayutha Pooja", type: "gazetted" },
  "2026-10-20": { name: "Vijaya Dashami", type: "gazetted" },
  "2026-11-08": { name: "Deepavali", type: "gazetted" },
  "2026-12-25": { name: "Christmas Day", type: "gazetted" },

  // 2027 Tamil Nadu Public & Gazetted Holidays
  "2027-01-01": { name: "New Year's Day", type: "gazetted" },
  "2027-01-14": { name: "Pongal", type: "gazetted" },
  "2027-01-15": { name: "Thiruvalluvar Day", type: "gazetted" },
  "2027-01-16": { name: "Uzhavar Thirunal", type: "gazetted" },
  "2027-01-26": { name: "Republic Day", type: "gazetted" },
  "2027-02-09": { name: "Thai Poosam", type: "gazetted" },
  "2027-03-26": { name: "Good Friday", type: "gazetted" },
  "2027-04-14": { name: "Tamil New Year / Dr. Ambedkar Jayanthi", type: "gazetted" },
  "2027-05-01": { name: "May Day", type: "gazetted" },
  "2027-08-15": { name: "Independence Day", type: "gazetted" },
  "2027-10-02": { name: "Gandhi Jayanthi", type: "gazetted" },
  "2027-10-09": { name: "Ayutha Pooja", type: "gazetted" },
  "2027-10-10": { name: "Vijaya Dashami", type: "gazetted" },
  "2027-10-29": { name: "Deepavali", type: "gazetted" },
  "2027-12-25": { name: "Christmas Day", type: "gazetted" }
}

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
