import { useEffect, useState } from "react"
import { api } from "../lib/api"
import { formatDate, formatSession, cn } from "../lib/utils"
import { History } from "lucide-react"

interface Props { userId: number; userName: string; highlightHallId?: number }

export default function RotationHistoryTimeline({ userId, userName, highlightHallId }: Props) {
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    api.getStaffDutyHistory(userId).then(h => setHistory(h.slice(0, 20)))
  }, [userId])

  if (!history.length) return (
    <div className="text-xs text-brand-textsec py-4 text-center">
      <History className="w-5 h-5 mx-auto mb-1 opacity-40" />
      No history yet
    </div>
  )

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-brand-textsec uppercase tracking-wider mb-2">
        {userName} — Last {history.length} Assignments
      </p>
      {history.map((h: any, i: number) => (
        <div key={i} className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-lg text-xs border",
          highlightHallId && h.hall_id === highlightHallId
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-gray-50 border-transparent text-brand-textmain"
        )}>
          <span className="text-brand-textsec">
            {formatDate(h.exam_date)} {h.session_type}
          </span>
          <span className={cn(
            "font-bold px-2 py-0.5 rounded",
            highlightHallId && h.hall_id === highlightHallId
              ? "bg-red-100 text-red-700"
              : "bg-brand-verylight text-brand-primary"
          )}>
            {h.hall_code}
          </span>
        </div>
      ))}
    </div>
  )
}
