import { validateStaff, validateDepartmentCode, validateDepartmentName } from "../../../shared/validation"
import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Plus, Pencil, Trash2, Upload, CheckCircle, XCircle } from "lucide-react"
import ConfirmWithPasswordModal from "../components/ConfirmWithPasswordModal"
import BenchLayoutEditor from "../components/BenchLayoutEditor"
import StudentsTab from "../components/StudentsTab"
import { hallLayout, benchCount, cleanDisabled, MAX_BENCH_ROWS, MAX_BENCH_COLS } from "../../../shared/hall-layout"
import { IS_DESKTOP } from "../lib/platform"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { cn } from "../lib/utils"

const TABS = ["staff", "students", "halls", "departments"]

// Staff IDs are free text (typed or imported), so digit runs compare as numbers
// (STF2 before STF10) and case is ignored.
const staffIdOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

export default function MasterDataPage() {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get("tab") ?? "staff"

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-textmain">Master Data</h1>
        <p className="text-brand-textsec mt-1">Manage staff, students, halls, and departments</p>
      </div>
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setParams({ tab: t })}
            className={cn("px-5 py-2 rounded-md text-sm font-medium transition-colors capitalize",
              activeTab === t ? "bg-white text-brand-textmain shadow-sm" : "text-brand-textsec hover:text-brand-textmain")}>
            {t === "staff" ? "Staff / Invigilators" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {activeTab === "staff" && <StaffTab />}
      {activeTab === "students" && <StudentsTab />}
      {activeTab === "halls" && <HallsTab />}
      {activeTab === "departments" && <DepartmentsTab />}
    </div>
  )
}

