import { useEffect, useState } from "react"
import { Save, Download, Upload, Lock, CheckCircle, AlertTriangle, Info } from "lucide-react"
import { api } from "../lib/api"
import { useAuthStore } from "../store/auth.store"
import toast from "react-hot-toast"

const SECTIONS = ["College Profile", "Session Timings", "Change Password", "Backup & Restore"]

export default function SettingsPage() {
  const { user } = useAuthStore()
  const [active, setActive] = useState("College Profile")
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [changed, setChanged] = useState<Record<string, string>>({})
  const [pw, setPw] = useState({ old: "", new1: "", new2: "" })
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; msg: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getSettings().then(s => { setSettings(s); setChanged({}) }) }, [])

  function set(key: string, val: string) { setChanged(c => ({ ...c, [key]: val })) }
  const get = (key: string) => changed[key] ?? settings[key] ?? ""

  async function saveSection() {
    setSaving(true)
    try {
      for (const [k, v] of Object.entries(changed)) await api.saveSetting(k, v)
      setSettings(s => ({ ...s, ...changed }))
      setChanged({})
      toast.success("Settings saved!")
    } finally { setSaving(false) }
  }

  async function changePassword() {
    setPwMsg(null)
    if (!pw.old) { setPwMsg({ ok: false, msg: "Enter your current password." }); return }
    if (pw.new1.length < 6) { setPwMsg({ ok: false, msg: "New password must be at least 6 characters." }); return }
    if (pw.new1 !== pw.new2) { setPwMsg({ ok: false, msg: "New passwords do not match." }); return }
    const r = await api.changePassword(user!.id, pw.old, pw.new1)
    if (r.success) { setPwMsg({ ok: true, msg: "Password changed successfully." }); setPw({ old: "", new1: "", new2: "" }) }
    else setPwMsg({ ok: false, msg: r.error ?? "Failed to change password." })
  }

  async function backup() {
    const dest = await api.openSaveDialog([{ name: "EIAS Backup", extensions: ["db"] }], "eias-backup.db")
    if (!dest) return
    const r = await api.backupDatabase(dest)
    if (r.success) toast.success("Database backed up successfully!")
    else toast.error("Backup failed: " + r.error)
  }

  async function restore() {
    if (!confirm("Restore will replace all current data with the backup. A safety copy will be saved. Continue?")) return
    const src = await api.openFileDialog([{ name: "EIAS Backup", extensions: ["db"] }])
    if (!src) return
    const r = await api.restoreDatabase(src)
    if (r.success) {
      toast.success("Database restored! Restart the app to apply changes.")
    } else {
      toast.error("Restore failed: " + r.error)
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-brand-textmain mb-2">Settings</h1>
      <p className="text-brand-textsec mb-6">Configure college profile, session defaults, and system options</p>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0">
          <nav className="space-y-1">
            {SECTIONS.map(s => (
              <button key={s} onClick={() => setActive(s)}
                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active === s ? "bg-brand-primary text-white" : "text-brand-textsec hover:bg-gray-100"
                }`}>{s}</button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 max-w-2xl">

          {/* College Profile */}
          {active === "College Profile" && (
            <div className="card">
              <h2 className="text-base font-semibold text-brand-textmain mb-5">College Profile</h2>
              <div className="space-y-4">
                <div>
                  <label className="label">College Full Name</label>
                  <input className="input-field" value={get("college.name")} onChange={e => set("college.name", e.target.value)} />
                  <p className="text-xs text-brand-textsec mt-1">Appears on all report letterheads and print headers</p>
                </div>
                <div>
                  <label className="label">Short Name / Abbreviation</label>
                  <input className="input-field w-40" value={get("college.short_name")} onChange={e => set("college.short_name", e.target.value)} />
                </div>
                <div>
                  <label className="label">App Version</label>
                  <input className="input-field w-40 opacity-50 cursor-not-allowed" value={get("app.version")} readOnly disabled />
                </div>
              </div>
              {Object.keys(changed).length > 0 && (
                <button onClick={saveSection} disabled={saving} className="btn-primary mt-5 flex items-center gap-2">
                  <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Profile"}
                </button>
              )}
            </div>
          )}

          {/* Session Timings */}
          {active === "Session Timings" && (
            <div className="card">
              <h2 className="text-base font-semibold text-brand-textmain mb-1">Session Timings</h2>
              <p className="text-sm text-brand-textsec mb-5">
                Default times used when creating exam sessions. Override per-session in the exam wizard.
              </p>
              <div className="space-y-6">
                {[
                  { prefix: "session.fn", label: "Forenoon (FN) Session" },
                  { prefix: "session.an", label: "Afternoon (AN) Session" }
                ].map(({ prefix, label }) => (
                  <div key={prefix}>
                    <h3 className="text-sm font-semibold text-brand-textmain mb-3 border-b border-brand-border pb-2">{label}</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="label">Reporting Time</label>
                        <input type="time" className="input-field" value={get(`${prefix}_reporting_time`)} onChange={e => set(`${prefix}_reporting_time`, e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Exam Start</label>
                        <input type="time" className="input-field" value={get(`${prefix}_start_time`)} onChange={e => set(`${prefix}_start_time`, e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Exam End</label>
                        <input type="time" className="input-field" value={get(`${prefix}_end_time`)} onChange={e => set(`${prefix}_end_time`, e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {Object.keys(changed).length > 0 && (
                <button onClick={saveSection} disabled={saving} className="btn-primary mt-5 flex items-center gap-2">
                  <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Timings"}
                </button>
              )}
            </div>
          )}

          {/* Change Password */}
          {active === "Change Password" && (
            <div className="card">
              <h2 className="text-base font-semibold text-brand-textmain mb-1">Change Password</h2>
              <p className="text-sm text-brand-textsec mb-5">Logged in as <span className="font-medium">{user?.name} ({user?.staff_id})</span></p>
              <div className="space-y-4 max-w-xs">
                <div>
                  <label className="label">Current Password</label>
                  <input type="password" className="input-field" value={pw.old} onChange={e => setPw(p => ({ ...p, old: e.target.value }))} autoComplete="current-password" />
                </div>
                <div>
                  <label className="label">New Password</label>
                  <input type="password" className="input-field" value={pw.new1} onChange={e => setPw(p => ({ ...p, new1: e.target.value }))} autoComplete="new-password" />
                  <p className="text-xs text-brand-textsec mt-1">Minimum 6 characters</p>
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input type="password" className="input-field" value={pw.new2} onChange={e => setPw(p => ({ ...p, new2: e.target.value }))} autoComplete="new-password" />
                </div>
                {pwMsg && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${pwMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {pwMsg.ok ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {pwMsg.msg}
                  </div>
                )}
                <button onClick={changePassword} className="btn-primary flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Change Password
                </button>
              </div>
            </div>
          )}

          {/* Backup & Restore */}
          {active === "Backup & Restore" && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <Download className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-brand-textmain">Backup Database</h3>
                    <p className="text-sm text-brand-textsec mt-1">
                      Save a copy of the entire EIAS database (all staff, halls, cycles, allocations, history) to a file. Store it safely on an external drive or network location.
                    </p>
                    <button onClick={backup} className="btn-primary mt-3 flex items-center gap-2">
                      <Download className="w-4 h-4" /> Create Backup?
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <Upload className="w-5 h-5 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-brand-textmain">Restore Database</h3>
                    <p className="text-sm text-brand-textsec mt-1">
                      Replace the current database with a previously backed-up copy. A safety copy of the current database is saved before restoring.
                    </p>
                    <div className="flex items-center gap-2 mt-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                      <p className="text-xs text-amber-700">This will overwrite all current data. Restart the app after restoring.</p>
                    </div>
                    <button onClick={restore} className="mt-3 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                      <Upload className="w-4 h-4" /> Restore from Backup?
                    </button>
                  </div>
                </div>
              </div>

              <div className="card bg-gray-50 border-gray-200">
                <div className="flex items-start gap-3 text-sm text-brand-textsec">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-400" />
                  <p>The database file is stored at <code className="bg-gray-200 px-1 rounded text-xs">%APPDATA%\eias\eias.db</code> on this machine. Back up regularly before major allocation batches.</p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}