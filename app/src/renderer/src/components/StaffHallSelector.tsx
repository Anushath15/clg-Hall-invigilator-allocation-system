import { useMemo, useRef, useState } from "react"
import { X, Search, Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from "lucide-react"
import * as XLSX from "xlsx"
import toast from "react-hot-toast"
import { readDutyList, type DutyListResult } from "../lib/duty-list"
import { hallLocation } from "../lib/utils"
import { matchesSearch } from "../lib/search"

interface Props {
  allUsers: any[]
  allHalls: any[]
  onConfirm: (userIds: number[], hallIds: number[]) => void
  onClose: () => void
}

/**
 * "Select Invigilators & Halls" for one session: tick staff one by one, search them
 * by name or Staff ID (halls by hall code or block), or upload an Excel/CSV duty list to
 * select them all at once.
 */
export default function StaffHallSelector({ allUsers, allHalls, onConfirm, onClose }: Props) {
  const [selUsers, setSelUsers] = useState<number[]>([])
  const [selHalls, setSelHalls] = useState<number[]>([])
  const [query, setQuery] = useState("")
  const [hallQuery, setHallQuery] = useState("")
  const [upload, setUpload] = useState<{ file: string; result: DutyListResult } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const visibleUsers = useMemo(() => allUsers.filter(u => matchesSearch(q, u.name, u.staff_id)), [allUsers, q])
  const hq = hallQuery.trim().toLowerCase()
  const visibleHalls = useMemo(() => allHalls.filter(h => matchesSearch(hq, h.hall_code, h.block)), [allHalls, hq])
  const byDept = useMemo(() => visibleUsers.reduce((acc: Record<string, any[]>, u) => {
    const k = u.department_name ?? "Other"
    ;(acc[k] = acc[k] ?? []).push(u)
    return acc
  }, {}), [visibleUsers])

  const toggleUser = (id: number) => setSelUsers(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleHall = (id: number) => setSelHalls(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  // "Select all" acts on the staff currently shown (so it respects the search).
  const toggleAll = (users: any[]) => {
    const ids = users.map(u => u.id)
    if (ids.every(id => selUsers.includes(id))) setSelUsers(p => p.filter(id => !ids.includes(id)))
    else setSelUsers(p => [...new Set([...p, ...ids])])
  }
  const toggleShownHalls = () => {
    const ids = visibleHalls.map(h => h.id)
    if (ids.every(id => selHalls.includes(id))) setSelHalls(p => p.filter(id => !ids.includes(id)))
    else setSelHalls(p => [...new Set([...p, ...ids])])
  }

  async function handleFile(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
      const result = readDutyList(rows, allUsers, allHalls)
      if (result.userIds.length === 0) {
        toast.error("No invigilators from this file match the active staff list.")
      } else {
        // The file replaces the current selection, so the duty list is exactly what was uploaded.
        setSelUsers(result.userIds)
        if (result.hasHallColumn) { setSelHalls(result.hallIds); setHallQuery("") }
        setQuery("")
        toast.success(`${result.userIds.length} invigilator(s) selected from the file.`)
      }
      setUpload({ file: file.name, result })
    } catch (e: any) {
      toast.error(`Could not read the file: ${e?.message ?? e}`)
    } finally {
      if (fileInput.current) fileInput.current.value = "" // allow re-uploading the same file
    }
  }

  function downloadTemplate() {
    const rows = [["Staff ID", "Name", "Department", "Hall"],
      ...allUsers.map(u => [u.staff_id, u.name, u.department_code ?? u.department_name ?? "", ""])]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Duty List")
    XLSX.writeFile(wb, "HIAS-Duty-List-Template.xlsx")
  }

  const issues = upload ? [
    ...upload.result.notFound.map(v => `${v}: not found among active staff`),
    ...upload.result.ambiguous.map(v => `${v}: more than one staff member has this name, use Staff IDs`),
    ...upload.result.duplicates.map(v => `${v}: listed more than once`),
    ...upload.result.hallsNotFound.map(v => `Hall ${v}: not found among active halls`),
  ] : []

  const canSubmit = selUsers.length > 0 && selUsers.length === selHalls.length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <h3 className="text-base font-semibold">Select Invigilators & Halls</h3>
          <button onClick={onClose} title="Close" className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>

        {/* Toolbar: search + Excel duty list */}
        <div className="px-6 py-3 border-b border-brand-border flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search staff by name or Staff ID"
              className="input-field pl-9 pr-8"
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery("")} title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 text-gray-400">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          <button onClick={() => fileInput.current?.click()} className="btn-primary flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload Excel
          </button>
          <button onClick={downloadTemplate} className="btn-secondary flex items-center gap-2"
            title="An Excel sheet of all active staff: delete the rows not on duty (optionally fill in Hall), save, then upload it">
            <FileSpreadsheet className="w-4 h-4" /> Download template
          </button>
        </div>

        {/* Upload summary */}
        {upload && (
          <div className={`mx-6 mt-3 p-3 rounded-xl border text-sm ${issues.length ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`font-medium flex items-center gap-2 ${issues.length ? "text-amber-800" : "text-green-700"}`}>
                {issues.length ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                {upload.file}: {upload.result.userIds.length} invigilator(s) selected by {upload.result.matchedBy}
                {upload.result.hasHallColumn && `, ${upload.result.hallIds.length} hall(s)`}
                {issues.length ? `; ${issues.length} row(s) need attention` : ""}
              </p>
              <button onClick={() => setUpload(null)} className="p-0.5 rounded hover:bg-black/5 text-gray-400"><X className="w-3.5 h-3.5" /></button>
            </div>
            {issues.length > 0 && (
              <ul className="mt-1.5 ml-6 list-disc text-amber-700 text-xs max-h-24 overflow-y-auto">
                {issues.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden mt-1">
          {/* Staff list */}
          <div className="flex-1 overflow-y-auto p-4 border-r border-brand-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-brand-textmain">
                Invigilators <span className="text-brand-primary">({selUsers.length} selected)</span>
                {q && <span className="text-brand-textsec font-normal"> · showing {visibleUsers.length} of {allUsers.length}</span>}
              </p>
              <div className="flex gap-3">
                {q && visibleUsers.length > 0 && (
                  <button onClick={() => toggleAll(visibleUsers)} className="text-xs text-brand-primary hover:underline">
                    {visibleUsers.every(u => selUsers.includes(u.id)) ? "Deselect shown" : "Select shown"}
                  </button>
                )}
                {selUsers.length > 0 && (
                  <button onClick={() => setSelUsers([])} className="text-xs text-red-500 hover:underline">Clear</button>
                )}
              </div>
            </div>
            {visibleUsers.length === 0 && (
              <p className="text-sm text-brand-textsec text-center py-10">No staff match "{query}".</p>
            )}
            {Object.entries(byDept).map(([dept, users]) => (
              <div key={dept} className="mb-4">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-bold text-brand-textsec uppercase tracking-wider">{dept}</p>
                  <button onClick={() => toggleAll(users)} className="text-xs text-brand-primary hover:underline whitespace-nowrap flex-shrink-0">
                    {users.every(u => selUsers.includes(u.id)) ? "Deselect all" : "Select all"}
                  </button>
                </div>
                {users.map(u => (
                  <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={selUsers.includes(u.id)} onChange={() => toggleUser(u.id)} className="accent-brand-primary" />
                    <div>
                      <p className="text-sm font-medium text-brand-textmain">{u.name}</p>
                      <p className="text-xs text-brand-textsec">{u.staff_id} · {u.designation ?? "—"}</p>
                    </div>
                  </label>
                ))}
              </div>
            ))}
          </div>

          {/* Halls list */}
          <div className="w-80 overflow-y-auto p-4">
            <div className="relative mb-3">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={hallQuery}
                onChange={e => setHallQuery(e.target.value)}
                placeholder="Search halls by code or block"
                className="input-field pl-9 pr-8"
              />
              {hallQuery && (
                <button onClick={() => setHallQuery("")} title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 text-gray-400">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <p className="text-sm font-semibold text-brand-textmain mb-2">
              Halls <span className="text-brand-primary">({selHalls.length} selected)</span>
              {hq && <span className="text-brand-textsec font-normal"> · showing {visibleHalls.length} of {allHalls.length}</span>}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3">
              <button onClick={() => setSelHalls(allHalls.map(h => h.id))} className="text-xs text-brand-primary hover:underline">Select all halls</button>
              {hq && visibleHalls.length > 0 && (
                <button onClick={toggleShownHalls} className="text-xs text-brand-primary hover:underline">
                  {visibleHalls.every(h => selHalls.includes(h.id)) ? "Deselect shown" : "Select shown"}
                </button>
              )}
              {selHalls.length > 0 && (
                <button onClick={() => setSelHalls([])} className="text-xs text-red-500 hover:underline">Clear</button>
              )}
            </div>
            {visibleHalls.length === 0 && (
              <p className="text-sm text-brand-textsec text-center py-10">No halls match "{hallQuery}".</p>
            )}
            {visibleHalls.map(h => (
              <label key={h.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer mb-1">
                <input type="checkbox" checked={selHalls.includes(h.id)} onChange={() => toggleHall(h.id)} className="accent-brand-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-brand-primary">{h.hall_code}</p>
                  {hallLocation(h) && <p className="text-xs text-brand-textsec truncate" title={hallLocation(h)}>{hallLocation(h)}</p>}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-brand-border bg-gray-50">
          <div className="text-sm text-brand-textsec">
            {selUsers.length > 0 && selUsers.length !== selHalls.length && (
              <span className="text-amber-600">⚠ Select {selUsers.length} halls to match {selUsers.length} staff (now {selHalls.length})</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => onConfirm(selUsers, selHalls)} disabled={!canSubmit} className="btn-primary">
              Generate Allocation
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
