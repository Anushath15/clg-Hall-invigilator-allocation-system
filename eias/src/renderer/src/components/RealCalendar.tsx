import { useState, useMemo } from "react"
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  parseISO
} from "date-fns"
import { ChevronLeft, ChevronRight, Sparkles, XCircle } from "lucide-react"
import { getHoliday, isSundayDate } from "../lib/holidays"
import { cn, formatDateWithDay } from "../lib/utils"

interface RealCalendarProps {
  selectedDates: string[]
  onToggleDate: (dateStr: string) => void
  maxDates: number
  onAutoSelect?: (count: number) => void
  onClearDates?: () => void
}

export default function RealCalendar({
  selectedDates,
  onToggleDate,
  maxDates,
  onAutoSelect,
  onClearDates
}: RealCalendarProps) {
  // Center on current month or first selected date
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    if (selectedDates.length > 0) {
      try {
        return parseISO(selectedDates[0])
      } catch {
        return new Date()
      }
    }
    return new Date()
  })

  const today = useMemo(() => new Date(), [])

  // Calculate calendar grid for the month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(monthStart)
    const startDate = startOfWeek(monthStart, { weekStartsOn: 0 }) // Sunday start
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 }) // Saturday end
    return eachDayOfInterval({ start: startDate, end: endDate })
  }, [currentMonth])

  function prevMonth() {
    setCurrentMonth(m => subMonths(m, 1))
  }

  function nextMonth() {
    setCurrentMonth(m => addMonths(m, 1))
  }

  return (
    <div className="space-y-4">
      {/* Month Navigation & Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-verylight p-3 rounded-xl border border-brand-border">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="p-1.5 rounded-lg hover:bg-white text-brand-textmain hover:shadow-sm transition-all"
            title="Previous Month"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-base font-bold text-brand-textmain min-w-[150px] text-center">
            {format(currentMonth, "MMMM yyyy")}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1.5 rounded-lg hover:bg-white text-brand-textmain hover:shadow-sm transition-all"
            title="Next Month"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onAutoSelect && (
            <button
              type="button"
              onClick={() => onAutoSelect(maxDates)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-brand-primary text-brand-primary hover:bg-brand-light transition-all shadow-sm"
              title="Automatically select consecutive working days, skipping Sundays & holidays"
            >
              <Sparkles className="w-3.5 h-3.5 text-brand-primary" />
              Auto-Select {maxDates} Days
            </button>
          )}
          {selectedDates.length > 0 && onClearDates && (
            <button
              type="button"
              onClick={onClearDates}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
            >
              <XCircle className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Real-World Calendar Grid (7 Columns: Sun - Sat) */}
      <div className="border border-brand-border rounded-xl p-3 bg-white shadow-sm">
        {/* Day Header Row */}
        <div className="grid grid-cols-7 gap-1 text-center font-semibold text-xs border-b border-brand-border pb-2 mb-2">
          <div className="text-red-600 font-bold">Sun</div>
          <div className="text-brand-textmain">Mon</div>
          <div className="text-brand-textmain">Tue</div>
          <div className="text-brand-textmain">Wed</div>
          <div className="text-brand-textmain">Thu</div>
          <div className="text-brand-textmain">Fri</div>
          <div className="text-brand-textmain">Sat</div>
        </div>

        {/* Day Cells */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd")
            const isCurrentMonth = isSameMonth(day, currentMonth)
            const isToday = isSameDay(day, today)
            const isSunday = isSundayDate(day)
            const holiday = getHoliday(dateStr)
            const isSelected = selectedDates.includes(dateStr)
            const selectionIndex = selectedDates.indexOf(dateStr)

            // Sundays are disabled for exam scheduling in college
            const isDisabled = isSunday

            return (
              <button
                key={dateStr}
                type="button"
                disabled={isDisabled}
                onClick={() => onToggleDate(dateStr)}
                title={
                  isSunday
                    ? "Sunday — Weekly Holiday (No Exams)"
                    : holiday
                    ? `${holiday.name} (TN Gazetted Holiday)`
                    : format(day, "EEEE, dd MMMM yyyy")
                }
                className={cn(
                  "relative flex flex-col items-center justify-between p-2 rounded-lg text-xs transition-all min-h-[58px] border",
                  !isCurrentMonth && "opacity-35 bg-gray-50/50",
                  isSunday && "bg-red-50/60 border-red-100 text-red-400 cursor-not-allowed",
                  !isSunday && !isSelected && isCurrentMonth && "border-gray-100 hover:border-brand-primary/50 hover:bg-brand-verylight text-brand-textmain",
                  isSelected && "bg-brand-primary text-white border-brand-dark shadow-sm font-semibold hover:bg-brand-dark",
                  isToday && !isSelected && "ring-2 ring-blue-400 font-bold"
                )}
              >
                {/* Top row: day number and selection order badge */}
                <div className="w-full flex items-center justify-between">
                  <span className={cn(
                    "text-xs font-semibold",
                    isSunday && "text-red-500",
                    isSelected && "text-white"
                  )}>
                    {format(day, "d")}
                  </span>
                  {isSelected && (
                    <span className="text-[10px] bg-white text-brand-dark font-bold px-1 rounded-full leading-tight">
                      #{selectionIndex + 1}
                    </span>
                  )}
                  {isToday && !isSelected && (
                    <span className="text-[9px] text-blue-600 font-bold">Today</span>
                  )}
                </div>

                {/* Holiday or Sunday label */}
                <div className="w-full text-center mt-1">
                  {isSunday ? (
                    <span className="text-[9px] text-red-500 font-medium tracking-tight">
                      Sun
                    </span>
                  ) : holiday ? (
                    <span
                      className={cn(
                        "text-[9px] block truncate font-medium rounded px-1 leading-tight",
                        isSelected
                          ? "bg-amber-400 text-gray-900 font-semibold"
                          : "bg-amber-100 text-amber-900"
                      )}
                      title={holiday.name}
                    >
                      {holiday.name}
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected Dates Summary */}
      <div className="bg-brand-verylight rounded-xl p-4 border border-brand-border">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-brand-dark uppercase tracking-wider">
            Selected Exam Dates:{" "}
            <span className={cn(
              "text-sm font-bold",
              selectedDates.length === maxDates ? "text-brand-primary" : "text-amber-600"
            )}>
              {selectedDates.length}
            </span>{" "}
            / {maxDates} Required
          </p>
          {selectedDates.length < maxDates && (
            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              Need {maxDates - selectedDates.length} more
            </span>
          )}
          {selectedDates.length === maxDates && (
            <span className="text-xs text-brand-dark bg-brand-light px-2 py-0.5 rounded font-medium">
              Ready to configure sessions
            </span>
          )}
        </div>

        {selectedDates.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
            {selectedDates.map((dateStr, i) => {
              const holiday = getHoliday(dateStr)
              return (
                <span
                  key={dateStr}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border font-medium",
                    holiday
                      ? "bg-amber-50 border-amber-300 text-amber-900"
                      : "bg-white border-brand-border text-brand-textmain shadow-xs"
                  )}
                >
                  <span className="text-[10px] font-bold text-brand-primary">#{i + 1}</span>
                  <span>{formatDateWithDay(dateStr)}</span>
                  {holiday && (
                    <span className="text-[10px] bg-amber-200 text-amber-900 px-1 rounded font-semibold">
                      {holiday.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleDate(dateStr)}
                    className="ml-0.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove date"
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-brand-textsec italic">
            Click on any weekday above to select exam dates, or use &quot;Auto-Select&quot; to pick consecutive working days.
          </p>
        )}
      </div>
    </div>
  )
}
