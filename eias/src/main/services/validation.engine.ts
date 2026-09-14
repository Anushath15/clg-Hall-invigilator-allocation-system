import { db } from "../db/database"

export interface ValidationEntry {
  userId: number; hallId: number; sessionId: number
}
export interface ValidationError {
  rule: string; message: string; userId?: number; hallId?: number
}
export interface ValidationResult {
  isValid: boolean; blockingErrors: ValidationError[]; warnings: string[]
}

export function validateAllocation(
  sessionId: number,
  entries: ValidationEntry[],
  hallIds: number[],
  userIds: number[]
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // R7 ? Count match
  if (entries.length !== hallIds.length || entries.length !== userIds.length) {
    errors.push({ rule: "R7", message: `Staff count (${userIds.length}) must equal hall count (${hallIds.length}).` })
  }

  // R5 ? Staff availability
  for (const e of entries) {
    const u = db.queryOne<any>("SELECT id, name, staff_id, is_active FROM users WHERE id = ?", [e.userId])
    if (u && !u.is_active) errors.push({ rule: "R5", message: `${u.name} (${u.staff_id}) is inactive.`, userId: u.id })
  }

  // R6 ? Hall availability
  for (const e of entries) {
    const h = db.queryOne<any>("SELECT id, hall_code, is_active FROM halls WHERE id = ?", [e.hallId])
    if (h && !h.is_active) errors.push({ rule: "R6", message: `Hall ${h.hall_code} is inactive.`, hallId: h.id })
  }

  // R2 ? Hall duplication in session
  const hallCounts = new Map<number, number>()
  for (const e of entries) hallCounts.set(e.hallId, (hallCounts.get(e.hallId) ?? 0) + 1)
  for (const [hallId, count] of hallCounts) {
    if (count > 1) {
      const hall = db.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [hallId])
      errors.push({ rule: "R2", message: `Hall ${hall?.hall_code ?? hallId} is assigned to ${count} staff in the same session.`, hallId })
    }
  }

  // R3 ? Staff duplication in session
  const userCounts = new Map<number, number>()
  for (const e of entries) userCounts.set(e.userId, (userCounts.get(e.userId) ?? 0) + 1)
  for (const [userId, count] of userCounts) {
    if (count > 1) {
      const user = db.queryOne<any>("SELECT name FROM users WHERE id = ?", [userId])
      errors.push({ rule: "R3", message: `${user?.name ?? userId} is assigned to ${count} halls in the same session.`, userId })
    }
  }

  // BUG 2 fix: Rotation cycle length ALWAYS equals current session's hall pool size
  const cycleLength = hallIds.length
  for (const e of entries) {
    // BUG 6 fix: Order chronologically by global_order DESC, recorded_at DESC, id DESC
    const recentRows = db.query<any>(
      "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
      [e.userId, cycleLength]
    )
    const usedInCycle = recentRows.map((r: any) => r.hall_id)
    if (usedInCycle.includes(e.hallId)) {
      const user = db.queryOne<any>("SELECT name FROM users WHERE id = ?", [e.userId])
      const hall = db.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [e.hallId])
      const prev = db.queryOne<any>(
        `SELECT es.exam_date, es.session_type FROM rotation_history rh
         JOIN exam_sessions es ON rh.session_id = es.id
         WHERE rh.user_id = ? AND rh.hall_id = ?
         ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
        [e.userId, e.hallId]
      )
      errors.push({
        rule: "R1",
        message: `${user?.name} was already assigned Hall ${hall?.hall_code} on ${prev?.exam_date ?? "?"} (${prev?.session_type ?? "?"}) in the current rotation cycle. Cannot repeat.`,
        userId: e.userId, hallId: e.hallId
      })
    }
  }

  // R4 ? Rotation integrity: this session must follow the last confirmed session in step order
  const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
  if (session) {
    const prevConfirmed = db.queryOne<any>(
      `SELECT id FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ? AND status IN ('confirmed','published')
       ORDER BY rotation_step DESC LIMIT 1`,
      [session.cycle_id, session.rotation_step]
    )
    if (prevConfirmed) {
      // OK ? previous session is confirmed
    } else {
      // Check if there is any session before this one
      const hasPrevious = db.queryOne<any>(
        "SELECT id FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ?",
        [session.cycle_id, session.rotation_step]
      )
      if (hasPrevious) {
        errors.push({
          rule: "R4",
          message: "Previous session(s) in this cycle have not been confirmed yet. Confirm sessions in order."
        })
      }
    }
  }

  return { isValid: errors.length === 0, blockingErrors: errors, warnings }
}

export function validateSingleEdit(
  userId: number,
  hallId: number,
  sessionId: number,
  currentEntries: ValidationEntry[],
  sessionHallPool?: number[]
): ValidationError | null {
  const user = db.queryOne<any>("SELECT * FROM users WHERE id = ?", [userId])
  if (!user?.is_active) return { rule: "R5", message: `${user?.name ?? "Staff"} is inactive.`, userId }

  const hall = db.queryOne<any>("SELECT * FROM halls WHERE id = ?", [hallId])
  if (!hall?.is_active) return { rule: "R6", message: `Hall ${hall?.hall_code ?? hallId} is inactive.`, hallId }

  // BUG 5 fix: Ensure hall belongs to the current session's hall pool
  const sessionHalls = sessionHallPool && sessionHallPool.length > 0
    ? sessionHallPool
    : db.query<any>("SELECT DISTINCT COALESCE(generated_hall_id, hall_id) as h_id FROM allocations WHERE session_id = ?", [sessionId]).map((r: any) => r.h_id)

  if (sessionHalls.length > 0 && !sessionHalls.includes(hallId)) {
    return { rule: "SESSION_POOL", message: `Hall ${hall.hall_code} is not part of this session's hall pool.`, hallId }
  }

  const hallTaken = currentEntries.find(e => e.hallId === hallId && e.userId !== userId)
  if (hallTaken) return { rule: "R2", message: `Hall ${hall.hall_code} is already assigned to another invigilator in this session.`, hallId }

  // BUG 2 fix: Use session hall pool size for cycleLength
  const cycleLength = sessionHalls.length > 0 ? sessionHalls.length : 10
  // BUG 6 fix: Order chronologically by global_order DESC, recorded_at DESC, id DESC
  const recentRows = db.query<any>(
    "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
    [userId, cycleLength]
  )
  const usedInCycle = recentRows.map((r: any) => r.hall_id)
  if (usedInCycle.includes(hallId)) {
    const prev = db.queryOne<any>(
      `SELECT es.exam_date, es.session_type FROM rotation_history rh
       JOIN exam_sessions es ON rh.session_id = es.id
       WHERE rh.user_id = ? AND rh.hall_id = ?
       ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
      [userId, hallId]
    )
    return {
      rule: "R1",
      message: `${user.name} was already assigned Hall ${hall.hall_code} on ${prev?.exam_date ?? "?"} (${prev?.session_type ?? "?"}) in the current rotation cycle.`,
      userId, hallId
    }
  }
  return null
}

export function getValidHallsForStaff(
  userId: number,
  sessionId: number,
  sessionHallIds: number[],
  occupiedHallIds: number[]
): { hallId: number; isValid: boolean; reason?: string }[] {
  // BUG 2 fix: Use sessionHallIds.length for cycle length
  const cycleLength = sessionHallIds.length > 0 ? sessionHallIds.length : 10
  // BUG 6 fix: Order chronologically by global_order DESC, recorded_at DESC, id DESC
  const recentRows = db.query<any>(
    "SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order, 0) DESC, datetime(recorded_at) DESC, id DESC LIMIT ?",
    [userId, cycleLength]
  )
  const usedInCycle = new Set(recentRows.map((r: any) => r.hall_id))
  return sessionHallIds.map(hallId => {
    if (occupiedHallIds.includes(hallId)) return { hallId, isValid: false, reason: "Assigned to another invigilator" }
    if (usedInCycle.has(hallId)) return { hallId, isValid: false, reason: "Already visited in cycle" }
    return { hallId, isValid: true }
  })
}