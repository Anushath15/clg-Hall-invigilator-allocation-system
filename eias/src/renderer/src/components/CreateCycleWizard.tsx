import { useState } from "react"
import { X, ChevronRight, ChevronLeft, Calendar } from "lucide-react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { format, addDays, parseISO, isValid } from "date-fns"
import { cn } from "../lib/utils"

interface Props { onClose: () => void; onCreated: (cycle: any) => void }

type Step = "info" | "dates" | "sessions"

export default function CreateCycleWizard({ onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("info")
  const [cycleName, setCycleName] = useState("")
  const [academicYear, setAcademicYear] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`)
  const [numDays, setNumDays] = useState(10)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [sessionConfig, setSessionConfig] = useState<Record<string, { fn: boolean; an: boolean }>>({})
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<any>(null)

  // Load settings for default times
  useState(() => { api.getSettings().then(setSettings) })

  function toggleDate(date: string) {
    setSelectedDates(prev => {
      if (prev.includes(date)) {
        const n = prev.filter(d => d !== date)
        const sc = { ...sessionConfig }; delete sc[date]; setSessionConfig(sc)
        return n
      }
      if (prev.length >= numDays) { toast.error(`Already selected ${numDays} dates.`); return prev }
      setSessionConfig(c => ({ ...c, [date]: { fn: true, an: true } }))
      return [...prev, date].sort()
    })
  }

  function toggleSession(date: string, key: "fn" | "an") {
    setSessionConfig(c => ({ ...c, [date]: { ...c[date], [key]: !c[date]?.[key] } }))
  }

  async function handleCreate() {
    if (!cycleName.trim()) return toast.error("Cycle name is required.")
    const sessions: any[] = []
    for (const date of selectedDates) {
      const cfg = sessionConfig[date] ?? { fn: true, an: false }
      if (cfg.fn) sessions.push({ exam_date: date, session_type: "FN", reporting_time: settings?.["session.fn_reporting_time"] ?? "09:30", exam_start: settings?.["session.fn_start_time"] ?? "10:00", exam_end: settings?.["session.fn_end_time"] ?? "13:00" })
      if (cfg.an) sessions.push({ exam_date: date, session_type: "AN", reporting_time: settings?.["session.an_reporting_time"] ?? "13:30", exam_start: settings?.["session.an_start_time"] ?? "14:00", exam_end: settings?.["session.an_end_time"] ?? "17:00" })
    }
    if (sessions.length === 0) return toast.error("No sessions configured.")
    setLoading(true)
    try {
      const cycle = await api.createCycle({ name: cycleName, academic_year: academicYear })
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

  // Generate calendar grid — 3 months from today
  const today = new Date()
  const calendarDays: string[] = []
  for (let i = 0; i < 90; i++) {
    const d = addDays(today, i)
    if (d.getDay() !== 0) calendarDays.push(format(d, "yyyy-MM-dd"))
  }
  const weeks: string[][] = []
  let week: string[] = []
  calendarDays.forEach(d => { week.push(d); if (week.length === 6) { weeks.push(week); week = [] } })
  if (week.length) weeks.push(week)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <h2 className="text-lg font-bold text-brand-textmain">Create Exam Allocation</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 px-6 py-3 bg-brand-verylight border-b border-brand-border text-sm">
          {[["info","1. Cycle Info"],["dates","2. Select Dates"],["sessions","3. Sessions"]].map(([s, label], i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={cn("font-medium", step === s ? "text-brand-primary" : "text-brand-textsec")}>{label}</span>
              {i < 2 && <ChevronRight className="w-4 h-4 text-gray-300" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === "info" && (
            <div className="space-y-4">
              <div><label className="label">Cycle Name *</label><input className="input-field" value={cycleName} onChange={e => setCycleName(e.target.value)} placeholder="e.g. Nov 2026 Semester Exams" /></div>
              <div><label className="label">Academic Year</label><input className="input-field" value={academicYear} onChange={e => setAcademicYear(e.target.value)} placeholder="e.g. 2026-27" /></div>
              <div><label className="label">Number of Exam Days *</label>
                <input type="number" min={1} max={30} className="input-field w-32" value={numDays} onChange={e => setNumDays(Number(e.target.value))} />
              </div>
            </div>
          )}

          {step === "dates" && (
            <div>
              <p className="text-sm text-brand-textsec mb-4">Selected: <span className="font-semibold text-brand-primary">{selectedDates.length}</span> / {numDays}</p>
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
                {["Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} className="text-center text-xs font-semibold text-brand-textsec py-2">{d}</div>)}
                {calendarDays.map((day) => {
                  const isSelected = selectedDates.includes(day)
                  const dt = parseISO(day)
                  return (
                    <button key={day} onClick={() => toggleDate(day)}
                      className={cn("p-2 rounded-lg text-center text-xs transition-all border",
                        isSelected ? "bg-brand-primary text-white border-brand-primary font-semibold" : "border-transparent hover:border-brand-light hover:bg-brand-verylight text-brand-textmain")}>
                      <div className="font-medium">{format(dt,"d")}</div>
                      <div className="text-[10px] opacity-70">{format(dt,"MMM")}</div>
                    </button>
                  )
                })}
              </div>
              {selectedDates.length > 0 && (
                <div className="mt-4 p-3 bg-brand-verylight rounded-lg">
                  <p className="text-xs font-semibold text-brand-primary mb-2">Selected Dates:</p>
                  <div className="flex flex-wrap gap-1">
                    {selectedDates.map(d => <span key={d} className="text-xs bg-brand-light text-brand-dark px-2 py-0.5 rounded-full">{format(parseISO(d),"dd MMM yyyy")}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "sessions" && (
            <div className="space-y-3">
              <p className="text-sm text-brand-textsec mb-2">Configure sessions for each exam date. Each checked session becomes one rotation step.</p>
              {selectedDates.map(date => {
                const cfg = sessionConfig[date] ?? { fn: true, an: true }
                const dt = parseISO(date)
                return (
                  <div key={date} className="border border-brand-border rounded-lg p-4">
                    <p className="font-medium text-sm mb-3">{format(dt, "EEEE, dd MMMM yyyy")}</p>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={cfg.fn} onChange={() => toggleSession(date, "fn")} className="accent-brand-primary w-4 h-4" />
                        <span className="text-sm font-medium">FN — Forenoon</span>
                        <span className="text-xs text-brand-textsec">({settings?.["session.fn_start_time"] ?? "10:00"} – {settings?.["session.fn_end_time"] ?? "13:00"})</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={cfg.an} onChange={() => toggleSession(date, "an")} className="accent-brand-primary w-4 h-4" />
                        <span className="text-sm font-medium">AN — Afternoon</span>
                        <span className="text-xs text-brand-textsec">({settings?.["session.an_start_time"] ?? "14:00"} – {settings?.["session.an_end_time"] ?? "17:00"})</span>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-brand-border">
          <button onClick={() => step === "info" ? onClose() : setStep(step === "sessions" ? "dates" : "info")}
            className="btn-secondary flex items-center gap-2">
            {step !== "info" && <ChevronLeft className="w-4 h-4" />}
            {step === "info" ? "Cancel" : "Back"}
          </button>
          {step !== "sessions" ? (
            <button
              onClick={() => { if (step === "info") { if (!cycleName.trim()) return toast.error("Cycle name required."); setStep("dates") } else if (step === "dates") { if (selectedDates.length !== numDays) return toast.error(`Please select exactly ${numDays} dates.`); setStep("sessions") } }}
              className="btn-primary flex items-center gap-2">
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleCreate} disabled={loading} className="btn-primary flex items-center gap-2">
              {loading ? "Creating..." : "Create Allocation"} <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
