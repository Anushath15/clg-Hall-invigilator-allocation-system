import { useEffect } from "react"
import { X, UserCheck, Users, GraduationCap } from "lucide-react"
import { cn } from "../lib/utils"
import type { SeatRow } from "../lib/export-seating-pdf"
import HallBenchGrid, { colorKey } from "./HallBenchGrid"

interface Props {
  hall: { hall_code: string; raw: any; invigilators: string[]; seats: number }
  location: string
  /** The hall's gender label and its colour classes, as on the hall tile. */
  badge: { text: string; className: string }
  seats: SeatRow[]
  colorOf: (key: string) => string
  highlight?: number[]
  onClose: () => void
}

/**
 * A hall's seating in a popup (opened from the hall tile): who invigilates it, how many students
 * sit in it, which departments (classes) they come from, and the bench grid as seen from the front.
 */
export default function HallSeatingModal({ hall, location, badge, seats, colorOf, highlight = [], onClose }: Props) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", esc)
    return () => document.removeEventListener("keydown", esc)
  }, [onClose])

  const boys = seats.filter(s => s.gender === "M").length
  const classes = new Map<string, number>()
  for (const s of seats) classes.set(colorKey(s), (classes.get(colorKey(s)) ?? 0) + 1)
  const departments = [...new Set(seats.map(s => s.deptCode).filter(Boolean))] as string[]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={`Hall ${hall.hall_code} seating`} className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-brand-border bg-gray-50/70">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono font-bold text-xl text-brand-primary">{hall.hall_code}</span>
            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", badge.className)}>{badge.text}</span>
            <span className="text-sm text-brand-textsec truncate">{location || "—"}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-200/60 text-gray-600 hover:text-gray-800 transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-brand-border p-3">
              <p className="text-xs text-brand-textsec flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> {hall.invigilators.length > 1 ? "Invigilators" : "Invigilator"}</p>
              <p className="font-semibold text-brand-textmain mt-1">{hall.invigilators.length ? hall.invigilators.join(", ") : "Not allocated"}</p>
            </div>
            <div className="rounded-xl border border-brand-border p-3">
              <p className="text-xs text-brand-textsec flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Students</p>
              <p className="mt-1"><span className="font-semibold text-brand-textmain text-lg">{seats.length}</span> <span className="text-sm text-brand-textsec">of {hall.seats} seats · {boys} boys · {seats.length - boys} girls</span></p>
            </div>
            <div className="rounded-xl border border-brand-border p-3">
              <p className="text-xs text-brand-textsec flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> {departments.length > 1 ? "Departments" : "Department"}{departments.length ? ` (${departments.length})` : ""}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[...classes].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => (
                  <span key={k} className={cn("px-2 py-0.5 rounded text-xs font-medium", colorOf(k))}>{k} · {n}</span>
                ))}
              </div>
            </div>
          </div>

          <HallBenchGrid hall={{ hall_code: hall.hall_code, raw: hall.raw, invigilators: hall.invigilators }} seats={seats} colorOf={colorOf} highlight={highlight} bare />
        </div>
      </div>
    </div>
  )
}
