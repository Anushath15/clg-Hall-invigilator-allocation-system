import { useState, useEffect } from "react"
import { X, ChevronRight, ChevronLeft, Calendar as CalendarIcon, Clock, AlertCircle } from "lucide-react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { addDays, format } from "date-fns"
import { cn, formatFullDate, formatTime12h } from "../lib/utils"
import RealCalendar from "./RealCalendar"
import { getHoliday, getExamDateStatus } from "../lib/holidays"

interface Props {
  onClose: () => void
  onCreated: (cycle: any) => void
}

type Step = "info" | "dates" | "sessions"

export default function CreateCycleWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("info")
  const [cycleName, setCycleName] = useState("")
  const [academicYear, setAcademicYear] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`)
  const [numDays, setNumDays] = useState(10)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [sessionConfig, setSessionConfig] = useState<Record<string, { fn: boolean; an: boolean }>>({})
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<Record<string, string> | null>(null)

  // Load college settings for default exam timings
  useEffect(() => {
    api.getSettings().then(setSettings).catch((err) => {
      console.warn("Could not load college settings:", err)
    })
  }, [])

  function toggleDate(date: string) {
    setSelectedDates(prev => {
      if (prev.includes(date)) {
        const n = prev.filter(d => d !== date)
        const sc = { ...sessionConfig }
        delete sc[date]
        setSessionConfig(sc)
        return n
      }
      if (prev.length >= numDays) {
        toast.error(`Already selected ${numDays} dates. Increase "Number of Exam Days" in Step 1 to select more.`)
        return prev
      }
      setSessionConfig(c => ({ ...c, [date]: { fn: true, an: true } }))
      return [...prev, date].sort()
    })
  }

  function handleAutoSelect(count: number) {
    const dates: string[] = []
    let cursor = new Date()
    // Start from tomorrow
    cursor = addDays(cursor, 1)
    let safety = 0
    while (dates.length < count && safety < 120) {
      safety++
      const dateStr = format(cursor, "yyyy-MM-dd")
      const status = getExamDateStatus(dateStr, cursor)
      if (status.isExamDay) {
        dates.push(dateStr)
      }
      cursor = addDays(cursor, 1)
    }
    setSelectedDates(dates)
    const sc: Record<string, { fn: boolean; an: boolean }> = {}
    dates.forEach(d => { sc[d] = { fn: true, an: true } })
    setSessionConfig(sc)
    toast.success(`Selected ${dates.length} exam days (Sundays & holidays excluded).`)
  }

  function handleClearDates() {
    setSelectedDates([])
    setSessionConfig({})
  }

  function toggleSession(date: string, key: "fn" | "an") {
    setSessionConfig(c => ({ ...c, [date]: { ...c[date], [key]: !c[date]?.[key] } }))
  }

  async function handleCreate() {
    if (!cycleName.trim()) return toast.error("Cycle name is required.")
    const sessions: any[] = []
    for (const date of selectedDates) {
      const cfg = sessionConfig[date] ?? { fn: true, an: false }
      if (cfg.fn) {
        sessions.push({
          exam_date: date,
          session_type: "FN",
          reporting_time: settings?.["session.fn_reporting_time"] ?? "09:30",
          exam_start: settings?.["session.fn_start_time"] ?? "10:00",
          exam_end: settings?.["session.fn_end_time"] ?? "13:00"
        })
      }
      if (cfg.an) {
        sessions.push({
          exam_date: date,
          session_type: "AN",
          reporting_time: settings?.["session.an_reporting_time"] ?? "13:30",
          exam_start: settings?.["session.an_start_time"] ?? "14:00",
          exam_end: settings?.["session.an_end_time"] ?? "17:00"
        })
      }
    }
    if (sessions.length === 0) return toast.error("Please enable at least one FN or AN session.")

    setLoading(true)
    try {
      const cycle = await api.createCycle({ name: cycleName.trim(), academic_year: academicYear.trim() })
      if (!cycle || !cycle.id) {
        throw new Error("Failed to create cycle record.")
      }
      await api.createSessions(cycle.id, sessions)
      toast.success(`Exam cycle created with ${sessions.length} sessions!`)
      onCreated(cycle)
    } catch (err: any) {
      console.error("Failed to create cycle:", err)
      toast.error(err?.message || "Failed to create cycle.")
    } finally {
      setLoading(false)
    }
  }

  // College session timing defaults
  const fnReporting = settings?.["session.fn_reporting_time"] ?? "09:30"
  const fnStart = settings?.["session.fn_start_time"] ?? "10:00"
  const fnEnd = settings?.["session.fn_end_time"] ?? "13:00"
  const anReporting = settings?.["session.an_reporting_time"] ?? "13:30"
  const anStart = settings?.["session.an_start_time"] ?? "14:00"
  const anEnd = settings?.["session.an_end_time"] ?? "17:00"

  // Count total sessions configured
  const totalPlannedSessions = selectedDates.reduce((acc, d) => {
    const cfg = sessionConfig[d] ?? { fn: true, an: true }
    return acc + (cfg.fn ? 1 : 0) + (cfg.an ? 1 : 0)
  }, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-light text-brand-primary flex items-center justify-center">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-brand-textmain">Create Exam Allocation</h2>
              <p className="text-xs text-brand-textsec">St. Xavier&apos;s Catholic College of Engineering — Exam Cycle Setup</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-3 px-6 py-3 bg-brand-verylight border-b border-brand-border text-sm">
          {[
            ["info", "1. Cycle Info"],
            ["dates", "2. Select Dates"],
            ["sessions", "3. Configure Sessions"]
          ].map(([s, label], i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={cn("font-medium", step === s ? "text-brand-primary font-bold" : "text-brand-textsec")}>
                {label}
              </span>
              {i < 2 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          ))}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* STEP 1: INFO */}
          {step === "info" && (
            <div className="space-y-4 max-w-xl">
              <div>
                <label className="label">Cycle Name *</label>
                <input
                  className="input-field"
                  value={cycleName}
                  onChange={e => setCycleName(e.target.value)}
                  placeholder="e.g. November 2026 End Semester Examinations"
                  autoFocus
                />
                <p className="text-xs text-brand-textsec mt-1">Provide a descriptive name for this examination series.</p>
              </div>

              <div>
                <label className="label">Academic Year *</label>
                <input
                  className="input-field"
                  value={academicYear}
                  onChange={e => setAcademicYear(e.target.value)}
                  placeholder="e.g. 2026-27"
                />
              </div>

              <div>
                <label className="label">Number of Exam Days *</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input-field w-36"
                  value={numDays}
                  onChange={e => setNumDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                />
                <p className="text-xs text-brand-textsec mt-1">Specify how many examination days will take place in this cycle.</p>
              </div>
            </div>
          )}

          {/* STEP 2: REAL-WORLD CALENDAR */}
          {step === "dates" && (
            <RealCalendar
              selectedDates={selectedDates}
              onToggleDate={toggleDate}
              maxDates={numDays}
              onAutoSelect={handleAutoSelect}
              onClearDates={handleClearDates}
            />
          )}

          {/* STEP 3: SESSIONS */}
          {step === "sessions" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-brand-verylight p-3.5 rounded-xl border border-brand-border">
                <div>
                  <p className="text-sm font-bold text-brand-textmain">
                    Configure Session Schedule ({selectedDates.length} Exam Days)
                  </p>
                  <p className="text-xs text-brand-textsec mt-0.5">
                    Select Forenoon (FN) and/or Afternoon (AN) slots for each day. Each active slot forms one chronological allocation step.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-brand-textsec uppercase block">Planned Sessions</span>
                  <span className="text-lg font-bold text-brand-primary">{totalPlannedSessions}</span>
                </div>
              </div>

              <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                {selectedDates.map((date, idx) => {
                  const cfg = sessionConfig[date] ?? { fn: true, an: true }
                  const holiday = getHoliday(date)

                  return (
                    <div
                      key={date}
                      className={cn(
                        "border rounded-xl p-4 transition-all bg-white shadow-xs",
                        holiday ? "border-amber-300 bg-amber-50/20" : "border-brand-border"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-brand-light text-brand-primary text-xs font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-sm text-brand-textmain">
                            {formatFullDate(date)}
                          </span>
                        </div>
                        {holiday && (
                          <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-semibold">
                            <AlertCircle className="w-3.5 h-3.5" />
                            {holiday.name}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Forenoon Session */}
                        <label className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                          cfg.fn ? "bg-brand-verylight border-brand-primary/40" : "bg-gray-50 border-gray-200 opacity-60"
                        )}>
                          <input
                            type="checkbox"
                            checked={cfg.fn}
                            onChange={() => toggleSession(date, "fn")}
                            className="accent-brand-primary w-4 h-4 mt-0.5"
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-brand-textmain">FN — Forenoon</span>
                              <span className="text-[11px] bg-brand-light text-brand-dark px-1.5 py-0.2 rounded font-medium">
                                Step
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-brand-textsec">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              <span>Reporting: <strong>{formatTime12h(fnReporting)}</strong> ({fnReporting})</span>
                            </div>
                            <div className="text-xs text-brand-textsec">
                              Exam: <strong>{formatTime12h(fnStart)} – {formatTime12h(fnEnd)}</strong> ({fnStart}–{fnEnd})
                            </div>
                          </div>
                        </label>

                        {/* Afternoon Session */}
                        <label className={cn(
                          "flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                          cfg.an ? "bg-brand-verylight border-brand-primary/40" : "bg-gray-50 border-gray-200 opacity-60"
                        )}>
                          <input
                            type="checkbox"
                            checked={cfg.an}
                            onChange={() => toggleSession(date, "an")}
                            className="accent-brand-primary w-4 h-4 mt-0.5"
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-brand-textmain">AN — Afternoon</span>
                              <span className="text-[11px] bg-brand-light text-brand-dark px-1.5 py-0.2 rounded font-medium">
                                Step
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-brand-textsec">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              <span>Reporting: <strong>{formatTime12h(anReporting)}</strong> ({anReporting})</span>
                            </div>
                            <div className="text-xs text-brand-textsec">
                              Exam: <strong>{formatTime12h(anStart)} – {formatTime12h(anEnd)}</strong> ({anStart}–{anEnd})
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-brand-border bg-gray-50/70">
          <button
            type="button"
            onClick={() => (step === "info" ? onClose() : setStep(step === "sessions" ? "dates" : "info"))}
            className="btn-secondary flex items-center gap-1.5"
          >
            {step !== "info" && <ChevronLeft className="w-4 h-4" />}
            {step === "info" ? "Cancel" : "Back"}
          </button>

          {step !== "sessions" ? (
            <button
              type="button"
              onClick={() => {
                if (step === "info") {
                  if (!cycleName.trim()) return toast.error("Cycle name is required.")
                  setStep("dates")
                } else if (step === "dates") {
                  if (selectedDates.length !== numDays) {
                    return toast.error(`Please select exactly ${numDays} exam dates (currently ${selectedDates.length} selected).`)
                  }
                  setStep("sessions")
                }
              }}
              className="btn-primary flex items-center gap-1.5"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || totalPlannedSessions === 0}
              className="btn-primary flex items-center gap-1.5"
            >
              {loading ? "Creating Allocation..." : `Create Allocation (${totalPlannedSessions} Sessions)`}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
