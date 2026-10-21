import { useEffect, useMemo, useState } from "react"
import { X, Search, ChevronRight, ChevronDown, RefreshCw } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { matchesSearch } from "../lib/search"
import { cn } from "../lib/utils"

interface Props {
  subject: { id: number; code: string; name: string; department_id: number | null; student_ids: number[] }
  onClose: () => void
  onSaved: () => void
}

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * The students who study one subject: tick whole classes (department + section + batch) or single
 * students. In an exam session these students are seated by this subject when it is written.
 */
export default function SubjectStudentsModal({ subject, onClose, onSaved }: Props) {
  const [students, setStudents] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set(subject.student_ids))
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [onlyDept, setOnlyDept] = useState(!!subject.department_id)
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getStudents({ is_active: true }).then(setStudents) }, [])

  // Classes: batch → department → section, each sorted by roll number. Students already mapped are always shown.
  const groups = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const s of students) {
      if (onlyDept && subject.department_id && s.department_id !== subject.department_id && !subject.student_ids.includes(s.id)) continue
      if (!matchesSearch(query, s.roll_no, s.register_no, s.name)) continue
      const k = `${s.batch}|${s.department_code ?? "—"}|${s.section ?? ""}`
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, list]) => {
      const [batch, dept, section] = key.split("|")
      return { key, batch, dept, section, list: list.sort((a, b) => rollOrder.compare(a.roll_no, b.roll_no)) }
    })
  }, [students, query, onlyDept, subject.department_id])

  const setMany = (ids: number[], on: boolean) => setSelected(p => {
    const n = new Set(p)
    for (const id of ids) on ? n.add(id) : n.delete(id)
    return n
  })
  const allOn = (ids: number[]) => ids.length > 0 && ids.every(id => selected.has(id))
  const toggleOpen = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  async function save() {
    setSaving(true)
    try {
      const r = await api.setSubjectStudents(subject.id, [...selected])
      if (!r.success) return toast.error(r.error ?? "Could not save.")
      toast.success(`${selected.size} student(s) mapped to ${subject.code}.`)
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <div>
            <h3 className="text-base font-semibold">Students studying {subject.code}</h3>
            <p className="text-xs text-brand-textsec">{subject.name} · tick whole classes or single students</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-3 border-b border-brand-border flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-9" placeholder="Search roll no, register no or name" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          {subject.department_id && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={onlyDept} onChange={e => setOnlyDept(e.target.checked)} className="accent-brand-primary" />
              Only this subject's department
            </label>
          )}
          {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-xs text-red-600 hover:underline">Clear all</button>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-1.5">
          {students.length === 0 && <p className="text-sm text-brand-textsec text-center py-10">No active students. Add them in Master Data → Students.</p>}
          {groups.map(g => {
            const ids = g.list.map(s => s.id)
            const isOpen = open.has(g.key) || !!query.trim()
            const count = ids.filter(id => selected.has(id)).length
            return (
              <div key={g.key} className="border border-brand-border rounded-lg">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button onClick={() => toggleOpen(g.key)} className="text-brand-textsec">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                  <input type="checkbox" checked={allOn(ids)} ref={el => { if (el) el.indeterminate = count > 0 && count < ids.length }}
                    onChange={e => setMany(ids, e.target.checked)} className="accent-brand-primary" />
                  <button onClick={() => toggleOpen(g.key)} className="flex-1 text-left text-sm">
                    <b>{g.dept}{g.section && ` ${g.section}`}</b> <span className="text-brand-textsec">({g.batch})</span>
                    <span className="text-xs text-brand-textsec ml-2">{count}/{ids.length} mapped</span>
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-brand-border grid grid-cols-1 sm:grid-cols-2 gap-x-4 px-3 py-2">
                    {g.list.map(s => (
                      <label key={s.id} className="flex items-center gap-2 py-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={selected.has(s.id)} onChange={e => setMany([s.id], e.target.checked)} className="accent-brand-primary" />
                        <span className="font-mono font-semibold">{s.roll_no}</span>
                        <span className="truncate">{s.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-brand-border flex items-center justify-between gap-3">
          <span className="text-sm"><b>{selected.size}</b> student(s) study {subject.code}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className={cn("btn-primary flex items-center gap-2")}>{saving && <RefreshCw className="w-4 h-4 animate-spin" />} Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
