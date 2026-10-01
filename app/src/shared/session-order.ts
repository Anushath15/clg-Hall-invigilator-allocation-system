/**
 * ROTATION ORDER OF SESSIONS. rotation_step is the order a batch's sessions are confirmed in
 * (R4). Sessions not yet confirmed (pending or draft) are kept in date order, Forenoon before
 * Afternoon, after the confirmed ones, however and whenever they were added or rescheduled.
 * Confirmed and published sessions are never renumbered: their halls are already in the
 * rotation history (whose global_order, set at confirmation, is what R1 reads) and their steps
 * are part of the audit trail. Used by the desktop and the web build.
 */
export interface SessionOrderRow {
  id: number
  exam_date: string
  session_type: string
  rotation_step: number
  status: string
}

export const isConfirmedStatus = (status: string) => status === "confirmed" || status === "published"

const slot = (s: SessionOrderRow) => (s.session_type === "FN" ? 0 : 1)

/** The rotation_step changes that put a batch's unconfirmed sessions into date order. */
export function unconfirmedStepChanges(sessions: SessionOrderRow[]): { id: number; rotation_step: number }[] {
  let step = Math.max(0, ...sessions.filter(s => isConfirmedStatus(s.status)).map(s => s.rotation_step))
  return sessions
    .filter(s => !isConfirmedStatus(s.status))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date) || slot(a) - slot(b) || a.rotation_step - b.rotation_step || a.id - b.id)
    .map(s => ({ s, rotation_step: ++step }))
    .filter(({ s, rotation_step }) => s.rotation_step !== rotation_step)
    .map(({ s, rotation_step }) => ({ id: s.id, rotation_step }))
}
