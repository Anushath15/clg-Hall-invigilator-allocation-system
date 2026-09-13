import { useEffect, useState } from "react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { Save } from "lucide-react"

const FIELDS = [
  { key: "college.name", label: "College Name", type: "text" },
  { key: "college.short_name", label: "Short Name / Abbreviation", type: "text" },
  { key: "session.fn_reporting_time", label: "FN Reporting Time", type: "time" },
  { key: "session.fn_start_time", label: "FN Exam Start Time", type: "time" },
  { key: "session.fn_end_time", label: "FN Exam End Time", type: "time" },
  { key: "session.an_reporting_time", label: "AN Reporting Time", type: "time" },
  { key: "session.an_start_time", label: "AN Exam Start Time", type: "time" },
  { key: "session.an_end_time", label: "AN Exam End Time", type: "time" },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => { api.getSettings().then(setSettings) }, [])

  async function save() {
    setLoading(true)
    try {
      await Promise.all(Object.entries(settings).map(([k, v]) => api.saveSetting(k, v)))
      toast.success("Settings saved!")
    } finally { setLoading(false) }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-brand-textmain mb-2">Settings</h1>
      <p className="text-brand-textsec mb-8">Configure college details and default exam session timings</p>
      <div className="card space-y-5">
        <h2 className="font-semibold text-brand-textmain border-b border-brand-border pb-3">College Profile</h2>
        {FIELDS.slice(0, 2).map(f => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            <input type={f.type} className="input-field" value={settings[f.key] ?? ""}
              onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))} />
          </div>
        ))}
        <h2 className="font-semibold text-brand-textmain border-b border-brand-border pb-3 pt-2">Default Session Timings</h2>
        <div className="grid grid-cols-2 gap-4">
          {FIELDS.slice(2).map(f => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input type={f.type} className="input-field" value={settings[f.key] ?? ""}
                onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="pt-2">
          <button onClick={save} disabled={loading} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" /> {loading ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  )
}
