/**
 * "Copy selection from a previous session" in the Select Invigilators & Halls dialog.
 *
 * Only the SELECTION is copied: which staff and halls are ticked. Who had which hall in the
 * source session is never carried over; Generate Allocation runs the rotation engine afresh on
 * the ticked staff and halls, exactly as if they had been ticked by hand.
 */

/** A session whose selection can be copied (it has an allocation: draft, confirmed or published). */
export interface SelectionSource {
  id: number
  cycleId: number
  cycleName: string
  exam_date: string
  session_type: string
  status: string
  staffCount: number
}

export interface SessionRef { id: number; cycle_id: number; exam_date: string; session_type: string; status: string }

const slot = (type: string) => (type === "FN" ? 0 : 1)
/** Chronological order of sessions: by date, Forenoon before Afternoon. */
const compareTime = (a: { exam_date: string; session_type: string }, b: { exam_date: string; session_type: string }) =>
  a.exam_date.localeCompare(b.exam_date) || slot(a.session_type) - slot(b.session_type)

/**
 * The source for "Copy from previous session": the nearest earlier session (by date, then FN
 * before AN) in the same batch; if the batch has none, the latest earlier session in any batch.
 */
export function previousSelectionSource(sources: SelectionSource[], current: SessionRef): SelectionSource | null {
  const earlier = sources
    .filter(s => s.id !== current.id && compareTime(s, current) < 0)
    .sort((a, b) => compareTime(b, a) || b.id - a.id)
  return earlier.find(s => s.cycleId === current.cycle_id) ?? earlier[0] ?? null
}

/** The picker: this session's own draft first, then this batch's sessions, then other batches, newest first. */
export function selectionSourceGroups(sources: SelectionSource[], current: SessionRef) {
  const newestFirst = (a: SelectionSource, b: SelectionSource) => compareTime(b, a) || b.id - a.id
  const draft = sources.find(s => s.id === current.id && current.status === "draft") ?? null
  const others = sources.filter(s => s.id !== current.id).sort(newestFirst)
  const batches: { cycleId: number; cycleName: string; sessions: SelectionSource[] }[] = []
  for (const s of others) {
    let g = batches.find(b => b.cycleId === s.cycleId)
    if (!g) batches.push(g = { cycleId: s.cycleId, cycleName: s.cycleName, sessions: [] })
    g.sessions.push(s)
  }
  batches.sort((a, b) => Number(b.cycleId === current.cycle_id) - Number(a.cycleId === current.cycle_id)) // this batch first
  return { draft, batches }
}

/**
 * The ticks to copy from a session's allocation rows: staff IDs and hall IDs only, limited to
 * staff and halls that are still active (the dialog offers no others). Pairings are dropped.
 */
export function selectionFromAllocation(
  rows: { userId: number; hallId: number }[],
  activeUserIds: Iterable<number>,
  activeHallIds: Iterable<number>
) {
  const users = new Set(activeUserIds), halls = new Set(activeHallIds)
  const sourceUsers = [...new Set(rows.map(r => r.userId))], sourceHalls = [...new Set(rows.map(r => r.hallId))]
  return {
    userIds: sourceUsers.filter(id => users.has(id)).sort((a, b) => a - b),
    hallIds: sourceHalls.filter(id => halls.has(id)).sort((a, b) => a - b),
    inactiveStaff: sourceUsers.filter(id => !users.has(id)).length,
    inactiveHalls: sourceHalls.filter(id => !halls.has(id)).length,
  }
}
