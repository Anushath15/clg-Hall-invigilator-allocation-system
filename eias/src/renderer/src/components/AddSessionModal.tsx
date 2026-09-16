import { useState, useMemo } from "react"
import { X, Calendar, Clock, Plus, Zap, AlertTriangle } from "lucide-react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { formatFullDate, formatTime12h } from "../lib/utils"
import { getHoliday, isSundayDate } from "../lib/holidays"
import { parseISO } from "date-fns"

interface AddSessionModalProps {
  cycleId: number
  existingSessionsCount: number
  onClose: () => void
  onAdded: (newSession: any) => void
}

export default function AddSessionModal({
  cycleId,
  existingSessionsCount,
  onClose,
  onAdded
}: AddSessionModalProps) {
  const [examDate, setExamDate] = useState<string>("")
  const [sessionType, setSessionType] = useState<"FN" | "AN">("FN")
  const [reportingTime, setReportingTime] = useState<string>("09:30")
  const [examStart, setExamStart] = useState<string>("10:00")
  const [examEnd, setExamEnd] = useState<string>("13:00")
  const [saving, setSaving] = useState(false)

  // Date metadata
  const dateInfo = useMemo(() => {
    if (!examDate) return null
    try {
      const d = parseISO(examDate)
      return {
        formatted: formatFullDate(examDate),
        isSunday: isSundayDate(d),
        holiday: getHoliday(examDate)
      }
    } catch {
      return null
    }
  }, [examDate])

  // Presets
  function applyPreset(type: "fn" | "an" | "2h") {
    if (type === "fn") {
      setSessionType("FN")
      setReportingTime("09:30")
      setExamStart("10:00")
      setExamEnd("13:00")
    } else if (type === "an") {
      setSessionType("AN")
      setReportingTime("13:30")
      setExamStart("14:00")
      setExamEnd("17:00")
    } else if (type === "2h") {
      setReportingTime("09:30")
      setExamStart("10:00")
      setExamEnd("12:00")
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!examDate.trim()) return toast.error("Please choose an exam date.")
    if (!reportingTime.trim()) return toast.error("Please enter reporting time.")
    if (!examStart.trim() || !examEnd.trim()) return toast.error("Please enter exam start and end times.")

    setSaving(true)
    try {
      const created = await api.addSession(cycleId, {
        exam_date: examDate,
        session_type: sessionType,
        reporting_time: reportingTime,
        exam_start: examStart,
        exam_end: examEnd
      })
      toast.success(`Session added for ${examDate} (${sessionType})!`)
      onAdded(created)
      onClose()
    } catch (err: any) {
      console.error("Failed to add session:", err)
      toast.error(err?.message || "Failed to add session.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-light text-brand-primary flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-brand-textmain">Add Exam Session</h2>
              <p className="text-xs text-brand-textsec">New Session Step #{existingSessionsCount + 1}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleAdd} className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Quick Presets */}
          <div>
            <label className="text-xs font-bold text-brand-textsec uppercase tracking-wider block mb-1.5">
              Quick Timing Presets
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset("fn")}
                className="px-2.5 py-1 text-xs rounded-lg border border-brand-border hover:border-brand-primary hover:bg-brand-verylight text-brand-textmain transition-all"
              >
                Standard FN (10:00–13:00)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("an")}
                className="px-2.5 py-1 text-xs rounded-lg border border-brand-border hover:border-brand-primary hover:bg-brand-verylight text-brand-textmain transition-all"
              >
                Standard AN (14:00–17:00)
              </button>
              <button
                type="button"
                onClick={() => applyPreset("2h")}
                className="px-2.5 py-1 text-xs rounded-lg border border-brand-border hover:border-brand-primary hover:bg-brand-verylight text-brand-textmain transition-all"
              >
                2-Hr Exam (10:00–12:00)
              </button>
            </div>
          </div>

          {/* Date Picker */}
          <div className="space-y-1">
            <label className="label">Exam Date *</label>
            <input
              type="date"
              value={examDate}
              onChange={e => setExamDate(e.target.value)}
              className="input-field"
              required
            />
            {dateInfo && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-semibold text-brand-dark">{dateInfo.formatted}</span>
                {dateInfo.isSunday && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium">
                    <AlertTriangle className="w-3 h-3" /> Sunday (College Holiday)
                  </span>
                )}
                {dateInfo.holiday && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
                    <Zap className="w-3 h-3" /> {dateInfo.holiday.name}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Session Slot (FN / AN) */}
          <div className="space-y-1">
            <label className="label">Session Slot *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { setSessionType("FN"); if (reportingTime === "13:30") applyPreset("fn") }}
                className={`py-2 px-3 rounded-xl border text-sm font-semibold transition-all text-center ${
                  sessionType === "FN"
                    ? "bg-brand-primary text-white border-brand-primary shadow-xs"
                    : "bg-white text-brand-textmain border-brand-border hover:bg-gray-50"
                }`}
              >
                FN — Forenoon
              </button>
              <button
                type="button"
                onClick={() => { setSessionType("AN"); if (reportingTime === "09:30") applyPreset("an") }}
                className={`py-2 px-3 rounded-xl border text-sm font-semibold transition-all text-center ${
                  sessionType === "AN"
                    ? "bg-brand-primary text-white border-brand-primary shadow-xs"
                    : "bg-white text-brand-textmain border-brand-border hover:bg-gray-50"
                }`}
              >
                AN — Afternoon
              </button>
            </div>
          </div>

          {/* Manual Timings */}
          <div className="bg-brand-verylight p-3.5 rounded-xl border border-brand-border space-y-2.5">
            <span className="text-xs font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-brand-primary" /> Session Timings (Manual Setup)
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="text-[11px] font-medium text-brand-textsec block mb-1">Report Time</label>
                <input
                  type="time"
                  value={reportingTime}
                  onChange={e => setReportingTime(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[10px] text-brand-textsec block mt-0.5">{formatTime12h(reportingTime)}</span>
              </div>
              <div>
                <label className="text-[11px] font-medium text-brand-textsec block mb-1">Exam Start</label>
                <input
                  type="time"
                  value={examStart}
                  onChange={e => setExamStart(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[10px] text-brand-textsec block mt-0.5">{formatTime12h(examStart)}</span>
              </div>
              <div>
                <label className="text-[11px] font-medium text-brand-textsec block mb-1">Exam End</label>
                <input
                  type="time"
                  value={examEnd}
                  onChange={e => setExamEnd(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[10px] text-brand-textsec block mt-0.5">{formatTime12h(examEnd)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-brand-border">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-xs flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              {saving ? "Adding..." : "Add Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
