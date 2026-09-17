import { useEffect, useState, useCallback, useMemo } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { ChevronLeft, Zap, CheckCircle, Globe, AlertTriangle, Pencil, X, RefreshCw, LayoutGrid, List, Plus, Clock, Calendar, Trash2 } from "lucide-react"
import { api } from "../lib/api"
import { formatDate, formatDateWithDay, formatSession, formatTime12h, cn } from "../lib/utils"
import toast from "react-hot-toast"
import AllocationMatrixView from "../components/AllocationMatrixView"
import RotationHistoryTimeline from "../components/RotationHistoryTimeline"
import Tooltip from "../components/Tooltip"
import EditSessionScheduleModal from "../components/EditSessionScheduleModal"
import AddSessionModal from "../components/AddSessionModal"

export default function AllocationWorkspacePage() {
  const { cycleId, sessionId: paramSessionId } = useParams()
  const navigate = useNavigate()
  const [cycle, setCycle] = useState<any>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [activeSession, setActiveSession] = useState<any>(null)
  const [allocation, setAllocation] = useState<any[]>([])
  const [validation, setValidation] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [editEntry, setEditEntry] = useState<any>(null)
  const [validHalls, setValidHalls] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [allHalls, setAllHalls] = useState<any[]>([])
  const [showSelector, setShowSelector] = useState(false)
  const [viewMode, setViewMode] = useState<"table" | "matrix">("table")
  const [allHallsMap, setAllHallsMap] = useState<Record<number, any>>({})
  const [editScheduleSession, setEditScheduleSession] = useState<any | null>(null)
  const [showAddSessionModal, setShowAddSessionModal] = useState(false)

  // Detect duplicate sessions (sessions with same date and session_type)
  const duplicateSessionKeys = useMemo(() => {
    const counts = new Map<string, number>()
    sessions.forEach(s => {
      const key = `${s.exam_date}_${s.session_type}`
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    const dupes = new Set<string>()
    counts.forEach((count, key) => {
      if (count > 1) dupes.add(key)
    })
    return dupes
  }, [sessions])

  const isActiveSessionDuplicate = activeSession
    ? duplicateSessionKeys.has(`${activeSession.exam_date}_${activeSession.session_type}`)
    : false

  async function handleDeleteDuplicateSession(sessionId: number) {
    if (!window.confirm("Are you sure you want to remove this duplicate session?")) return
    try {
      const res = await api.deleteSession(sessionId)
      if (res.success) {
        toast.success("Duplicate session removed successfully.")
        await loadCycle()
      } else {
        toast.error(res.error || "Could not delete duplicate session.")
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete duplicate session.")
    }
  }

  const loadCycle = useCallback(async () => {
    const cycles = await api.getCycles()
    const c = cycles.find((x: any) => x.id === Number(cycleId))
    setCycle(c)
    const s = await api.getSessions(Number(cycleId))
    setSessions(s)
    const halls = await api.getHalls()
    setAllHallsMap(Object.fromEntries(halls.map((h: any) => [h.id, h])))
    if (s.length > 0) {
      const target = paramSessionId ? s.find((x: any) => x.id === Number(paramSessionId)) : s[0]
      setActiveSession(target ?? s[0])
    }
  }, [cycleId, paramSessionId])

  useEffect(() => { loadCycle() }, [loadCycle])
  useEffect(() => { if (activeSession) loadAllocation() }, [activeSession])

  async function loadAllocation() {
    const data = await api.getSessionAllocation(activeSession.id)
    setAllocation(data)
  }

  async function loadSelectors() {
    const [users, halls] = await Promise.all([api.getUsers({ is_active: true, role: "staff" }), api.getHalls()])
    setAllUsers(users.filter((u: any) => u.is_active))
    setAllHalls(halls.filter((h: any) => h.is_active))
  }

  async function handleGenerate(userIds?: number[], hallIds?: number[]) {
    if (!userIds || !hallIds) {
      setShowSelector(true)
      await loadSelectors()
      return
    }
    if (userIds.length !== hallIds.length) { toast.error("Staff count must equal hall count."); return }
    setLoading(true)
    try {
      const result = await api.generateAllocation(activeSession.id, userIds, hallIds)
      setAllocation(await api.getSessionAllocation(activeSession.id))
      setValidation(result.validation)
      if (result.validation?.isValid) toast.success("Allocation generated!")
      else toast.error(`${result.validation?.blockingErrors?.length ?? 1} validation error(s). Review below.`)
    } finally { setLoading(false) }
  }

  async function openEdit(entry: any) {
    setEditEntry(entry)
    const halls = await api.getValidHalls(entry.userId, activeSession.id)
    setValidHalls(halls)
  }

  async function applyEdit(hallId: number) {
    const r = await api.editAllocation(activeSession.id, editEntry.userId, hallId)
    if (r.success) { toast.success("Hall updated!"); setEditEntry(null); loadAllocation() }
    else toast.error(r.error?.message ?? "Invalid assignment.")
  }

  async function handleConfirm() {
    setLoading(true)
    try {
      const r = await api.confirmAllocation(activeSession.id)
      if (r.success) { toast.success("Allocation confirmed and locked!"); loadCycle(); loadAllocation() }
      else { toast.error("Validation failed — check errors below."); setValidation(r.validation) }
    } finally { setLoading(false) }
  }

  async function handlePublish() {
    const r = await api.publishAllocation(activeSession.id)
    if (r.success) { toast.success("Published! Staff can view their duty."); loadCycle(); loadAllocation() }
    else toast.error(r.error)
  }

  const statusActions: Record<string, React.ReactNode> = {
    pending: (
      <button onClick={() => handleGenerate()} disabled={loading}
        className="btn-primary flex items-center gap-2">
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {allocation.length === 0 ? "Select Staff & Generate" : "Regenerate"}
      </button>
    ),
    draft: (
      <div className="flex gap-2">
        <button onClick={() => handleGenerate()} disabled={loading} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Regenerate
        </button>
        <button onClick={handleConfirm} disabled={loading} className="btn-primary flex items-center gap-2">
          <CheckCircle className="w-4 h-4" /> Confirm Allocation
        </button>
      </div>
    ),
    confirmed: (
      <button onClick={handlePublish} className="btn-primary flex items-center gap-2">
        <Globe className="w-4 h-4" /> Publish to Staff
      </button>
    ),
    published: (
      <span className="flex items-center gap-2 text-green-600 font-medium text-sm">
        <CheckCircle className="w-4 h-4" /> Published — visible to staff
      </span>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/cycles")} className="p-2 rounded-lg hover:bg-gray-100 text-brand-textsec">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-brand-textmain">{cycle?.name ?? "Loading..."}</h1>
          <p className="text-brand-textsec text-sm">{cycle?.academic_year} · Allocation Workspace</p>
        </div>
        {/* View toggle */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setViewMode("table")}
            className={cn("p-2 rounded-md transition-colors", viewMode === "table" ? "bg-white shadow-sm text-brand-primary" : "text-brand-textsec hover:text-brand-textmain")}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setViewMode("matrix")}
            className={cn("p-2 rounded-md transition-colors", viewMode === "matrix" ? "bg-white shadow-sm text-brand-primary" : "text-brand-textsec hover:text-brand-textmain")}>
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Matrix View */}
      {viewMode === "matrix" && (
        <div className="card">
          <h2 className="text-base font-semibold text-brand-textmain mb-4">Full Allocation Matrix — All Sessions</h2>
          <AllocationMatrixView cycleId={Number(cycleId)} />
        </div>
      )}

      {/* Session Table View */}
      {viewMode === "table" && (
        <>
          {/* Session tabs */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1 items-center">
            {sessions.map(s => {
              const isDupe = duplicateSessionKeys.has(`${s.exam_date}_${s.session_type}`)
              return (
                <button key={s.id} onClick={() => setActiveSession(s)}
                  className={cn("px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex-shrink-0 transition-all border flex items-center gap-2",
                    activeSession?.id === s.id
                      ? isDupe
                        ? "bg-red-600 text-white border-red-600 shadow-xs"
                        : "bg-brand-primary text-white border-brand-primary shadow-xs"
                      : isDupe
                        ? "bg-red-50 text-red-700 border-red-300 hover:border-red-500"
                        : "bg-white text-brand-textsec border-brand-border hover:border-brand-primary")}>
                  {formatDate(s.exam_date)} {s.session_type}
                  {isDupe && (
                    <span className="px-1.5 py-0.2 bg-red-100 text-red-700 text-[10px] font-bold rounded-full border border-red-200 uppercase tracking-tight">
                      Duplicate
                    </span>
                  )}
                  <span className={cn("w-2 h-2 rounded-full", {
                    "bg-gray-300": s.status === "pending",
                    "bg-yellow-400": s.status === "draft",
                    "bg-blue-400": s.status === "confirmed",
                    "bg-green-400": s.status === "published"
                  })} />
                </button>
              )
            })}
            <button
              onClick={() => setShowAddSessionModal(true)}
              className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all border border-dashed border-brand-primary text-brand-primary hover:bg-brand-verylight flex items-center gap-1.5"
              title="Add an exam date / session to this cycle"
            >
              <Plus className="w-3.5 h-3.5" /> Add Session
            </button>
          </div>

          {activeSession && (
            <>
              {/* Duplicate Session Error Banner */}
              {isActiveSessionDuplicate && (
                <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-2xl flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-red-900 text-sm">Duplicate Session Error Detected</h4>
                      <p className="text-red-700 text-xs mt-0.5">
                        Multiple sessions are scheduled for <strong>{formatDate(activeSession.exam_date)} ({activeSession.session_type})</strong> in this cycle. Each exam date can only have at most one Forenoon (FN) and one Afternoon (AN) session.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditScheduleSession(activeSession)}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-red-300 text-red-800 hover:bg-red-100 transition-all flex items-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Reschedule Date/Slot
                    </button>
                    {activeSession.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteDuplicateSession(activeSession.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all flex items-center gap-1.5 shadow-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove Duplicate
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Session info bar */}
              <div className="card mb-4 flex items-center justify-between py-3">
                <div className="flex items-center gap-6 text-sm flex-wrap">
                  <div>
                    <span className="text-brand-textsec">Date: </span>
                    <span className="font-semibold text-brand-textmain">{formatDateWithDay(activeSession.exam_date)}</span>
                  </div>
                  <div>
                    <span className="text-brand-textsec">Session: </span>
                    <span className="font-semibold text-brand-textmain">{formatSession(activeSession.session_type)} ({activeSession.session_type})</span>
                  </div>
                  <div>
                    <span className="text-brand-textsec">Report: </span>
                    <span className="font-semibold text-brand-textmain">{formatTime12h(activeSession.reporting_time)} ({activeSession.reporting_time})</span>
                  </div>
                  <div>
                    <span className="text-brand-textsec">Exam: </span>
                    <span className="font-semibold text-brand-textmain">{formatTime12h(activeSession.exam_start)} – {formatTime12h(activeSession.exam_end)}</span>
                  </div>
                  <span className={`status-badge-${activeSession.status}`}>
                    {activeSession.status.charAt(0).toUpperCase() + activeSession.status.slice(1)}
                  </span>
                  <button
                    onClick={() => setEditScheduleSession(activeSession)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-brand-border bg-white text-brand-textmain hover:border-brand-primary hover:text-brand-primary hover:bg-brand-verylight transition-all shadow-xs"
                    title="Reselect date, edit report time, or change exam hours"
                  >
                    <Pencil className="w-3.5 h-3.5 text-brand-primary" />
                    Edit Schedule & Timings
                  </button>
                </div>
                <div className="flex-shrink-0">{statusActions[activeSession.status]}</div>
              </div>

              {/* Validation banners */}
              {validation && !validation.isValid && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2 text-red-700 font-semibold mb-2">
                    <AlertTriangle className="w-4 h-4" /> {validation.blockingErrors.length} Validation Error(s)
                  </div>
                  {validation.blockingErrors.map((e: any, i: number) => (
                    <p key={i} className="text-sm text-red-600">• <span className="font-mono font-bold">[{e.rule}]</span> {e.message}</p>
                  ))}
                </div>
              )}
              {validation?.isValid && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2 text-green-700 text-sm">
                  <CheckCircle className="w-4 h-4" /> All 7 validation rules passed successfully.
                </div>
              )}

              {/* Allocation table */}
              {allocation.length > 0 ? (
                <div className="card p-0 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-brand-border">
                      <tr>
                        {["#","Staff ID","Name","Department","Assigned Hall","Type",""].map(h =>
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-brand-textsec uppercase tracking-wider">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border">
                      {allocation.map((a: any, idx: number) => (
                        <tr key={a.userId} className={cn("transition-colors", a.is_manually_edited ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-gray-50")}>
                          <td className="px-4 py-3 text-brand-textsec text-xs">{idx + 1}</td>
                          <td className="px-4 py-3 font-mono text-xs">{a.staff_id}</td>
                          <td className="px-4 py-3 font-medium">{a.userName}</td>
                          <td className="px-4 py-3 text-brand-textsec text-xs">{a.deptCode ?? "—"}</td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex items-center gap-2 font-bold px-3 py-1 rounded-lg text-xs",
                              a.is_manually_edited ? "bg-amber-100 text-amber-700" : "bg-brand-verylight text-brand-primary")}>
                              {a.hall_code}
                              {a.is_manually_edited && <span className="font-normal text-amber-500">(edited)</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {a.is_manually_edited
                              ? <span className="text-xs text-amber-600 font-medium">Admin Edited</span>
                              : <span className="text-xs text-green-600">Auto-generated</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {activeSession.status !== "published" && (
                              <button onClick={() => openEdit(a)}
                                className="p-1.5 rounded hover:bg-gray-100 text-brand-textsec" title="Edit hall assignment">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 bg-gray-50 border-t border-brand-border text-xs text-brand-textsec">
                    {allocation.length} invigilators · {allocation.filter((a: any) => a.is_manually_edited).length} admin-edited
                  </div>
                </div>
              ) : (
                <div className="card text-center py-16 text-brand-textsec">
                  <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No allocation for this session yet</p>
                  <p className="text-sm mt-1">Click "Select Staff & Generate" to begin.</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Staff & Hall Selector Modal */}
      {showSelector && (
        <SelectorModal
          allUsers={allUsers}
          allHalls={allHalls}
          onConfirm={(uIds: number[], hIds: number[]) => { setShowSelector(false); handleGenerate(uIds, hIds) }}
          onClose={() => setShowSelector(false)}
        />
      )}

      {/* Edit Modal with History Timeline */}
      {editEntry && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
              <h3 className="text-base font-semibold">Edit Hall Assignment</h3>
              <button onClick={() => setEditEntry(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-1 overflow-hidden">
              {/* Left: Hall picker */}
              <div className="flex-1 overflow-y-auto p-5 border-r border-brand-border">
                <div className="mb-4 p-3 bg-brand-verylight rounded-lg text-sm">
                  <p className="font-medium">{editEntry.userName}
                    <span className="text-brand-textsec font-normal ml-2">({editEntry.staff_id})</span></p>
                  <p className="text-brand-textsec mt-0.5">Current hall: <span className="font-bold text-brand-primary">{editEntry.hall_code}</span></p>
                </div>
                <p className="text-xs font-semibold text-brand-textsec uppercase tracking-wider mb-3">Select New Hall:</p>
                <div className="grid grid-cols-4 gap-2">
                  {validHalls.map((vh: any) => {
                    const hallInfo = allHallsMap[vh.hallId]
                    return (
                      <Tooltip key={vh.hallId} content={vh.reason ?? ""} disabled={!vh.isValid}>
                        <button
                          disabled={!vh.isValid}
                          onClick={() => applyEdit(vh.hallId)}
                          className={cn("p-2.5 rounded-xl border text-center text-xs font-bold transition-all w-full",
                            vh.isValid
                              ? "border-brand-border hover:border-brand-primary hover:bg-brand-verylight text-brand-textmain"
                              : "border-red-100 bg-red-50 text-red-300 cursor-not-allowed")}
                        >
                          <div className={vh.isValid ? "text-brand-primary" : "line-through"}>
                            {hallInfo?.hall_code ?? `H${vh.hallId}`}
                          </div>
                          {hallInfo?.name && (
                            <div className="text-[9px] font-normal text-brand-textsec mt-0.5 truncate">
                              {hallInfo.name}
                            </div>
                          )}
                          {!vh.isValid && (
                            <div className="text-[9px] font-normal text-red-400 mt-0.5 no-underline">
                              {vh.reason?.includes("cycle") ? "In cycle" : "Occupied"}
                            </div>
                          )}
                        </button>
                      </Tooltip>
                    )
                  })}
                </div>
              </div>
              {/* Right: History timeline */}
              <div className="w-64 overflow-y-auto p-5">
                <RotationHistoryTimeline
                  userId={editEntry.userId}
                  userName={editEntry.userName}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Session Schedule Modal */}
      {editScheduleSession && (
        <EditSessionScheduleModal
          session={editScheduleSession}
          existingSessions={sessions}
          onClose={() => setEditScheduleSession(null)}
          onSaved={(updated) => {
            setEditScheduleSession(null)
            setActiveSession(updated)
            loadCycle()
          }}
          onDeleted={() => {
            setEditScheduleSession(null)
            loadCycle()
          }}
        />
      )}

      {/* Add Session Modal */}
      {showAddSessionModal && (
        <AddSessionModal
          cycleId={Number(cycleId)}
          existingSessions={sessions}
          onClose={() => setShowAddSessionModal(false)}
          onAdded={(newSession) => {
            setShowAddSessionModal(false)
            loadCycle().then(() => {
              setActiveSession(newSession)
            })
          }}
        />
      )}
    </div>
  )
}

function SelectorModal({ allUsers, allHalls, onConfirm, onClose }: any) {
  const [selUsers, setSelUsers] = useState<number[]>([])
  const [selHalls, setSelHalls] = useState<number[]>([])
  const byDept = allUsers.reduce((acc: any, u: any) => {
    const k = u.department_name ?? "Other"
    ;(acc[k] = acc[k] ?? []).push(u)
    return acc
  }, {})

  const toggleUser = (id: number) => setSelUsers(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleHall = (id: number) => setSelHalls(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleAllDept = (users: any[]) => {
    const allSelected = users.every((u: any) => selUsers.includes(u.id))
    if (allSelected) setSelUsers(p => p.filter(id => !users.map((u: any) => u.id).includes(id)))
    else setSelUsers(p => [...new Set([...p, ...users.map((u: any) => u.id)])])
  }

  const canSubmit = selUsers.length > 0 && selUsers.length === selHalls.length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border">
          <h3 className="text-base font-semibold">Select Invigilators & Halls</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Staff list */}
          <div className="flex-1 overflow-y-auto p-4 border-r border-brand-border">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-brand-textmain">
                Invigilators <span className="text-brand-primary">({selUsers.length} selected)</span>
              </p>
            </div>
            {Object.entries(byDept).map(([dept, users]: any) => (
              <div key={dept} className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-bold text-brand-textsec uppercase tracking-wider">{dept}</p>
                  <button onClick={() => toggleAllDept(users)}
                    className="text-xs text-brand-primary hover:underline">
                    {users.every((u: any) => selUsers.includes(u.id)) ? "Deselect all" : "Select all"}
                  </button>
                </div>
                {users.map((u: any) => (
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
          <div className="w-56 overflow-y-auto p-4">
            <p className="text-sm font-semibold text-brand-textmain mb-3">
              Halls <span className="text-brand-primary">({selHalls.length} selected)</span>
            </p>
            <button onClick={() => setSelHalls(allHalls.map((h: any) => h.id))}
              className="text-xs text-brand-primary hover:underline mb-3 block">Select all halls</button>
            {allHalls.map((h: any) => (
              <label key={h.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer mb-1">
                <input type="checkbox" checked={selHalls.includes(h.id)} onChange={() => toggleHall(h.id)} className="accent-brand-primary" />
                <div>
                  <p className="text-sm font-bold text-brand-primary">{h.hall_code}</p>
                  <p className="text-xs text-brand-textsec truncate">{h.name}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-brand-border bg-gray-50">
          <div className="text-sm text-brand-textsec">
            {selUsers.length > 0 && selUsers.length !== selHalls.length && (
              <span className="text-amber-600">⚠ Select {selUsers.length} halls to match {selUsers.length} staff</span>
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
