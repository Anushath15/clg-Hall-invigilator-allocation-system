import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Plus, Pencil, Trash2, Upload, Download, CheckCircle, XCircle } from "lucide-react"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import { cn } from "../lib/utils"

const TABS = ["staff", "halls", "departments"]

export default function MasterDataPage() {
  const [params, setParams] = useSearchParams()
  const activeTab = params.get("tab") ?? "staff"

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-textmain">Master Data</h1>
        <p className="text-brand-textsec mt-1">Manage staff, halls, and departments</p>
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
      {activeTab === "halls" && <HallsTab />}
      {activeTab === "departments" && <DepartmentsTab />}
    </div>
  )
}

// -- STAFF TAB ------------------------------------------------
function StaffTab() {
  const [users, setUsers] = useState<any[]>([])
  const [depts, setDepts] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => { setUsers(await api.getUsers({ role: "staff" })); setDepts(await api.getDepartments()) }
  useEffect(() => { load() }, [])

  async function importExcel() {
    const path = await api.openFileDialog([{ name: "Excel Files", extensions: ["xlsx", "xls"] }])
    if (!path) return
    const r = await api.importUsersFromExcel(path)
    if (r.success) { toast.success(`Imported ${r.inserted} staff, skipped ${r.skipped}`); load() }
    else toast.error(r.error)
  }

  async function save() {
    if (!form?.name || !form?.staff_id) return toast.error("Name and Staff ID are required.")
    setLoading(true)
    try {
      await api.saveUser(form); toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(id: number) {
    if (!confirm("Deactivate this staff member?")) return
    await api.deleteUser(id); toast.success("Deactivated"); load()
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
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
            <div className="space-y-3">
              <div><label className="label">Staff ID *</label><input className="input-field" value={form.staff_id ?? ""} onChange={e => setForm({ ...form, staff_id: e.target.value })} /></div>
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
              {!form.id && <div><label className="label">Password</label><input className="input-field" type="password" value={form.password ?? ""} onChange={e => setForm({ ...form, password: e.target.value })} /></div>}
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-primary" /><span className="text-sm">Active</span></label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
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
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setForm(u)} className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(u.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-brand-textsec">No staff members yet. Add or import from Excel.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -- HALLS TAB ------------------------------------------------
function HallsTab() {
  const [halls, setHalls] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => setHalls(await api.getHalls())
  useEffect(() => { load() }, [])

  async function save() {
    if (!form?.hall_code || !form?.name) return toast.error("Hall Code and Name are required.")
    setLoading(true)
    try { await api.saveHall(form); toast.success("Saved!"); setForm(null); load() } finally { setLoading(false) }
  }

  async function remove(id: number) {
    const r = await api.deleteHall(id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-brand-textsec">{halls.length} halls · Ordered by rotation sequence (top = first in rotation)</p>
        <button onClick={() => setForm({ is_active: true })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Hall</button>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Hall" : "Add Hall"}</h3>
            <div className="space-y-3">
              <div><label className="label">Hall Code *</label><input className="input-field" value={form.hall_code ?? ""} onChange={e => setForm({ ...form, hall_code: e.target.value })} placeholder="e.g. H001" /></div>
              <div><label className="label">Hall Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. New Block Room 1" /></div>
              <div><label className="label">Capacity</label><input className="input-field" type="number" value={form.capacity ?? 0} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
              <div><label className="label">Block / Building</label><input className="input-field" value={form.block ?? ""} onChange={e => setForm({ ...form, block: e.target.value })} /></div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-primary" /><span className="text-sm">Active</span></label>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-brand-border">
            <tr>{["Order","Hall Code","Name","Block","Capacity","Status",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {halls.map((h: any, i: number) => (
              <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-brand-textsec text-xs">#{i + 1}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-brand-primary">{h.hall_code}</td>
                <td className="px-4 py-3 font-medium">{h.name}</td>
                <td className="px-4 py-3 text-brand-textsec">{h.block ?? "—"}</td>
                <td className="px-4 py-3 text-brand-textsec">{h.capacity}</td>
                <td className="px-4 py-3">
                  {h.is_active ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3.5 h-3.5" /> Active</span>
                    : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" /> Inactive</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setForm(h)} className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(h.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {halls.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-brand-textsec">No halls added yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -- DEPARTMENTS TAB ------------------------------------------
function DepartmentsTab() {
  const [depts, setDepts] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => setDepts(await api.getDepartments())
  useEffect(() => { load() }, [])

  async function save() {
    if (!form?.code || !form?.name) return toast.error("Code and Name are required.")
    setLoading(true)
    try { await api.saveDepartment(form); toast.success("Saved!"); setForm(null); load() } finally { setLoading(false) }
  }

  async function remove(id: number) {
    const r = await api.deleteDepartment(id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-brand-textsec">{depts.length} departments</p>
        <button onClick={() => setForm({ is_active: true })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Department</button>
      </div>
      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Department" : "Add Department"}</h3>
            <div className="space-y-3">
              <div><label className="label">Code *</label><input className="input-field" value={form.code ?? ""} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CSE" /></div>
              <div><label className="label">Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Computer Science & Engineering" /></div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setForm(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={loading} className="btn-primary">{loading ? "Saving..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-brand-border">
            <tr>{["Code","Department Name",""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {depts.map((d: any) => (
              <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono font-bold text-brand-primary text-xs">{d.code}</td>
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setForm(d)} className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(d.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
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
