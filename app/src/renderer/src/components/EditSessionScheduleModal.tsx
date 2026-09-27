import { useState, useMemo } from "react"
import { X, Calendar, Clock, AlertTriangle, Trash2, CheckCircle, Zap } from "lucide-react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { formatFullDate, formatTime12h, cn } from "../lib/utils"
import { getHoliday, isSundayDate } from "../lib/holidays"
import { parseISO } from "date-fns"

interface EditSessionScheduleModalProps {
  session: any
  existingSessions?: any[]
  onClose: () => void
  onSaved: (updated: any) => void
  onDeleted?: (sessionId: number) => void
}

export default function EditSessionScheduleModal({
  session,
  existingSessions,
  onClose,
  onSaved,
  onDeleted
}: EditSessionScheduleModalProps) {
  const [examDate, setExamDate] = useState<string>(session.exam_date ?? "")
  const [sessionType, setSessionType] = useState<"FN" | "AN">(session.session_type ?? "FN")
  const [reportingTime, setReportingTime] = useState<string>(session.reporting_time ?? "09:30")
  const [examStart, setExamStart] = useState<string>(session.exam_start ?? "10:00")
  const [examEnd, setExamEnd] = useState<string>(session.exam_end ?? "13:00")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Real-time conflict check if new date + session_type conflicts with another session
  const isDuplicate = useMemo(() => {
    if (!examDate || !existingSessions) return false
    return existingSessions.some(
      s => s.id !== session.id && s.exam_date === examDate && s.session_type === sessionType
    )
  }, [examDate, sessionType, session.id, existingSessions])

  // Check if current session was already a duplicate
  const isCurrentlyDuplicate = useMemo(() => {
    if (!existingSessions) return false
    return existingSessions.some(
      s => s.id !== session.id && s.exam_date === session.exam_date && s.session_type === session.session_type
    )
  }, [session, existingSessions])

  // Calculate duration in minutes and format
  const durationText = useMemo(() => {
    if (!examStart || !examEnd) return ""
    try {
      const [sh, sm] = examStart.split(":").map(Number)
      const [eh, em] = examEnd.split(":").map(Number)
      let diffMins = (eh * 60 + em) - (sh * 60 + sm)
      if (diffMins < 0) diffMins += 24 * 60
      const hrs = Math.floor(diffMins / 60)
      const mins = diffMins % 60
      if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} mins`
      if (hrs > 0) return `${hrs} hr${hrs > 1 ? "s" : ""}`
      return `${mins} mins`
    } catch {
      return ""
    }
  }, [examStart, examEnd])

  // Date info (weekday, holiday, sunday)
  const dateInfo = useMemo(() => {
    if (!examDate) return null
    try {
      const d = parseISO(examDate)
      const isSunday = isSundayDate(d)
      const holiday = getHoliday(examDate)
      return {
        formatted: formatFullDate(examDate),
        isSunday,
        holiday
      }
    } catch {
      return null
    }
  }, [examDate])

  // Preset handlers
  function applyPreset(type: "fn" | "an" | "2h") {
    if (type === "fn") {
      setSessionType("FN")
      setReportingTime("09:30")
      setExamStart("10:00")
      setExamEnd("13:00")
      toast.success("Applied Standard SXCCE FN Preset (09:30 / 10:00 – 13:00)")
    } else if (type === "an") {
      setSessionType("AN")
      setReportingTime("13:30")
      setExamStart("14:00")
      setExamEnd("17:00")
      toast.success("Applied Standard SXCCE AN Preset (13:30 / 14:00 – 17:00)")
    } else if (type === "2h") {
      setReportingTime("09:30")
      setExamStart("10:00")
      setExamEnd("12:00")
      toast.success("Applied 2-Hour Exam Preset (10:00 – 12:00)")
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (isDuplicate) {
      return toast.error(`A ${sessionType === "FN" ? "Forenoon (FN)" : "Afternoon (AN)"} session already exists for ${examDate} in this cycle.`)
    }
    if (!examDate.trim()) return toast.error("Exam date is required.")
    if (!reportingTime.trim()) return toast.error("Reporting time is required.")
    if (!examStart.trim() || !examEnd.trim()) return toast.error("Exam start and end times are required.")

    setSaving(true)
    try {
      const updated = await api.updateSession(session.id, {
        exam_date: examDate,
        session_type: sessionType,
        reporting_time: reportingTime,
        exam_start: examStart,
        exam_end: examEnd,
        status: session.status
      })
      toast.success("Session schedule and timings updated!")
      onSaved(updated)
    } catch (err: any) {
      console.error("Failed to update session:", err)
      toast.error(err?.message || "Failed to update session schedule.")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Are you sure you want to delete this session (${session.exam_date} ${session.session_type})?`)) {
      return
    }
    setDeleting(true)
    try {
      const res = await api.deleteSession(session.id)
      if (res.success) {
        toast.success("Session deleted successfully.")
        onDeleted?.(session.id)
        onClose()
      } else {
        toast.error(res.error || "Could not delete session.")
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete session.")
    } finally {
      setDeleting(false)
    }
  }

  const canDelete = session.status === "pending"

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-light text-brand-primary flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-brand-textmain">
                Edit Session Schedule & Timings
              </h2>
              <p className="text-xs text-brand-textsec">
                Session Step #{session.rotation_step} · {session.exam_date} ({session.session_type})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5 flex-1 overflow-y-auto">
          {/* Unresolved existing duplicate banner */}
          {isCurrentlyDuplicate && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-800 flex items-start gap-2.5 shadow-xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Duplicate Session Detected</p>
                <p className="mt-0.5 text-amber-800">
                  This session currently has the identical date and slot (<strong>{session.exam_date} {session.session_type}</strong>) as another session in this cycle.
                </p>
                <p className="mt-1 text-amber-900 font-medium">
                  Please pick a different date/slot below, or use the "Delete Session" button below to remove this duplicate.
                </p>
              </div>
            </div>
          )}

          {/* New conflict banner */}
          {isDuplicate && (
            <div className="p-3.5 bg-red-50 border border-red-300 rounded-xl text-xs text-red-800 flex items-start gap-2.5 shadow-xs">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-900">Duplicate Schedule Error</p>
                <p className="mt-0.5 text-red-800">
                  Another session is already scheduled for <strong>{dateInfo?.formatted ?? examDate} ({sessionType})</strong>. Each exam date can only have at most one FN and one AN session.
                </p>
              </div>
            </div>
          )}

          {/* Preset buttons */}
          <div>
            <label className="text-xs font-bold text-brand-textsec uppercase tracking-wider block mb-2">
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

          {/* Section 1: Date Reselection */}
          <div className="space-y-1.5">
            <label className="label">Exam Date *</label>
            <input
              type="date"
              value={examDate}
              onChange={e => setExamDate(e.target.value)}
              className="input-field font-medium"
              required
            />
            {dateInfo && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-semibold text-brand-dark">
                  {dateInfo.formatted}
                </span>
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

          {/* Section 2: Session Slot (FN / AN) */}
          <div className="space-y-1.5">
            <label className="label">Session Slot *</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSessionType("FN")}
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
                onClick={() => setSessionType("AN")}
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

          {/* Section 3: Manual Time Setup */}
          <div className="bg-brand-verylight p-4 rounded-xl border border-brand-border space-y-3">
            <div className="flex items-center justify-between border-b border-brand-border/60 pb-2">
              <span className="text-xs font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-brand-primary" /> Manual Timings
              </span>
              {durationText && (
                <span className="text-xs font-bold bg-white text-brand-primary px-2 py-0.5 rounded-full border border-brand-border">
                  Exam Duration: {durationText}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Reporting Time */}
              <div>
                <label className="text-xs font-medium text-brand-textsec block mb-1">
                  Report Time
                </label>
                <input
                  type="time"
                  value={reportingTime}
                  onChange={e => setReportingTime(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[11px] text-brand-textsec font-medium mt-0.5 block">
                  {formatTime12h(reportingTime)}
                </span>
              </div>

              {/* Exam Start Time */}
              <div>
                <label className="text-xs font-medium text-brand-textsec block mb-1">
                  Exam Start
                </label>
                <input
                  type="time"
                  value={examStart}
                  onChange={e => setExamStart(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[11px] text-brand-textsec font-medium mt-0.5 block">
                  {formatTime12h(examStart)}
                </span>
              </div>

              {/* Exam End Time */}
              <div>
                <label className="text-xs font-medium text-brand-textsec block mb-1">
                  Exam End
                </label>
                <input
                  type="time"
                  value={examEnd}
                  onChange={e => setExamEnd(e.target.value)}
                  className="input-field text-xs font-semibold py-1.5"
                  required
                />
                <span className="text-[11px] text-brand-textsec font-medium mt-0.5 block">
                  {formatTime12h(examEnd)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-brand-border">
            {canDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-all"
                title="Delete this unallocated session"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? "Deleting..." : "Delete Session"}
              </button>
            ) : (
              <span className="text-xs text-brand-textsec italic">
                {session.status !== "pending" ? "Cannot delete: session already active." : ""}
              </span>
            )}

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="btn-secondary text-xs">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || isDuplicate || !examDate}
                className={cn(
                  "btn-primary text-xs flex items-center gap-1.5",
                  (isDuplicate || !examDate) && "opacity-50 cursor-not-allowed"
                )}
              >
                <CheckCircle className="w-4 h-4" />
                {saving ? "Saving..." : "Save Schedule"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
