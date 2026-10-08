import { db } from "../db/database"
import { minimumUnavoidableRepeats, hallsVisitedThisCycle, hallHistory } from "./rotation.engine"
import { planSwap, type SwapPlan } from "../../shared/swap"

/** The hall pool a rotation cycle is measured over; all active halls if the session has none yet. */
function cyclePool(sessionHalls: number[]): number[] {
  if (sessionHalls.length > 0) return sessionHalls
  return db.query<any>("SELECT id FROM halls WHERE is_active = 1").map((r: any) => r.id)
}

export interface ValidationEntry {
  userId: number; hallId: number; sessionId: number
}
export interface ValidationError {
  rule: string; message: string; userId?: number; hallId?: number
}
export interface ValidationResult {
  isValid: boolean; blockingErrors: ValidationError[]; warnings: string[]
}

export function validateAllocation(sessionId: number, entries: ValidationEntry[], hallIds: number[], userIds: number[], hallRequirements?: Map<number, number>): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  // R7 - Count match
  const totalSlotsNeeded = hallRequirements ? Array.from(hallRequirements.values()).reduce((a, b) => a + b, 0) : hallIds.length
  if (entries.length !== totalSlotsNeeded) {
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

  // R1 - No hall twice within the person's current rotation cycle over this session's hall pool
  for (const e of entries) {
    if (hallsVisitedThisCycle(e.userId, hallIds).has(e.hallId)) {
      const user = db.queryOne<any>("SELECT name FROM users WHERE id = ?", [e.userId])
      const hall = db.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [e.hallId])
      const prev = db.queryOne<any>(
        `SELECT es.exam_date, es.session_type FROM rotation_history rh
         LEFT JOIN exam_sessions es ON rh.session_id = es.id
         WHERE rh.user_id = ? AND rh.hall_id = ?
         ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
        [e.userId, e.hallId]
      )
      errors.push({
        rule: "R1",
        message: `${user?.name} was already assigned Hall ${hall?.hall_code} ${visitText(prev)} in the current rotation cycle. Cannot repeat.`,
        userId: e.userId, hallId: e.hallId
      })
    }
  }

  // R1 exception: when the staff on duty vary from session to session, it can be
  // impossible for everyone to avoid a recent hall (e.g. two people whose only
  // remaining hall is the same one). If this allocation has no more repeats than the
  // minimum any assignment of these staff to these halls must have, the repeats are
  // unavoidable: report them as warnings instead of blocking the session forever.
  const r1Errors = errors.filter(e => e.rule === "R1")
  if (r1Errors.length > 0 && !hallRequirements) {
    const minimum = minimumUnavoidableRepeats(entries.map(e => e.userId), entries.map(e => e.hallId))
    if (r1Errors.length <= minimum) {
      for (const e of r1Errors) {
        errors.splice(errors.indexOf(e), 1)
        warnings.push(`Unavoidable repeat: ${e.message.replace(" Cannot repeat.", "")} No valid alternative exists for the staff on duty in this session.`)
      }
    }
  }

  // R4 - Rotation integrity: EVERY earlier session of the batch (lower rotation_step) must
  // already be confirmed. Requiring only that some earlier session was confirmed let step 3 be
  // confirmed while step 2 was still pending (QA-16).
  const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
  if (session) {
    const unconfirmedEarlier = db.queryOne<any>(
      "SELECT COUNT(*) as c FROM exam_sessions WHERE cycle_id = ? AND rotation_step < ? AND status NOT IN ('confirmed','published')",
      [session.cycle_id, session.rotation_step]
    )
    if ((unconfirmedEarlier?.c ?? 0) > 0) {
      errors.push({
        rule: "R4",
        message: "Previous session(s) in this cycle have not been confirmed yet. Confirm sessions in order."
      })
    }
  }

  return { isValid: errors.length === 0, blockingErrors: errors, warnings }
}

/** "on 2026-11-02 (FN)", or "earlier (in a deleted batch)" when that session has since been deleted with its batch. */
function visitText(prev: { exam_date?: string | null; session_type?: string | null } | undefined): string {
  return prev?.exam_date ? `on ${prev.exam_date} (${prev.session_type})` : "earlier (in a deleted batch)"
}

/** The confirmed session in which a staff member last had a hall (for R1 messages). */
function lastVisit(userId: number, hallId: number) {
  return db.queryOne<any>(
    `SELECT es.exam_date, es.session_type FROM rotation_history rh
     LEFT JOIN exam_sessions es ON rh.session_id = es.id
     WHERE rh.user_id = ? AND rh.hall_id = ?
     ORDER BY COALESCE(rh.global_order, 0) DESC, datetime(rh.recorded_at) DESC, rh.id DESC LIMIT 1`,
    [userId, hallId]
  )
}

/**
 * A manual edit is a swap (shared/swap.ts): `userId` takes `hallId` and whoever holds it takes
 * userId's hall. Both people must be active, both halls active and in the session's pool,
 * and R1 must hold for BOTH people.
 */
export function validateSwap(
  userId: number,
  hallId: number,
  sessionId: number,
  currentEntries: ValidationEntry[],
  sessionHallPool?: number[]
): { error: ValidationError } | { plan: SwapPlan } {
  const user = db.queryOne<any>("SELECT * FROM users WHERE id = ?", [userId])
  if (!user?.is_active) return { error: { rule: "R5", message: `${user?.name ?? "Staff"} is inactive.`, userId } }

  const hall = db.queryOne<any>("SELECT * FROM halls WHERE id = ?", [hallId])
  if (!hall?.is_active) return { error: { rule: "R6", message: `Hall ${hall?.hall_code ?? hallId} is inactive.`, hallId } }

  // BUG 5 fix: Ensure hall belongs to the current session's hall pool
  const sessionHalls = sessionHallPool && sessionHallPool.length > 0
    ? sessionHallPool
    : db.query<any>("SELECT DISTINCT COALESCE(generated_hall_id, hall_id) as h_id FROM allocations WHERE session_id = ?", [sessionId]).map((r: any) => r.h_id)

  if (sessionHalls.length > 0 && !sessionHalls.includes(hallId)) {
    return { error: { rule: "SESSION_POOL", message: `Hall ${hall.hall_code} is not part of this session's hall pool.`, hallId } }
  }

  const plan = planSwap(currentEntries, userId, hallId, cyclePool(sessionHalls), hallHistory)
  if (plan.fromHallId === null) return { error: { rule: "SESSION", message: `${user.name} has no hall in this session.`, userId } }

  if (plan.selfRepeat) {
    const prev = lastVisit(userId, hallId)
    return { error: {
      rule: "R1",
      message: `${user.name} was already assigned Hall ${hall.hall_code} ${visitText(prev)} in the current rotation cycle.`,
      userId, hallId
    } }
  }

  if (plan.partnerUserId !== null) {
    const partner = db.queryOne<any>("SELECT * FROM users WHERE id = ?", [plan.partnerUserId])
    const fromHall = db.queryOne<any>("SELECT * FROM halls WHERE id = ?", [plan.fromHallId])
    if (!partner?.is_active) return { error: { rule: "R5", message: `${partner?.name ?? "Staff"} holds Hall ${hall.hall_code} but is inactive.`, userId: plan.partnerUserId } }
    if (!fromHall?.is_active) return { error: { rule: "R6", message: `Hall ${fromHall?.hall_code ?? plan.fromHallId} is inactive, so ${partner.name} cannot take it.`, hallId: plan.fromHallId } }
    if (plan.partnerRepeat) {
      const prev = lastVisit(partner.id, fromHall.id)
      return { error: {
        rule: "R1",
        message: `Swap refused: ${partner.name} would get Hall ${fromHall.hall_code}, which ${partner.name} already had ${visitText(prev)} in the current rotation cycle.`,
        userId: partner.id, hallId: fromHall.id
      } }
    }
  }
  return { plan }
}

/** The halls offered in the edit dialog: each one is a swap with its holder, checked for both people. */
export function getValidHallsForStaff(
  userId: number,
  sessionId: number,
  sessionHallIds: number[],
  entries: { userId: number; hallId: number }[]
): { hallId: number; isValid: boolean; reason?: string; swapWithUserId?: number }[] {
  const pool = cyclePool(sessionHallIds)
  const mine = entries.find(e => e.userId === userId)
  return sessionHallIds.map(hallId => {
    if (mine?.hallId === hallId) return { hallId, isValid: false, reason: "Current hall" }
    const plan = planSwap(entries, userId, hallId, pool, hallHistory)
    if (plan.selfRepeat) return { hallId, isValid: false, reason: "Already visited in cycle" }
    if (plan.partnerUserId === null) return { hallId, isValid: true }
    if (!mine) return { hallId, isValid: false, reason: "Assigned to another invigilator" }
    if (plan.partnerRepeat) {
      const partner = db.queryOne<any>("SELECT name FROM users WHERE id = ?", [plan.partnerUserId])
      const fromHall = db.queryOne<any>("SELECT hall_code FROM halls WHERE id = ?", [mine.hallId])
      return { hallId, isValid: false, reason: `Swap blocked: ${partner?.name ?? "the holder"} already had Hall ${fromHall?.hall_code ?? mine.hallId} in this rotation cycle` }
    }
    return { hallId, isValid: true, swapWithUserId: plan.partnerUserId }
  })
}