// ── STAFF TAB ────────────────────────────────────────────────
function StaffTab() {
  const [users, setUsers] = useState<any[]>([])
  const [depts, setDepts] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [hardDeleteTarget, setHardDeleteTarget] = useState<any>(null)
  const [importResult, setImportResult] = useState<any>(null)

  const load = async () => {
    const staff = await api.getUsers({ role: "staff" })
    setUsers(staff.sort((a, b) => staffIdOrder.compare(a.staff_id, b.staff_id)))
    setDepts(await api.getDepartments())
  }
  useEffect(() => { load() }, [])

  async function importExcel() {
    const path = await api.openFileDialog([{ name: "Excel Files", extensions: ["xlsx", "xls"] }])
    if (!path) return
    const r = await api.importUsersFromExcel(path)
    setImportResult(r)
    if (r.success) load()
  }

  async function save() {
    const problem = validateStaff(form ?? {})
    if (problem) return toast.error(problem)
    setLoading(true)
    try {
      const r = await api.saveUser(form)
      if (r?.success === false) return toast.error(r.error) // e.g. the Staff ID is already used
      toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(id: number) {
    if (!confirm("Deactivate this staff member?")) return
    await api.deleteUser(id); toast.success("Deactivated"); load()
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-brand-textsec">{users.length} staff members</p>
        <div className="flex gap-2">
          <button onClick={importExcel} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" /> Import Excel</button>
          <button onClick={() => setForm({ role: "staff", is_active: true })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Staff</button>
        </div>
      </div>

      {/* Form modal */}
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Staff" : "Add Staff"}</h3>
            <form onSubmit={e => { e.preventDefault(); save() }}>
              <div className="space-y-3">
                <div><label className="label">Staff ID *</label><input autoFocus className="input-field" value={form.staff_id ?? ""} onChange={e => setForm({ ...form, staff_id: e.target.value })} /></div>
                <div><label className="label">Full Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="label">Designation</label><input className="input-field" value={form.designation ?? ""} onChange={e => setForm({ ...form, designation: e.target.value })} /></div>
                <div><label className="label">Email</label><input className="input-field" type="email" value={form.email ?? ""} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div>
                  <label className="label">Department</label>
                  <select className="input-field" value={form.department_id ?? ""} onChange={e => setForm({ ...form, department_id: Number(e.target.value) || null })}>
                    <option value="">— Select —</option>
                    {depts.map((d: any) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                  </select>
                </div>
                {!form.id && !IS_DESKTOP && <div><label className="label">Password</label><input className="input-field" type="password" value={form.password ?? ""} onChange={e => setForm({ ...form, password: e.target.value })} /></div>}
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-primary" /><span className="text-sm">Active</span></label>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button type="button" onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-brand-border">
            <tr>{["Staff ID","Name","Department","Designation","Status",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {users.map((u: any) => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{u.staff_id}</td>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-brand-textsec">{u.department_name ?? "—"}</td>
                <td className="px-4 py-3 text-brand-textsec">{u.designation ?? "—"}</td>
                <td className="px-4 py-3">
                  {u.is_active ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3.5 h-3.5" /> Active</span>
                    : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" /> Inactive</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm(u)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  {u.is_active ? (
                    <button onClick={() => remove(u.id)} title="Deactivate" className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                  ) : (
                    <button
                      onClick={() => setHardDeleteTarget(u)}
                      title="Delete Permanently"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Permanently</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-brand-textsec">No staff members yet. Add or import from Excel.</td></tr>}
          </tbody>
        </table>
      </div>

      <ConfirmWithPasswordModal
        isOpen={!!hardDeleteTarget}
        title="Delete Staff Member Permanently"
        message={`Are you sure you want to permanently delete ${hardDeleteTarget?.name} (${hardDeleteTarget?.staff_id})? This cannot be undone.`}
        confirmButtonText="Delete Permanently"
        onClose={() => setHardDeleteTarget(null)}
        onConfirmed={async () => {
          if (!hardDeleteTarget) return
          const res = await api.hardDeleteUser(hardDeleteTarget.id)
          if (res?.success) {
            toast.success("Staff member deleted permanently")
            load()
          } else {
            toast.error(res?.error || "Cannot permanently delete staff member")
          }
        }}
      />

      {importResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
            <h3 className="text-base font-semibold mb-1">
              {importResult.success ? "Import Complete" : "Import Failed"}
            </h3>

            {!importResult.success ? (
              <div className="text-sm mt-2">
                <p className="text-red-600">{importResult.error}</p>
                {importResult.missingColumns?.length > 0 && (
                  <p className="mt-3 text-xs text-brand-textsec">
                    Your Excel file's first row needs a column for each of: <b>Staff ID</b>, <b>Name</b>, and <b>Department</b>.
                    Missing here: <b>{importResult.missingColumns.join(", ")}</b>.
                  </p>
                )}
              </div>
            ) : (
              <div className="text-sm mt-2 overflow-y-auto">
                <p className="text-green-600 font-medium">
                  {importResult.inserted} staff member{importResult.inserted === 1 ? "" : "s"} imported successfully.
                </p>
                {importResult.issues?.length > 0 && (
                  <>
                    <p className="mt-3 text-brand-textsec">{importResult.issues.length} row(s) skipped — here's why:</p>
                    <div className="mt-2 border rounded-lg divide-y">
                      {importResult.issues.map((iss: any, i: number) => (
                        <div key={i} className="px-3 py-2 text-xs flex items-start justify-between gap-3">
                          <span className="font-medium text-brand-textmain whitespace-nowrap">Row {iss.row}</span>
                          <span className="text-red-500 text-right">{iss.reason}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end mt-5">
              <button onClick={() => setImportResult(null)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── HALLS TAB ────────────────────────────────────────────────
function HallsTab() {
  const [halls, setHalls] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => setHalls(await api.getHalls())
  useEffect(() => { load() }, [])

  // The form keeps the bench layout as numbers and a list of removed bench positions.
  const openForm = (h: any) => {
    const l = hallLayout(h)
    setForm({ ...h, bench_rows: l.rows, bench_cols: l.cols, disabled_benches: l.disabled })
  }
  const formLayout = form ? { rows: Number(form.bench_rows) || 0, cols: Number(form.bench_cols) || 0, disabled: form.disabled_benches ?? [] } : null
  const formBenches = formLayout && formLayout.rows > 0 && formLayout.cols > 0 ? benchCount({ ...formLayout, disabled: cleanDisabled(formLayout) }) : 0
  const setGrid = (key: "bench_rows" | "bench_cols", value: string) => {
    const max = key === "bench_rows" ? MAX_BENCH_ROWS : MAX_BENCH_COLS
    setForm({ ...form, [key]: Math.max(0, Math.min(max, Math.floor(Number(value) || 0))) })
  }

  async function save() {
    if (!form?.hall_code?.trim()) return toast.error("Hall Code is required.")
    setLoading(true)
    try {
      const r = await api.saveHall({ ...form, disabled_benches: formLayout ? cleanDisabled(formLayout) : [] })
      if (r?.success === false) return toast.error(r.error) // e.g. the hall code is already used
      toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(h: any) {
    if (!confirm(`Delete hall ${h.hall_code}?`)) return
    const r = await api.deleteHall(h.id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error)
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-brand-textsec">{halls.length} halls · Listed in the order they were added; the allocation does not depend on this order</p>
        <button onClick={() => setForm({ is_active: true, bench_rows: 0, bench_cols: 0, disabled_benches: [] })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Hall</button>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className={cn("bg-white rounded-2xl shadow-2xl p-6 w-full max-h-[92vh] overflow-y-auto", formBenches > 0 ? "max-w-3xl" : "max-w-md")}>
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Hall" : "Add Hall"}</h3>
            <form onSubmit={e => { e.preventDefault(); save() }}>
              <div className="space-y-3">
                <div><label className="label">Hall Code *</label><input autoFocus className="input-field" value={form.hall_code ?? ""} onChange={e => setForm({ ...form, hall_code: e.target.value })} placeholder="e.g. H001" /></div>
                <div><label className="label">Block / Building</label><input className="input-field" value={form.block ?? ""} onChange={e => setForm({ ...form, block: e.target.value })} placeholder="e.g. Main Block" /></div>
                <div>
                  <label className="label">Floor</label>
                  <input className="input-field" list="hall-floors" value={form.floor ?? ""} onChange={e => setForm({ ...form, floor: e.target.value })} placeholder="e.g. Ground, 1st, 2nd" />
                  <datalist id="hall-floors">
                    {["Ground", "1st", "2nd", "3rd", "4th", "5th"].map(f => <option key={f} value={f} />)}
                  </datalist>
                </div>
                <div className="border-t border-brand-border pt-3">
                  <p className="text-sm font-semibold text-brand-textmain">Bench layout (student seating)</p>
                  <p className="text-xs text-brand-textsec mb-2">Enter the number of columns, and as rows the most benches any column has. Then tap the benches that are not there to remove them. Two students sit on each bench.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">Columns (left to right)</label><input className="input-field" type="number" min={0} max={MAX_BENCH_COLS} step={1} value={form.bench_cols ?? 0} onChange={e => setGrid("bench_cols", e.target.value)} /></div>
                    <div><label className="label">Rows (front to back)</label><input className="input-field" type="number" min={0} max={MAX_BENCH_ROWS} step={1} value={form.bench_rows ?? 0} onChange={e => setGrid("bench_rows", e.target.value)} /></div>
                  </div>
                  {formLayout && formLayout.rows > 0 && formLayout.cols > 0 && (
                    <div className="mt-3">
                      <BenchLayoutEditor rows={formLayout.rows} cols={formLayout.cols} disabled={formLayout.disabled}
                        onChange={d => setForm({ ...form, disabled_benches: d })} />
                      <p className="text-xs text-brand-textsec mt-2 text-center">
                        <b className="text-brand-textmain">{formBenches}</b> benches · <b className="text-brand-textmain">{formBenches * 2}</b> seats
                        {formLayout.rows * formLayout.cols - formBenches > 0 && <> · {formLayout.rows * formLayout.cols - formBenches} removed</>}
                      </p>
                    </div>
                  )}
                </div>
                {formBenches > 0
                  ? <div><label className="label">Capacity</label><p className="text-sm text-brand-textsec">{formBenches * 2} seats (two per bench)</p></div>
                  : <div><label className="label">Capacity</label><input className="input-field" type="number" min={0} step={1} value={form.capacity ?? 0} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} /></div>}
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-primary" /><span className="text-sm">Active</span></label>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button type="button" onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-brand-border">
            <tr>{["Order","Hall Code","Block","Floor","Benches","Capacity","Status",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {halls.map((h: any, i: number) => (
              <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-brand-textsec text-xs">#{i + 1}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-brand-primary">{h.hall_code}</td>
                <td className="px-4 py-3 text-brand-textsec">{h.block || "—"}</td>
                <td className="px-4 py-3 font-medium">{h.floor || "—"}</td>
                <td className="px-4 py-3 text-brand-textsec text-xs whitespace-nowrap"><BenchSummary hall={h} /></td>
                <td className="px-4 py-3 text-brand-textsec">{h.capacity}</td>
                <td className="px-4 py-3">
                  {h.is_active ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3.5 h-3.5" /> Active</span>
                    : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" /> Inactive</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openForm(h)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(h)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {halls.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-brand-textsec">No halls added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BenchSummary({ hall }: { hall: any }) {
  const l = hallLayout(hall)
  if (!l.rows) return <span className="text-amber-600">Not set</span>
  return <>{benchCount(l)} <span className="text-gray-400">({l.cols} col × {l.rows} rows{l.disabled.length ? `, ${l.disabled.length} removed` : ""})</span></>
}

// ── DEPARTMENTS TAB ──────────────────────────────────────────
function DepartmentsTab() {
  const [depts, setDepts] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => setDepts(await api.getDepartments())
  useEffect(() => { load() }, [])

  async function save() {
    if (!form?.code?.trim() || !form?.name?.trim()) return toast.error("Code and Name are required.")
    const problem = validateDepartmentCode(form.code) ?? validateDepartmentName(form.name)
    if (problem) return toast.error(problem)
    setLoading(true)
    try {
      const r = await api.saveDepartment(form)
      if (r?.success === false) return toast.error(r.error)
      toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(d: any) {
    if (!confirm(`Delete department ${d.code}?`)) return
    const r = await api.deleteDepartment(d.id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error)
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-brand-textsec">{depts.length} departments</p>
        <button onClick={() => setForm({ is_active: true })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Department</button>
      </div>
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Department" : "Add Department"}</h3>
            <form onSubmit={e => { e.preventDefault(); save() }}>
              <div className="space-y-3">
                <div><label className="label">Code *</label><input autoFocus className="input-field" value={form.code ?? ""} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. CSE" /></div>
                <div><label className="label">Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Computer Science & Engineering" /></div>
              </div>
              <div className="flex gap-2 mt-5 justify-end">
                <button type="button" onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-brand-border">
            <tr>{["Code","Department Name",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {depts.map((d: any) => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono font-bold text-brand-primary text-xs">{d.code}</td>
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm(d)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(d)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {depts.length === 0 && <tr><td colSpan={3} className="px-4 py-12 text-center text-brand-textsec">No departments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
