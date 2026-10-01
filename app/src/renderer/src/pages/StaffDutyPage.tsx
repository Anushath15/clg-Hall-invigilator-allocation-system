import { useEffect, useState } from "react"
import { Calendar, Clock, MapPin, Building2, Printer } from "lucide-react"
import { api } from "../lib/api"
import { useAuthStore } from "../store/auth.store"
import { formatDate, formatSession, formatTime12h, hallLocation } from "../lib/utils"
import { dutySlipHtml } from "../lib/duty-slip"
import { splitStaffDuties, type StaffDutyRow } from "../../../shared/staff-duty"

export default function StaffDutyPage() {
  const { user } = useAuthStore()
  const [duties, setDuties] = useState<StaffDutyRow[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})

  useEffect(() => {
    if (user) api.getStaffDutyHistory(user.id).then(setDuties)
    api.getSettings().then(setSettings)
  }, [user])

  // Local date, not UTC: in IST the UTC date lags until 05:30, which kept yesterday's duty "upcoming".
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const { next, upcoming, past } = splitStaffDuties(duties, today)

  function printDutySlip() {
    const win = window.open("", "_blank", "width=800,height=600")
    if (!win) return
    // Rendered by React (lib/duty-slip.tsx), so names and other values are HTML-escaped.
    win.document.write(dutySlipHtml({
      collegeName: settings["college.name"] ?? "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil",
      shortName: settings["college.short_name"] ?? "SXCCE",
      staffName: user?.name,
      staffId: user?.staff_id,
      duty: next ?? null,
      generatedAt: new Date().toLocaleString(),
    }))
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 500)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-textmain">My Invigilation Duty</h1>
        {next && (
          <button onClick={printDutySlip}
            className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print Duty Slip
          </button>
        )}
      </div>

      {/* Next upcoming duty */}
      {next ? (
        <div className="bg-brand-sidebar rounded-2xl p-6 text-white shadow-xl">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-brand-light text-xs font-semibold uppercase tracking-wider">Next Upcoming Duty</p>
              <p className="text-gray-400 text-xs mt-0.5">{next.cycleName}</p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-white/10 text-brand-light text-xs font-semibold capitalize">{next.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-5 mt-5">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-brand-light mt-0.5 flex-shrink-0" />
              <div><p className="text-xs text-gray-400">Exam Date</p><p className="text-lg font-bold">{formatDate(next.exam_date)}</p></div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-brand-light mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Session</p>
                <p className="text-lg font-bold">{formatSession(next.session_type)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-brand-light mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Hall</p>
                <p className="text-3xl font-black text-brand-light tracking-wide">{next.hall_code}</p>
                <p className="text-xs text-gray-400 mt-0.5">{hallLocation({ block: next.hallBlock, floor: next.hallFloor })}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-brand-light mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-400">Reporting Time</p>
                <p className="font-bold text-lg">{formatTime12h(next.reporting_time)}</p>
                <p className="text-xs text-gray-400 mt-1">Exam Duration</p>
                <p className="font-medium text-sm">{formatTime12h(next.exam_start)} – {formatTime12h(next.exam_end)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card text-center py-12 text-brand-textsec">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No upcoming duty assigned</p>
          <p className="text-sm mt-1">Your next duty slip will appear here once published by the admin.</p>
        </div>
      )}

      {/* Upcoming (rest) */}
      {upcoming.length > 1 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-brand-textmain mb-3">Upcoming Duties ({upcoming.length - 1} more)</h2>
          <div className="space-y-2">
            {upcoming.slice(1).map((d, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-brand-verylight border border-brand-light">
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-brand-primary" />
                  <div>
                    <p className="text-sm font-medium">{formatDate(d.exam_date)} · {d.session_type}</p>
                    <p className="text-xs text-brand-textsec">{d.cycleName}</p>
                  </div>
                </div>
                <span className="font-bold text-brand-primary bg-white px-3 py-1 rounded-lg border border-brand-light text-sm">
                  {d.hall_code}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Past duties */}
      {past.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-brand-textmain mb-3">Past Duties</h2>
          <table className="w-full text-sm">
            <thead>
              <tr>{["Date","Session","Hall","Reporting","Exam Time","Batch"].map(h =>
                <th key={h} className="text-left py-2 text-xs font-semibold text-brand-textsec uppercase tracking-wider pr-4">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {past.map((d, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="py-2.5 pr-4 font-medium">{formatDate(d.exam_date)}</td>
                  <td className="py-2.5 pr-4">{d.session_type}</td>
                  <td className="py-2.5 pr-4 font-bold text-brand-primary">{d.hall_code}</td>
                  <td className="py-2.5 pr-4 text-brand-textsec">{formatTime12h(d.reporting_time)}</td>
                  <td className="py-2.5 pr-4 text-brand-textsec">{formatTime12h(d.exam_start)} – {formatTime12h(d.exam_end)}</td>
                  <td className="py-2.5 text-brand-textsec text-xs">{d.cycleName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
