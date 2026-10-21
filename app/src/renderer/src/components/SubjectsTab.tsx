import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Pencil, Trash2, Upload, Download, Search, X, Users } from "lucide-react"
import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { matchesSearch } from "../lib/search"
import { validateSubject, SUBJECT_IMPORT_COLUMNS, STUDENT_SUBJECT_IMPORT_COLUMNS } from "../../../shared/subjects"
import SubjectStudentsModal from "./SubjectStudentsModal"

/**
 * Master Data → Subjects: each subject's code, name and department, and the staff who handle it.
 * In each exam session the subject every class writes is entered on the seating configuration
 * screen; students writing the same subject never share a bench or sit side by side, and an
 * invigilator is kept out of a hall writing a subject they handle whenever the rotation allows.
 */
export default function SubjectsTab() {
  const [subjects, setSubjects] = useState<any[]>([])
  const [depts, setDepts] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [form, setForm] = useState<any>(null)
  const [staffQuery, setStaffQuery] = useState("")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mapInput = useRef<HTMLInputElement>(null)
  /** The subject whose students are being mapped. */
  const [mapping, setMapping] = useState<any>(null)

  const load = async () => {
    const [s, d, u] = await Promise.all([api.getSubjects(), api.getDepartments(), api.getUsers({ role: "staff" })])
    setSubjects(s); setDepts(d); setStaff(u.filter((x: any) => x.is_active))
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => subjects.filter(s => matchesSearch(query, s.code, s.name, ...s.staff.map((u: any) => u.name))), [subjects, query])
  const staffShown = useMemo(() => staff.filter(u => matchesSearch(staffQuery, u.name, u.staff_id)), [staff, staffQuery])

  function edit(s?: any) {
    setStaffQuery("")
    setForm(s ? { id: s.id, code: s.code, name: s.name, department_id: s.department_id, is_active: !!s.is_active, staff_ids: s.staff.map((u: any) => u.id) } : { is_active: true, staff_ids: [] })
  }

  async function save() {
    const problem = validateSubject(form ?? {})
    if (problem) return toast.error(problem)
    setLoading(true)
    try {
      const r = await api.saveSubject(form)
      if (!r?.success) return toast.error(r?.error ?? "Could not save the subject.")
      toast.success("Saved!"); setForm(null); load()
    } finally { setLoading(false) }
  }

  async function remove(s: any) {
    if (!confirm(`Delete subject ${s.code} – ${s.name}?`)) return
    const r = await api.deleteSubject(s.id)
    if (r.success) { toast.success("Deleted"); load() } else toast.error(r.error ?? "Could not delete.")
  }

  /** Imports a sheet: the subject list, or (`students`) which students study which subjects. */
  async function handleFile(file: File, students = false) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })
      const r = students ? await api.importStudentSubjects(rows) : await api.importSubjects(rows)
      setImportResult({ ...r, students })
      if (r.success) load()
    } catch (e: any) {
      toast.error(`Could not read the file: ${e?.message ?? e}`)
    } finally {
      if (fileInput.current) fileInput.current.value = ""
      if (mapInput.current) mapInput.current.value = ""
    }
  }

  function downloadMappingTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([["Roll No", "Subject Codes"], ["23CS001", subjects.slice(0, 3).map(s => s.code).join("; ") || "CS3401; CS3402"]])
    ws["!cols"] = [{ wch: 14 }, { wch: 40 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Student Subjects")
    XLSX.writeFile(wb, "HIAS-Student-Subjects-Template.xlsx")
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([["Subject Code", "Subject Name", "Department", "Staff IDs"], ["CS3401", "Compiler Design", depts[0]?.code ?? "CSE", staff.slice(0, 2).map(u => u.staff_id).join("; ")]])
    ws["!cols"] = [{ wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 24 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Subjects")
    XLSX.writeFile(wb, "HIAS-Subject-Import-Template.xlsx")
  }

  const toggleStaff = (id: number) => setForm((f: any) => ({ ...f, staff_ids: f.staff_ids.includes(id) ? f.staff_ids.filter((x: number) => x !== id) : [...f.staff_ids, id] }))

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-brand-textsec">{subjects.length} subjects · enter the subject each class writes in the seating configuration of every exam session</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2"><Download className="w-4 h-4" /> Template</button>
          <button onClick={() => fileInput.current?.click()} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" /> Import Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button onClick={() => edit()} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> Add Subject</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-brand-textsec">
        <span>Students studying each subject: use <Users className="w-3.5 h-3.5 inline" /> on a row, or import a sheet ({STUDENT_SUBJECT_IMPORT_COLUMNS.join(", ")}).</span>
        <button onClick={downloadMappingTemplate} className="btn-secondary text-xs flex items-center gap-1.5 py-1"><Download className="w-3.5 h-3.5" /> Mapping template</button>
        <button onClick={() => mapInput.current?.click()} disabled={subjects.length === 0} className="btn-secondary text-xs flex items-center gap-1.5 py-1"><Upload className="w-3.5 h-3.5" /> Import student mapping</button>
        <input ref={mapInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0], true)} />
      </div>

      <div className="relative max-w-sm mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input-field pl-9" placeholder="Search code, name or staff" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] flex flex-col">
            <h3 className="text-base font-semibold mb-4">{form.id ? "Edit Subject" : "Add Subject"}</h3>
            <form onSubmit={e => { e.preventDefault(); save() }} className="flex flex-col min-h-0">
              <div className="space-y-3 overflow-y-auto">
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="label">Code *</label><input autoFocus className="input-field" value={form.code ?? ""} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. CS3401" /></div>
                  <div className="col-span-2"><label className="label">Name *</label><input className="input-field" value={form.name ?? ""} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Compiler Design" /></div>
                </div>
                <div>
                  <label className="label">Department</label>
                  <select className="input-field" value={form.department_id ?? ""} onChange={e => setForm({ ...form, department_id: Number(e.target.value) || null })}>
                    <option value="">— Common to all —</option>
                    {depts.map((d: any) => <option key={d.id} value={d.id}>{d.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Staff who handle this subject ({form.staff_ids.length})</label>
                  <p className="text-[11px] text-brand-textsec mb-1.5">They are not given invigilation in a hall writing this subject, unless the rotation leaves no other choice.</p>
                  {form.staff_ids.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {form.staff_ids.map((id: number) => {
                        const u = staff.find(x => x.id === id)
                        return <span key={id} className="flex items-center gap-1 text-xs bg-brand-primary/10 text-brand-primary rounded px-2 py-0.5">
                          {u ? `${u.name} (${u.staff_id})` : `#${id}`}
                          <button type="button" onClick={() => toggleStaff(id)} title="Remove"><X className="w-3 h-3" /></button>
                        </span>
                      })}
                    </div>
                  )}
                  <input className="input-field mb-1.5" placeholder="Search staff by name or Staff ID" value={staffQuery} onChange={e => setStaffQuery(e.target.value)} />
                  <div className="border border-brand-border rounded-lg max-h-48 overflow-y-auto divide-y divide-brand-border">
                    {staffShown.map(u => (
                      <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={form.staff_ids.includes(u.id)} onChange={() => toggleStaff(u.id)} className="accent-brand-primary" />
                        <span className="font-mono text-xs text-brand-textsec w-20 shrink-0">{u.staff_id}</span>
                        <span className="truncate">{u.name}</span>
                        <span className="ml-auto text-xs text-brand-textsec">{u.department_code ?? ""}</span>
                      </label>
                    ))}
                    {staffShown.length === 0 && <p className="px-3 py-4 text-xs text-center text-brand-textsec">No staff match.</p>}
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
            <tr>{["Code", "Subject Name", "Department", "Handled by", "Students", ""].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {shown.map((s: any) => (
              <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${s.is_active ? "" : "opacity-50"}`}>
                <td className="px-4 py-3 font-mono font-bold text-brand-primary text-xs whitespace-nowrap">{s.code}</td>
                <td className="px-4 py-3 font-medium">{s.name}{!s.is_active && <span className="ml-2 text-xs text-red-500">Inactive</span>}</td>
                <td className="px-4 py-3 text-brand-textsec">{s.department_code ?? "All"}</td>
                <td className="px-4 py-3 text-xs">{s.staff.length ? s.staff.map((u: any) => u.name).join(", ") : <span className="text-brand-textsec">—</span>}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setMapping(s)} title="Map the students who study this subject" className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-brand-border hover:border-brand-primary hover:text-brand-primary">
                    <Users className="w-3.5 h-3.5" /> {s.student_ids.length}
                  </button>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => edit(s)} title="Edit" className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec mr-1"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => remove(s)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-400"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-brand-textsec">
              {subjects.length ? "No subjects match." : `No subjects yet. Add them one by one or import an Excel sheet with the columns ${SUBJECT_IMPORT_COLUMNS.join(", ")}.`}
            </td></tr>}
          </tbody>
        </table>
      </div>

      {mapping && <SubjectStudentsModal subject={mapping} onClose={() => setMapping(null)} onSaved={() => { setMapping(null); load() }} />}

      {importResult && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col">
            <h3 className="text-base font-semibold mb-1">{importResult.success ? "Import Complete" : "Import Failed"}</h3>
            {!importResult.success ? (
              <p className="text-sm text-red-600 mt-2">{importResult.error}</p>
            ) : (
              <div className="text-sm mt-2 overflow-y-auto">
                <p className="text-green-600 font-medium">{importResult.students
                  ? `${importResult.inserted} student–subject link(s) added.`
                  : `${importResult.inserted} subject${importResult.inserted === 1 ? "" : "s"} saved.`}</p>
                {importResult.issues?.length > 0 && (
                  <div className="mt-3 border rounded-lg divide-y">
                    {importResult.issues.map((iss: any, i: number) => (
                      <div key={i} className="px-3 py-2 text-xs flex items-start justify-between gap-3">
                        <span className="font-medium text-brand-textmain whitespace-nowrap">Row {iss.row}</span>
                        <span className="text-red-500 text-right">{iss.reason}</span>
                      </div>
                    ))}
                  </div>
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
