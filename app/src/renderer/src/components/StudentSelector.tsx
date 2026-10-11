import { useEffect, useMemo, useRef, useState } from "react"
import { X, Search, Upload, Copy, ChevronRight, ChevronDown, AlertTriangle } from "lucide-react"
import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { matchesSearch } from "../lib/search"
import { readStudentList } from "../lib/student-list"
import { formatDateWithDay, cn } from "../lib/utils"
import { yearOfStudy } from "../../../shared/categories"

interface Props {
  session: { id: number; exam_date: string; session_type: string }
  /** The exam cycle's academic year, to show each batch's year of study ("Final Year"). */
  academicYear?: string
  /** Seats in the session's halls (two per bench), for the "will they fit" hint. */
  seats: number
  initialIds: number[]
  onConfirm: (studentIds: number[]) => void
  onClose: () => void
}

const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

/**
 * "Select Students" for one session: tick whole batches or departments, single students (search by
 * roll number, register number or name), upload an Excel/CSV list of register or roll numbers, or
 * copy the students of another session's seating.
 */
export default function StudentSelector({ session, academicYear, seats, initialIds, onConfirm, onClose }: Props) {
  const yearText = (batch: string) => { const y = yearOfStudy(batch, academicYear); return y.ok ? y.label : "not studying this year" }
  const [students, setStudents] = useState<any[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set(initialIds))
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [sources, setSources] = useState<any[]>([])
  const [uploadNote, setUploadNote] = useState<string[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getStudents({ is_active: true }).then(setStudents)
    api.getSeatingSelections().then(s => setSources(s.filter((x: any) => x.id !== session.id))).catch(() => setSources([]))
  }, [session.id])

  // Groups: batch → department, each sorted by roll number.
  const groups = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const s of students) {
      if (!matchesSearch(query, s.roll_no, s.register_no, s.name)) continue
      const k = `${s.batch}|${s.department_code ?? "—"}`
      m.set(k, [...(m.get(k) ?? []), s])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({ key, batch: key.split("|")[0], dept: key.split("|")[1], list: list.sort((a, b) => rollOrder.compare(a.roll_no, b.roll_no)) }))
  }, [students, query])
  const batches = useMemo(() => [...new Set(students.map(s => s.batch))].sort(), [students])

  const setMany = (ids: number[], on: boolean) => setSelected(p => {
    const n = new Set(p)
    for (const id of ids) on ? n.add(id) : n.delete(id)
    return n
  })
  const allOn = (ids: number[]) => ids.length > 0 && ids.every(id => selected.has(id))
  const toggleOpen = (k: string) => setOpen(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const chosen = students.filter(s => selected.has(s.id))
  const boys = chosen.filter(s => s.gender === "M").length, girls = chosen.length - boys

  async function handleFile(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: false })
      const r = readStudentList(rows, students)
      if (r.studentIds.length === 0) toast.error("No students in this file match the active student list.")
      else { setSelected(new Set(r.studentIds)); toast.success(`${r.studentIds.length} student(s) selected from the file.`) }
      setUploadNote([...r.notFound.map(v => `${v}: not found among active students`), ...r.duplicates.map(v => `${v}: listed more than once`)])
    } catch (e: any) {
      toast.error(`Could not read the file: ${e?.message ?? e}`)
    } finally {
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function copyFrom(id: number) {
    const rows = await api.getSessionSeating(id)
    const active = new Set(students.map(s => s.id))
    const ids = rows.map((r: any) => r.studentId).filter((x: number) => active.has(x))
    setSelected(new Set(ids)); setUploadNote(null)
    toast.success(`${ids.length} student(s) copied${ids.length < rows.length ? ` (${rows.length - ids.length} no longer active)` : ""}.`)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <div>
            <h3 className="text-base font-semibold">Select Students</h3>
            <p className="text-xs text-brand-textsec">{formatDateWithDay(session.exam_date)} · {session.session_type}</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-3 border-b border-brand-border space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input-field pl-9" placeholder="Search roll no, register no or name" value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <button onClick={() => fileInput.current?.click()} className="btn-secondary flex items-center gap-2 text-sm"><Upload className="w-4 h-4" /> Upload list</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {sources.length > 0 && (
              <div className="relative">
                <Copy className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <select className="input-field pl-9 w-auto text-sm" value="" onChange={e => e.target.value && copyFrom(Number(e.target.value))}>
                  <option value="">Copy from session…</option>
                  {sources.map(s => <option key={s.id} value={s.id}>{formatDateWithDay(s.exam_date)} · {s.session_type} ({s.studentCount}) — {s.cycleName}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-brand-textsec">Whole batch:</span>
            {batches.map(b => {
              const ids = students.filter(s => s.batch === b).map(s => s.id)
              return (
                <button key={b} onClick={() => setMany(ids, !allOn(ids))}
                  className={cn("px-2.5 py-1 rounded-md border text-xs", allOn(ids) ? "bg-brand-primary text-white border-brand-primary" : "bg-white border-brand-border hover:border-brand-primary")}>
                  {b} · {yearText(b)} ({ids.length})
                </button>
              )
            })}
            {selected.size > 0 && <button onClick={() => setSelected(new Set())} className="text-xs text-red-600 hover:underline ml-auto">Clear selection</button>}
          </div>
          {uploadNote && uploadNote.length > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 max-h-20 overflow-y-auto">
              {uploadNote.map((n, i) => <p key={i}>• {n}</p>)}
            </div>
          )}
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
                    <b>{g.dept} – {yearText(g.batch)}</b> <span className="text-brand-textsec">({g.batch})</span>
                    <span className="text-xs text-brand-textsec ml-2">{count}/{ids.length} selected · {g.list.filter(s => s.gender === "M").length} boys · {g.list.filter(s => s.gender === "F").length} girls</span>
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-brand-border grid grid-cols-1 sm:grid-cols-2 gap-x-4 px-3 py-2">
                    {g.list.map(s => (
                      <label key={s.id} className="flex items-center gap-2 py-1 text-xs cursor-pointer">
                        <input type="checkbox" checked={selected.has(s.id)} onChange={e => setMany([s.id], e.target.checked)} className="accent-brand-primary" />
                        <span className="font-mono font-semibold">{s.roll_no}</span>
                        <span className="truncate">{s.name}</span>
                        <span className={cn("ml-auto text-[10px] px-1.5 rounded", s.gender === "F" ? "bg-pink-50 text-pink-700" : "bg-sky-50 text-sky-700")}>{s.gender === "F" ? "F" : "M"}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-6 py-4 border-t border-brand-border flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <b>{chosen.length}</b> selected <span className="text-brand-textsec">({boys} boys · {girls} girls)</span>
            <span className="text-brand-textsec"> · {seats} seats in this session's halls</span>
            {chosen.length > seats && <p className="text-xs text-red-600 flex items-center gap-1 mt-1"><AlertTriangle className="w-3.5 h-3.5" /> More students than seats: some will be unallocated unless you add halls to the invigilator allocation.</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => onConfirm(chosen.map(s => s.id))} disabled={chosen.length === 0} className="btn-primary">Next: Configure Halls</button>
          </div>
        </div>
      </div>
    </div>
  )
}
