import { useState, useEffect } from "react"
import { X, ChevronRight, ChevronLeft, Calendar as CalendarIcon, Clock, AlertCircle, Settings, Sliders, Trash2 } from "lucide-react"
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

interface DateSessionConfig {
  fn: boolean
  an: boolean
  fnReport?: string
  fnStart?: string
  fnEnd?: string
  anReport?: string
  anStart?: string
  anEnd?: string
}

export default function CreateCycleWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("info")
  const [cycleName, setCycleName] = useState("")
  const [academicYear, setAcademicYear] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`)
  const [numDays, setNumDays] = useState(10)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [sessionConfig, setSessionConfig] = useState<Record<string, DateSessionConfig>>({})
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<Record<string, string> | null>(null)

  // Default global timings
  const [fnReportDefault, setFnReportDefault] = useState("09:30")
  const [fnStartDefault, setFnStartDefault] = useState("10:00")
  const [fnEndDefault, setFnEndDefault] = useState("13:00")
  const [anReportDefault, setAnReportDefault] = useState("13:30")
  const [anStartDefault, setAnStartDefault] = useState("14:00")
  const [anEndDefault, setAnEndDefault] = useState("17:00")

  // State to toggle manual timing inputs per date card
  const [expandedTimings, setExpandedTimings] = useState<Record<string, boolean>>({})
  const [showGlobalPresetBar, setShowGlobalPresetBar] = useState(false)

  // Load college settings for default exam timings
  useEffect(() => {
    api.getSettings().then(s => {
      setSettings(s)
      if (s?.["session.fn_reporting_time"]) setFnReportDefault(s["session.fn_reporting_time"])
      if (s?.["session.fn_start_time"]) setFnStartDefault(s["session.fn_start_time"])
      if (s?.["session.fn_end_time"]) setFnEndDefault(s["session.fn_end_time"])
      if (s?.["session.an_reporting_time"]) setAnReportDefault(s["session.an_reporting_time"])
      if (s?.["session.an_start_time"]) setAnStartDefault(s["session.an_start_time"])
      if (s?.["session.an_end_time"]) setAnEndDefault(s["session.an_end_time"])
    }).catch((err) => {
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
    const sc: Record<string, DateSessionConfig> = {}
    dates.forEach(d => { sc[d] = { fn: true, an: true } })
    setSessionConfig(sc)
    toast.success(`Selected ${dates.length} exam days (Sundays & holidays excluded).`)
  }

  function handleClearDates() {
    setSelectedDates([])
    setSessionConfig({})
    setExpandedTimings({})
  }

  function toggleSession(date: string, key: "fn" | "an") {
    setSessionConfig(c => ({
      ...c,
      [date]: { ...(c[date] ?? { fn: true, an: true }), [key]: !c[date]?.[key] }
    }))
  }

  function updateTiming(date: string, field: keyof DateSessionConfig, value: string) {
    setSessionConfig(c => ({
      ...c,
      [date]: { ...(c[date] ?? { fn: true, an: true }), [field]: value }
    }))
  }

  function toggleExpandTiming(date: string) {
    setExpandedTimings(prev => ({ ...prev, [date]: !prev[date] }))
  }

  function removeDate(date: string) {
    setSelectedDates(prev => prev.filter(d => d !== date))
    setSessionConfig(sc => {
      const next = { ...sc }
      delete next[date]
      return next
    })
    toast.success(`Removed ${date}`)
  }

  // Apply quick presets to all sessions
  function applyPresetToAll(type: "standard" | "2hour") {
    if (type === "standard") {
      setFnReportDefault("09:30")
      setFnStartDefault("10:00")
      setFnEndDefault("13:00")
      setAnReportDefault("13:30")
      setAnStartDefault("14:00")
      setAnEndDefault("17:00")
      setSessionConfig(c => {
        const next: Record<string, DateSessionConfig> = {}
        Object.entries(c).forEach(([d, cfg]) => {
          next[d] = {
            fn: cfg.fn,
            an: cfg.an,
            fnReport: "09:30",
            fnStart: "10:00",
            fnEnd: "13:00",
            anReport: "13:30",
            anStart: "14:00",
            anEnd: "17:00"
          }
        })
        return next
      })
      toast.success("Applied Standard SXCCE 3-Hour Exam Timings to all sessions.")
    } else if (type === "2hour") {
      setFnReportDefault("09:30")
      setFnStartDefault("10:00")
      setFnEndDefault("12:00")
      setAnReportDefault("13:30")
      setAnStartDefault("14:00")
      setAnEndDefault("16:00")
      setSessionConfig(c => {
        const next: Record<string, DateSessionConfig> = {}
        Object.entries(c).forEach(([d, cfg]) => {
          next[d] = {
            fn: cfg.fn,
            an: cfg.an,
            fnReport: "09:30",
            fnStart: "10:00",
            fnEnd: "12:00",
            anReport: "13:30",
            anStart: "14:00",
            anEnd: "16:00"
          }
        })
        return next
      })
      toast.success("Applied 2-Hour Exam Timings (10:00–12:00 / 14:00–16:00) to all sessions.")
    }
  }

  async function handleCreate() {
    if (!cycleName.trim()) return toast.error("Batch name is required.")
    const sessions: any[] = []
    const uniqueDates = Array.from(new Set(selectedDates)).sort()
    for (const date of uniqueDates) {
      const cfg = sessionConfig[date] ?? { fn: true, an: false }
      if (cfg.fn) {
        sessions.push({
          exam_date: date,
          session_type: "FN",
          reporting_time: cfg.fnReport ?? fnReportDefault,
          exam_start: cfg.fnStart ?? fnStartDefault,
          exam_end: cfg.fnEnd ?? fnEndDefault
        })
      }
      if (cfg.an) {
        sessions.push({
          exam_date: date,
          session_type: "AN",
          reporting_time: cfg.anReport ?? anReportDefault,
          exam_start: cfg.anStart ?? anStartDefault,
          exam_end: cfg.anEnd ?? anEndDefault
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
      toast.success(`Allocation batch created with ${sessions.length} sessions!`)
      onCreated(cycle)
    } catch (err: any) {
      console.error("Failed to create cycle:", err)
      toast.error(err?.message || "Failed to create batch.")
    } finally {
      setLoading(false)
    }
  }

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
              <h2 className="text-lg font-bold text-brand-textmain">New Allocation Batch</h2>
              <p className="text-xs text-brand-textsec">St. Xavier&apos;s Catholic College of Engineering — Allocation Batch Setup</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-3 px-6 py-3 bg-brand-verylight border-b border-brand-border text-sm">
          {[
            ["info", "1. Batch Info"],
            ["dates", "2. Select Dates"],
            ["sessions", "3. Configure Sessions & Timings"]
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
                <label className="label">Batch Name *</label>
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
                <p className="text-xs text-brand-textsec mt-1">Specify how many examination days will take place in this batch.</p>
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

          {/* STEP 3: SESSIONS & MANUAL TIMINGS */}
          {step === "sessions" && (
            <div className="space-y-4">
              {/* Top Action Bar: Reselect Dates & Global Presets */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-verylight p-3.5 rounded-xl border border-brand-border">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-brand-textmain">
                      Schedule & Timings ({selectedDates.length} Exam Days)
                    </span>
                    <span className="text-xs bg-brand-light text-brand-dark px-2 py-0.5 rounded font-bold">
                      {totalPlannedSessions} Planned Sessions
                    </span>
                  </div>
                  <p className="text-xs text-brand-textsec">
                    Customize reporting and exam timings per session or use global presets.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("dates")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-primary bg-white text-brand-primary hover:bg-brand-light text-xs font-semibold shadow-xs transition-all"
                    title="Return to Calendar to add, remove, or change dates"
                  >
                    <CalendarIcon className="w-3.5 h-3.5" />
                    Reselect Dates
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowGlobalPresetBar(p => !p)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-border bg-white text-brand-textmain hover:border-brand-primary text-xs font-semibold shadow-xs transition-all"
                  >
                    <Sliders className="w-3.5 h-3.5 text-brand-primary" />
                    Global Timings
                  </button>
                </div>
              </div>

              {/* Expandable Global Presets Panel */}
              {showGlobalPresetBar && (
                <div className="p-4 bg-white rounded-xl border border-brand-primary/40 shadow-sm space-y-3">
                  <div className="flex items-center justify-between border-b pb-2 border-brand-border">
                    <span className="text-xs font-bold text-brand-dark uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-brand-primary" /> Quick Timing Presets
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => applyPresetToAll("standard")}
                        className="px-2.5 py-1 text-xs rounded-lg border border-brand-primary text-brand-primary hover:bg-brand-verylight font-medium transition-all"
                      >
                        Apply 3-Hour Standard (10:00–13:00 / 14:00–17:00)
                      </button>
                      <button
                        type="button"
                        onClick={() => applyPresetToAll("2hour")}
                        className="px-2.5 py-1 text-xs rounded-lg border border-brand-primary text-brand-primary hover:bg-brand-verylight font-medium transition-all"
                      >
                        Apply 2-Hour Exams (10:00–12:00 / 14:00–16:00)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-brand-verylight rounded-lg space-y-2">
                      <span className="font-bold text-brand-textmain block">Default FN (Forenoon)</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-brand-textsec block">Report</label>
                          <input
                            type="time"
                            value={fnReportDefault}
                            onChange={e => setFnReportDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-textsec block">Start</label>
                          <input
                            type="time"
                            value={fnStartDefault}
                            onChange={e => setFnStartDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-textsec block">End</label>
                          <input
                            type="time"
                            value={fnEndDefault}
                            onChange={e => setFnEndDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-brand-verylight rounded-lg space-y-2">
                      <span className="font-bold text-brand-textmain block">Default AN (Afternoon)</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-brand-textsec block">Report</label>
                          <input
                            type="time"
                            value={anReportDefault}
                            onChange={e => setAnReportDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-textsec block">Start</label>
                          <input
                            type="time"
                            value={anStartDefault}
                            onChange={e => setAnStartDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-brand-textsec block">End</label>
                          <input
                            type="time"
                            value={anEndDefault}
                            onChange={e => setAnEndDefault(e.target.value)}
                            className="input-field py-1 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Sessions List */}
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {selectedDates.map((date, idx) => {
                  const cfg = sessionConfig[date] ?? { fn: true, an: true }
                  const holiday = getHoliday(date)
                  const isExpanded = expandedTimings[date]

                  const effectiveFnReport = cfg.fnReport ?? fnReportDefault
                  const effectiveFnStart = cfg.fnStart ?? fnStartDefault
                  const effectiveFnEnd = cfg.fnEnd ?? fnEndDefault

                  const effectiveAnReport = cfg.anReport ?? anReportDefault
                  const effectiveAnStart = cfg.anStart ?? anStartDefault
                  const effectiveAnEnd = cfg.anEnd ?? anEndDefault

                  return (
                    <div
                      key={date}
                      className={cn(
                        "border rounded-xl p-4 transition-all bg-white shadow-xs",
                        holiday ? "border-amber-300 bg-amber-50/20" : "border-brand-border"
                      )}
                    >
                      {/* Date Row Header */}
                      <div className="flex items-center justify-between mb-3 border-b border-gray-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-brand-light text-brand-primary text-xs font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-sm text-brand-textmain">
                            {formatFullDate(date)}
                          </span>
                          {holiday && (
                            <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md font-semibold">
                              <AlertCircle className="w-3 h-3" />
                              {holiday.name}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleExpandTiming(date)}
                            className={cn(
                              "inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all",
                              isExpanded
                                ? "bg-brand-primary text-white border-brand-primary"
                                : "bg-white text-brand-textsec border-brand-border hover:border-brand-primary hover:text-brand-primary"
                            )}
                          >
                            <Clock className="w-3 h-3" />
                            {isExpanded ? "Hide Timings" : "Manual Timings"}
                          </button>

                          <button
                            type="button"
                            onClick={() => removeDate(date)}
                            className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Remove this date"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* FN & AN Sessions */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Forenoon Session */}
                        <div
                          className={cn(
                            "flex flex-col p-3 rounded-xl border transition-all",
                            cfg.fn ? "bg-brand-verylight border-brand-primary/40" : "bg-gray-50 border-gray-200 opacity-60"
                          )}
                        >
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cfg.fn}
                              onChange={() => toggleSession(date, "fn")}
                              className="accent-brand-primary w-4 h-4 mt-0.5"
                            />
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-brand-textmain">FN — Forenoon</span>
                                <span className="text-[11px] bg-brand-light text-brand-dark px-1.5 py-0.2 rounded font-medium">
                                  Step
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-brand-textsec">
                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                <span>Reporting: <strong>{formatTime12h(effectiveFnReport)}</strong></span>
                              </div>
                              <div className="text-xs text-brand-textsec">
                                Exam: <strong>{formatTime12h(effectiveFnStart)} – {formatTime12h(effectiveFnEnd)}</strong>
                              </div>
                            </div>
                          </label>

                          {/* Expanded manual timing setup for FN */}
                          {isExpanded && cfg.fn && (
                            <div className="mt-3 pt-3 border-t border-brand-border/60 grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">Report</label>
                                <input
                                  type="time"
                                  value={effectiveFnReport}
                                  onChange={e => updateTiming(date, "fnReport", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">Start</label>
                                <input
                                  type="time"
                                  value={effectiveFnStart}
                                  onChange={e => updateTiming(date, "fnStart", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">End</label>
                                <input
                                  type="time"
                                  value={effectiveFnEnd}
                                  onChange={e => updateTiming(date, "fnEnd", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Afternoon Session */}
                        <div
                          className={cn(
                            "flex flex-col p-3 rounded-xl border transition-all",
                            cfg.an ? "bg-brand-verylight border-brand-primary/40" : "bg-gray-50 border-gray-200 opacity-60"
                          )}
                        >
                          <label className="flex items-start gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cfg.an}
                              onChange={() => toggleSession(date, "an")}
                              className="accent-brand-primary w-4 h-4 mt-0.5"
                            />
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-bold text-brand-textmain">AN — Afternoon</span>
                                <span className="text-[11px] bg-brand-light text-brand-dark px-1.5 py-0.2 rounded font-medium">
                                  Step
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-brand-textsec">
                                <Clock className="w-3.5 h-3.5 text-gray-400" />
                                <span>Reporting: <strong>{formatTime12h(effectiveAnReport)}</strong></span>
                              </div>
                              <div className="text-xs text-brand-textsec">
                                Exam: <strong>{formatTime12h(effectiveAnStart)} – {formatTime12h(effectiveAnEnd)}</strong>
                              </div>
                            </div>
                          </label>

                          {/* Expanded manual timing setup for AN */}
                          {isExpanded && cfg.an && (
                            <div className="mt-3 pt-3 border-t border-brand-border/60 grid grid-cols-3 gap-2">
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">Report</label>
                                <input
                                  type="time"
                                  value={effectiveAnReport}
                                  onChange={e => updateTiming(date, "anReport", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">Start</label>
                                <input
                                  type="time"
                                  value={effectiveAnStart}
                                  onChange={e => updateTiming(date, "anStart", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-medium text-brand-textsec block mb-0.5">End</label>
                                <input
                                  type="time"
                                  value={effectiveAnEnd}
                                  onChange={e => updateTiming(date, "anEnd", e.target.value)}
                                  className="input-field text-xs py-1"
                                />
                              </div>
                            </div>
                          )}
                        </div>
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
                  if (!cycleName.trim()) return toast.error("Batch name is required.")
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
              {loading ? "Creating Batch..." : `Create Batch (${totalPlannedSessions} Sessions)`}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
