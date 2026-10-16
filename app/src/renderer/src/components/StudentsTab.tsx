import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Pencil, Trash2, Upload, Download, CheckCircle, XCircle, Search } from "lucide-react"
import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { matchesSearch } from "../lib/search"
import { validateStudent } from "../../../shared/validation"
import { STUDENT_IMPORT_COLUMNS } from "../../../shared/students"

const GENDER_LABEL: Record<string, string> = { M: "Male", F: "Female" }

/**
 * Master Data → Students: roll number, register number, name, gender, department, section (A, B,
 * ...) and batch (2023-2027); CSE + section A + 2023-2027 is one class. Students are seated for each exam session in the Allocation Workspace.
 */
export default function StudentsTab() {
  const [students, setStudents] = useState<any[]>([])
  const [depts, setDepts] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [query, setQuery] = useState("")
  const [batch, setBatch] = useState("")
  const [deptId, setDeptId] = useState("")
  const [section, setSection] = useState("")
  const [gender, setGender] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)

  const load = async () => {
    setStudents(await api.getStudents())
    setDepts(await api.getDepartments())
  }
  useEffect(() => { load() }, [])

  const batches = useMemo(() => [...new Set(students.map(s => s.batch))].sort(), [students])
  const sections = useMemo(() => [...new Set(students.map(s => s.section).filter(Boolean))].sort(), [students])
  const shown = useMemo(() => students.filter(s =>
    (!batch || s.batch === batch) && (!deptId || s.department_id === Number(deptId)) && (!section || s.section === section) &&
    (!gender || s.gender === gender) && matchesSearch(query, s.roll_no, s.register_no, s.name)
  ), [students, batch, deptId, section, gender, query])
  const summary = useMemo(() => batches.map(b => {
    const inBatch = students.filter(s => s.batch === b && s.is_active)
    return { batch: b, boys: inBatch.filter(s => s.gender === "M").length, girls: inBatch.filter(s => s.gender === "F").length }
  }), [students, batches])

  async function save() {
    const problem = validateStudent(form ?? {})
    if (problem) return toast.error(problem)
    if (!form.department_id) return toast.error("Department is required.")
    setLoading(true)
    try {
      const r = await api.saveStudent(form)
      if (!r?.success) return toast.error(r?.error ?? "Could not save the student.")
      toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(s: any) {
    if (!confirm(`Delete student ${s.roll_no} – ${s.name}?`)) return
    const r = await api.deleteStudent(s.id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error ?? "Could not delete.")
  }

  async function handleFile(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })
      const r = await api.importStudents(rows)
      setImportResult(r)
      if (r.success) load()
    } catch (e: any) {
      toast.error(`Could not read the file: ${e?.message ?? e}`)
    } finally {
      if (fileInput.current) fileInput.current.value = "" // allow re-uploading the same file
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([STUDENT_IMPORT_COLUMNS, ["23CS001", "961223104001", "Anu S", "Female", depts[0]?.code ?? "CSE", "A", "2023-2027"]])
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 26 }, { wch: 9 }, { wch: 12 }, { wch: 9 }, { wch: 11 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Students")
    XLSX.writeFile(wb, "HIAS-Student-Import-Template.xlsx")
  }

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-brand-textsec">{students.length} students{shown.length !== students.length && ` · ${shown.length} shown`}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" /> Template</button>
          <button onClick={() => fileInput.current?.click()} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" /> Import Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button onClick={() => setForm({ gender: "M", is_active: true, section: section || "", batch: batch || "" })} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Student</button>
        </div>
      </div>

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {summary.map(b => (
            <button key={b.batch} onClick={() => setBatch(batch === b.batch ? "" : b.batch)}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${batch === b.batch ? "bg-brand-primary text-white border-brand-primary" : "bg-white border-brand-border hover:border-brand-primary"}`}>
              <b>{b.batch}</b> · {b.boys} boys · {b.girls} girls
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input className="input-field pl-9" placeholder="Search roll no, register no or name" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <select className="input-field w-auto" value={batch} onChange={e => setBatch(e.target.value)}>
          <option value="">All batches</option>
          {batches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="input-field w-auto" value={deptId} onChange={e => setDeptId(e.target.value)}>
          <option value="">All departments</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
        </select>
        <select className="input-field w-auto" value={section} onChange={e => setSection(e.target.value)}>
          <option value="">All sections</option>
          {sections.map(s => <option key={s} value={s}>Section {s}</option>)}
        </select>
        <select className="input-field w-auto" value={gender} onChange={e => setGender(e.target.value)}>
          <option value="">Boys and girls</option>
          <option value="M">Boys</option>
          <option value="F">Girls</option>
        </select>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Student" : "Add Student"}</h3>
            <form onSubmit={e => { e.preventDefault(); save() }}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Roll Number *</label><input autoFocus className="input-field" value={form.roll_no ?? ""} onChange={e => setForm({ ...form, roll_no: e.target.value })} placeholder="e.g. 23CS001" /></div>
                  <div><label className="label">Register Number *</label><input className="input-field" value={form.register_no ?? ""} onChange={e => setForm({ ...form, register_no: e.target.value })} placeholder="e.g. 961223104001" /></div>
                </div>
                <div><label className="label">Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div>
                  <label className="label">Gender *</label>
                  <div className="flex gap-4">
                    {(["M", "F"] as const).map(g => (
                      <label key={g} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input type="radio" name="gender" checked={form.gender === g} onChange={() => setForm({ ...form, gender: g })} className="accent-brand-primary" />
                        {GENDER_LABEL[g]}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Department *</label>
                    <select className="input-field" value={form.department_id ?? ""} onChange={e => setForm({ ...form, department_id: Number(e.target.value) || null })}>
                      <option value="">— Select —</option>
                      {depts.map((d: any) => <option key={d.id} value={d.id}>{d.code}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Section *</label>
                    <input className="input-field" list="student-sections" value={form.section ?? ""} onChange={e => setForm({ ...form, section: e.target.value.toUpperCase() })} placeholder="e.g. A" maxLength={10} />
                    <datalist id="student-sections">{sections.map(s => <option key={s} value={s} />)}</datalist>
                  </div>
                  <div>
                    <label className="label">Batch *</label>
                    <input className="input-field" list="student-batches" value={form.batch ?? ""} onChange={e => setForm({ ...form, batch: e.target.value })} placeholder="e.g. 2023-2027" />
                    <datalist id="student-batches">{batches.map(b => <option key={b} value={b} />)}</datalist>
                  </div>
                </div>
                {form.id && <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={!!form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="accent-brand-primary" /><span className="text-sm">Active</span></label>}
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
            <tr>{["Roll No", "Register No", "Name", "Gender", "Department", "Section", "Batch", "Status", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {shown.map((s: any) => (
              <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs font-semibold">{s.roll_no}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.register_no}</td>
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.gender === "F" ? "bg-pink-50 text-pink-700" : "bg-sky-50 text-sky-700"}`}>{GENDER_LABEL[s.gender]}</span>
                </td>
                <td className="px-4 py-3 text-brand-textsec">{s.department_code ?? "—"}</td>
                <td className="px-4 py-3 text-brand-textsec">{s.section || "—"}</td>
                <td className="px-4 py-3 text-brand-textsec whitespace-nowrap">{s.batch}</td>
                <td className="px-4 py-3">
                  {s.is_active ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3.5 h-3.5" /> Active</span>
                    : <span className="flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" /> Inactive</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm({ ...s, is_active: !!s.is_active })} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(s)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-brand-textsec">
              {students.length ? "No students match these filters." : "No students yet. Add them one by one or import an Excel sheet (download the template first)."}
            </td></tr>}
          </tbody>
        </table>
      </div>

      {importResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
            <h3 className="text-base font-semibold mb-1">{importResult.success ? "Import Complete" : "Import Failed"}</h3>
            {!importResult.success ? (
              <p className="text-sm text-red-600 mt-2">{importResult.error}</p>
            ) : (
              <div className="text-sm mt-2 overflow-y-auto">
                <p className="text-green-600 font-medium">{importResult.inserted} student{importResult.inserted === 1 ? "" : "s"} imported successfully.</p>
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
