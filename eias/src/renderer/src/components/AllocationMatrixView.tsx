import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { formatDate, cn } from "../lib/utils"
import { Loader2 } from "lucide-react"

interface Props { cycleId: number }

export default function AllocationMatrixView({ cycleId }: Props) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getCompleteTimetable(cycleId)
      .then(setData)
      .finally(() => setLoading(false))
  }, [cycleId])

  if (loading) return (
    <div className="flex items-center justify-center py-16 text-brand-textsec">
      <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading matrix...
    </div>
  )
  if (!data || !data.sessions?.length) return (
    <div className="text-center py-12 text-brand-textsec text-sm">
      No confirmed sessions yet. Confirm allocations to see the matrix.
    </div>
  )

  const { sessions, allocations, users } = data
  const confirmedSessions = sessions.filter((s: any) => s.status === "confirmed" || s.status === "published")
  if (!confirmedSessions.length) return (
    <div className="text-center py-12 text-brand-textsec text-sm">
      No confirmed sessions. Confirm at least one session to view the matrix.
    </div>
  )

  if (!users || users.length === 0) return (
    <div className="text-center py-12 text-brand-textsec text-sm">
      No allocation data found for confirmed sessions.
    </div>
  )

  // Build lookup: { "userId_sessionId": hall_code } using user_id and session_id directly from API
  const lookup: Record<string, string> = {}
  const editedLookup: Record<string, boolean> = {}
  for (const a of allocations) {
    const key = `${a.user_id}_${a.session_id}`
    lookup[key] = a.hall_code ?? "?"
    editedLookup[key] = !!a.is_manually_edited
  }

  return (
    <div className="overflow-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="bg-brand-sidebar text-white px-3 py-2 text-left sticky left-0 z-10 min-w-[180px]">
              Staff / Session →
            </th>
            {confirmedSessions.map((s: any) => (
              <th key={s.id} className="bg-brand-sidebar text-white px-2 py-2 text-center whitespace-nowrap min-w-[70px] border-l border-white/10">
                <div className="font-semibold">{formatDate(s.exam_date).split(" ").slice(0,2).join(" ")}</div>
                <div className="text-gray-300 text-[10px]">{s.session_type}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u: any, idx: number) => (
            <tr key={u.id} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              <td className="sticky left-0 z-10 px-3 py-1.5 border-r border-brand-border bg-inherit">
                <div className="font-medium text-brand-textmain truncate max-w-[170px]">{u.name}</div>
                <div className="text-[10px] text-brand-textsec">{u.staff_id} · {u.deptName ?? "—"}</div>
              </td>
              {confirmedSessions.map((s: any) => {
                const key = `${u.id}_${s.id}`
                const hallCode = lookup[key]
                const isEdited = editedLookup[key]
                return (
                  <td key={s.id} className="px-1 py-1 text-center border-l border-brand-border">
                    {hallCode ? (
                      <span className={cn(
                        "inline-block px-2 py-0.5 rounded font-bold text-[11px]",
                        isEdited
                          ? "bg-amber-100 text-amber-700 border border-amber-300"
                          : "bg-brand-verylight text-brand-primary border border-brand-light"
                      )}>
                        {hallCode}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-4 mt-3 px-2 text-xs text-brand-textsec">
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-3 rounded bg-brand-verylight border border-brand-light" />
          Auto-generated
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-3 rounded bg-amber-100 border border-amber-300" />
          Admin-edited
        </span>
        <span className="flex items-center gap-1">
          <span className="text-gray-400">—</span> Not yet allocated
        </span>
      </div>
    </div>
  )
}

