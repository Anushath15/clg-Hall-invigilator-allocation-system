import { db, writeAuditLog } from "../db/database"
import { generateAllocation, commitToHistory } from "./rotation.engine"
import { validateAllocation, validateSwap, getValidHallsForStaff } from "./validation.engine"
import { unconfirmedStepChanges, type SessionOrderRow } from "../../shared/session-order"
import { isPastDate, PAST_DATE_MESSAGE } from "../../shared/session-dates"
import { validateSessionTimes } from "../../shared/validation"

/** Times are optional on old records; when any is given, all three must be valid and in order. */
function checkTimes(d: any): void {
  if (d.reporting_time == null && d.exam_start == null && d.exam_end == null) return
  const problem = validateSessionTimes(d.reporting_time, d.exam_start, d.exam_end)
  if (problem) throw new Error(problem)
}
import { STAFF_DUTY_HISTORY_SQL, type StaffDutyRow } from "../../shared/staff-duty"

export async function getOrCreateAllocation(
  sessionId: number,
  userIds: number[],
  hallIds: number[]
) {
  // A confirmed session's halls are already in the rotation history; regenerating it would
  // leave allocations and history out of step. (The UI never offers it; refuse it here too.)
  const session = db.queryOne<any>("SELECT status FROM exam_sessions WHERE id = ?", [sessionId])
  if (!session) throw new Error("Exam session not found.")
  if (session.status === "confirmed" || session.status === "published") throw new Error("This session is already confirmed. It cannot be regenerated.")
  if (new Set(userIds).size !== userIds.length) throw new Error("The same staff member is selected more than once.")
  if (new Set(hallIds).size !== hallIds.length) throw new Error("The same hall is selected more than once.")

  const entries = await generateAllocation(sessionId, userIds, hallIds)

  // Save to allocations table
  db.run("DELETE FROM allocations WHERE session_id = ?", [sessionId])
  for (const e of entries) {
    db.run(
      "INSERT OR REPLACE INTO allocations(session_id, user_id, hall_id, is_manually_edited, generated_hall_id) VALUES(?,?,?,0,?)",
      [sessionId, e.userId, e.hallId, e.hallId]
    )
  }
  // Update session to draft
  db.run("UPDATE exam_sessions SET status='draft' WHERE id=?", [sessionId])

  const validationEntries = entries.map(e => ({ ...e, sessionId }))
  const validation = validateAllocation(sessionId, validationEntries, hallIds, userIds)
  const fullAllocation = getSessionAllocationFull(sessionId)
  return { entries: fullAllocation, validation }
}

/**
 * Manual edit = swap: `userId` takes `newHallId` and whoever holds it takes userId's hall
 * (validateSwap checks R1 for both). A row counts as Admin Edited while it differs from the
 * generated hall, so swapping back clears the mark.
 */
export async function editAllocationEntry(sessionId: number, userId: number, newHallId: number, editReason?: string) {
  const session = db.queryOne<any>("SELECT status FROM exam_sessions WHERE id = ?", [sessionId])
  if (!session) return { success: false, error: { rule: "SESSION", message: "Exam session not found." } }
  if (session.status === "confirmed" || session.status === "published") {
    return { success: false, error: { rule: "LOCKED", message: "This session is confirmed; its allocation can no longer be edited." } }
  }
  const current = db.query<any>("SELECT user_id, hall_id, generated_hall_id, created_at FROM allocations WHERE session_id = ?", [sessionId])
  if (current.find((r: any) => r.user_id === userId)?.hall_id === newHallId) {
    return { success: false, error: { rule: "NO_CHANGE", message: "That is already the assigned hall." } }
  }
  const currentEntries = current.map((r: any) => ({ userId: r.user_id, hallId: r.hall_id, sessionId }))
  // BUG 5 fix: Extract session's declared hall pool
  const sessionHallPool = Array.from(new Set(current.map((r: any) => r.generated_hall_id || r.hall_id))) as number[]
  const checked = validateSwap(userId, newHallId, sessionId, currentEntries, sessionHallPool)
  if ("error" in checked) return { success: false, error: checked.error }
  const { plan } = checked

  const moves = [{ userId, hallId: newHallId }]
  if (plan.partnerUserId !== null) moves.push({ userId: plan.partnerUserId, hallId: plan.fromHallId! })
  // Both rows are replaced together: UNIQUE(session_id, hall_id) rules out moving them one at a time.
  await db.runTransaction(() => {
    for (const m of moves) db.run("DELETE FROM allocations WHERE session_id=? AND user_id=?", [sessionId, m.userId])
    for (const m of moves) {
      const row = current.find((r: any) => r.user_id === m.userId)
      const edited = row.generated_hall_id == null || m.hallId !== row.generated_hall_id
      db.run(
        `INSERT INTO allocations(session_id, user_id, hall_id, is_manually_edited, edit_reason, generated_hall_id, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,datetime('now'))`,
        [sessionId, m.userId, m.hallId, edited ? 1 : 0, edited ? editReason ?? null : null, row.generated_hall_id, row.created_at]
      )
    }
    if (plan.partnerUserId !== null) {
      writeAuditLog(null, "SWAP_ALLOCATION", `Manual swap in session ${sessionId}: user ${userId} to hall ${newHallId}, user ${plan.partnerUserId} to hall ${plan.fromHallId}`,
        { sessionId, userId, newHallId, partnerUserId: plan.partnerUserId, partnerHallId: plan.fromHallId, editReason })
    } else {
      writeAuditLog(null, "EDIT_ALLOCATION", `Manual override for session ${sessionId}, user ${userId} to hall ${newHallId}`, { sessionId, userId, newHallId, editReason })
    }
  })
  return { success: true, swappedWithUserId: plan.partnerUserId }
}

export async function confirmAllocation(sessionId: number) {
  const allocations = db.query<any>("SELECT * FROM allocations WHERE session_id = ?", [sessionId])
  if (!allocations.length) {
    return { success: false, error: "No allocations found for this session." }
  }
  const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
  if (!session) {
    return { success: false, error: "Exam session not found." }
  }
  const entries = allocations.map((a: any) => ({ userId: a.user_id, hallId: a.hall_id, sessionId }))
  const hallIds = allocations.map((a: any) => a.hall_id)
  const userIds = allocations.map((a: any) => a.user_id)

  const validation = validateAllocation(sessionId, entries, hallIds, userIds)
  if (!validation.isValid) return { success: false, validation }

  // BUG 4 fix: Wrap confirmation in an atomic transaction
  try {
    await db.runTransaction(async () => {
      await commitToHistory(
        sessionId,
        session.rotation_step,
        allocations.map((a: any) => ({ userId: a.user_id, hallId: a.hall_id, isAutoGenerated: !a.is_manually_edited }))
      )
      db.run("UPDATE exam_sessions SET status='confirmed', updated_at=datetime('now') WHERE id=?", [sessionId])
    })
    refreshCycleStatus(session.cycle_id)
    writeAuditLog(null, "CONFIRM_ALLOCATION", `Session ${sessionId} confirmed`, { sessionId, count: entries.length })
    return { success: true, validation }
  } catch (err: any) {
    return { success: false, error: err?.message || "Confirmation failed during transaction." }
  }
}

// A batch's status follows its sessions: "confirmed" once every session is confirmed,
// "published" once every session is published, otherwise "draft". (Publishing is no
// longer offered in the offline app, so batches normally end at "confirmed".)
export function refreshCycleStatus(cycleId: number) {
  const counts = db.queryOne<any>(
    `SELECT COUNT(*) as total,
            SUM(CASE WHEN status IN ('confirmed','published') THEN 1 ELSE 0 END) as confirmed,
            SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published
     FROM exam_sessions WHERE cycle_id=?`,
    [cycleId]
  )
  const total = counts?.total ?? 0
  const status = total > 0 && counts.published === total ? "published"
    : total > 0 && counts.confirmed === total ? "confirmed"
    : "draft"
  db.run("UPDATE exam_cycles SET status=?, updated_at=datetime('now') WHERE id=?", [status, cycleId])
}

export function publishAllocation(sessionId: number) {
  const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id = ?", [sessionId])
  if (!session) return { success: false, error: "Session not found." }
  if (session.status !== "confirmed") return { success: false, error: "Allocation must be confirmed before publishing." }
  db.run("UPDATE exam_sessions SET status='published', updated_at=datetime('now') WHERE id=?", [sessionId])
  // Roll up cycle status: if all sessions in cycle are published, mark cycle as published
  const unpublished = db.queryOne<any>(
    "SELECT COUNT(*) as c FROM exam_sessions WHERE cycle_id=? AND status != 'published'",
    [session.cycle_id]
  )
  if (!unpublished || unpublished.c === 0) {
    db.run("UPDATE exam_cycles SET status='published' WHERE id=?", [session.cycle_id])
  }
  writeAuditLog(null, "PUBLISH_ALLOCATION", `Session ${sessionId} published`, { sessionId })

  // In-app notifications for assigned staff
  try {
    const allocations = db.query<any>(
      `SELECT a.user_id, h.hall_code, ec.name as cycle_name
       FROM allocations a
       JOIN halls h ON a.hall_id = h.id
       JOIN exam_sessions es ON a.session_id = es.id
       JOIN exam_cycles ec ON es.cycle_id = ec.id
       WHERE a.session_id = ?`,
      [sessionId]
    )
    const sessionLabel = `${session.exam_date} ${session.session_type}`
    for (const a of allocations) {
      db.run(
        "INSERT INTO notifications(user_id, title, message, session_id) VALUES(?,?,?,?)",
        [
          a.user_id,
          "New Exam Duty Published",
          `Your invigilation duty has been published for ${sessionLabel} — Hall ${a.hall_code} (${a.cycle_name}).`,
          sessionId
        ]
      )
    }
  } catch (e) {
    console.warn("[HIAS] Failed to create notifications in desktop:", e)
  }

  return { success: true }
}


export function getSessionAllocationFull(sessionId: number) {
  return db.query(
    `SELECT a.id, a.is_manually_edited, a.edit_reason,
            u.id as userId, u.staff_id, u.name as userName, u.designation,
            d.name as deptName, d.code as deptCode,
            h.id as hallId, h.hall_code, h.name as hallName, h.block as hallBlock, h.floor as hallFloor,
            gh.hall_code as generatedHallCode
     FROM allocations a
     JOIN users u ON a.user_id = u.id
     JOIN halls h ON a.hall_id = h.id
     LEFT JOIN departments d ON u.department_id = d.id
     LEFT JOIN halls gh ON a.generated_hall_id = gh.id
     WHERE a.session_id = ?
     ORDER BY d.code COLLATE NOCASE, u.name`,
    [sessionId]
  )
}

export function getValidHallsFor(userId: number, sessionId: number) {
  const entries = db.query<any>("SELECT user_id, hall_id FROM allocations WHERE session_id = ?", [sessionId]).map((r: any) => ({ userId: r.user_id, hallId: r.hall_id }))
  // BUG 5 fix: Session hall pool only
  const poolRows = db.query<any>(
    `SELECT DISTINCT h.id, h.sort_order 
     FROM allocations a
     JOIN halls h ON h.id = COALESCE(a.generated_hall_id, a.hall_id)
     WHERE a.session_id = ?
     ORDER BY h.sort_order, h.id`,
    [sessionId]
  )
  let sessionHalls = poolRows.map((r: any) => r.id)
  if (sessionHalls.length === 0) {
    sessionHalls = db.query<any>("SELECT id FROM halls WHERE is_active = 1 ORDER BY sort_order, id").map((h: any) => h.id)
  }
  return getValidHallsForStaff(userId, sessionId, sessionHalls, entries)
}

/** Sessions whose staff/hall selection can be copied in the selector (they have an allocation), newest first. */
export function getSessionSelections() {
  return db.query(
    `SELECT es.id, es.cycle_id as cycleId, ec.name as cycleName, es.exam_date, es.session_type, es.status, COUNT(a.id) as staffCount
     FROM exam_sessions es
     JOIN exam_cycles ec ON es.cycle_id = ec.id
     JOIN allocations a ON a.session_id = es.id
     GROUP BY es.id
     ORDER BY es.exam_date DESC, CASE es.session_type WHEN 'FN' THEN 1 ELSE 0 END, es.id DESC`
  )
}

export function getStaffDutyHistory(userId: number): StaffDutyRow[] {
  return db.query<StaffDutyRow>(STAFF_DUTY_HISTORY_SQL, [userId])
}

export function restartRotation() {
  db.run("DELETE FROM rotation_history")
  const activeStaff = db.query<any>("SELECT id FROM users WHERE role = 'staff' AND is_active = 1")
  for (const staff of activeStaff) {
    db.run(
      "INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, datetime('now'))",
      [
        staff.id,
        "Rotation Restarted",
        "Your entire hall rotation history has been restarted by the admin. Your rotation cycle has been reset, so every hall is open to you again from your next duty."
      ]
    )
  }
  writeAuditLog(null, "ROTATION_RESTART", "Entire rotation history restarted by admin", { affectedStaffCount: activeStaff.length })
  return { success: true }
}

export function getNotifications(userId: number) {
  return db.query("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC", [userId])
}

export function getUnreadCount(userId: number) {
  const row = db.queryOne<any>("SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0", [userId])
  return row?.cnt || 0
}

export function markNotificationRead(id: number) {
  db.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [id])
  return { success: true }
}

export function markAllRead(userId: number) {
  db.run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [userId])
  return { success: true }
}

export function hardDeleteUser(id: number) {
  const inHistory = db.queryOne<any>("SELECT id FROM rotation_history WHERE user_id = ? LIMIT 1", [id])
  const inAllocations = db.queryOne<any>("SELECT id FROM allocations WHERE user_id = ? LIMIT 1", [id])
  if (inHistory || inAllocations) {
    return { success: false, error: "Cannot permanently delete: this staff member has allocation history." }
  }
  const user = db.queryOne<any>("SELECT staff_id, name FROM users WHERE id = ?", [id])
  db.run("DELETE FROM users WHERE id = ?", [id])
  writeAuditLog(null, "STAFF_HARD_DELETE", `Staff permanently deleted: ${user?.staff_id ?? id} - ${user?.name ?? ""}`, { id, staff_id: user?.staff_id })
  return { success: true }
}

export function deleteSession(id: number) {
  const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
  if (!session) return { success: false, error: "Session not found." }
  if (session.status === "confirmed" || session.status === "published") {
    return { success: false, error: "Cannot delete a confirmed or published session." }
  }
  db.run("DELETE FROM allocations WHERE session_id=?", [id])
  db.run("DELETE FROM exam_sessions WHERE id=?", [id])
  renumberUnconfirmedSessions(session.cycle_id) // confirmed sessions keep their steps
  refreshCycleStatus(session.cycle_id)
  return { success: true }
}

/** Puts a batch's pending and draft sessions into date order after its confirmed ones (shared/session-order.ts). */
export function renumberUnconfirmedSessions(cycleId: number) {
  const sessions = db.query<SessionOrderRow>("SELECT id, exam_date, session_type, rotation_step, status FROM exam_sessions WHERE cycle_id=?", [cycleId])
  for (const c of unconfirmedStepChanges(sessions)) {
    db.run("UPDATE exam_sessions SET rotation_step=?, updated_at=datetime('now') WHERE id=? AND status NOT IN ('confirmed','published')", [c.rotation_step, c.id])
  }
}

const slotName = (type: string) => (type === "FN" ? "Forenoon (FN)" : "Afternoon (AN)")

/** The batch wizard: replaces the batch's unconfirmed sessions with `sessions` (confirmed ones stay). */
export async function createSessions(cycleId: number, sessions: any[]) {
  if (sessions.some(s => isPastDate(s.exam_date))) throw new Error(PAST_DATE_MESSAGE)
  sessions.forEach(checkTimes)
  return db.runTransaction(() => {
    // SAFE: only delete sessions that are NOT confirmed or published
    const safeToDelete = db.query<any>(
      "SELECT id FROM exam_sessions WHERE cycle_id=? AND status NOT IN ('confirmed','published')",
      [cycleId]
    )
    for (const s of safeToDelete) {
      db.run("DELETE FROM exam_sessions WHERE id=?", [s.id])
    }
    // Find highest step from surviving confirmed sessions
    const maxStepRow = db.queryOne<any>("SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?", [cycleId])
    let step = (maxStepRow?.m ?? 0) + 1
    const seen = new Set<string>()
    const existing = db.query<any>("SELECT exam_date, session_type FROM exam_sessions WHERE cycle_id=?", [cycleId])
    for (const e of existing) seen.add(`${e.exam_date}_${e.session_type}`)

    for (const s of sessions) {
      const key = `${s.exam_date}_${s.session_type}`
      if (seen.has(key)) continue
      seen.add(key)
      db.run(
        "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
        [cycleId, s.exam_date, s.session_type, step++, s.reporting_time??null, s.exam_start??null, s.exam_end??null, "pending"]
      )
    }
    renumberUnconfirmedSessions(cycleId)
    return db.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
  })
}

/** One more session in a batch; it takes its date-order place among the unconfirmed sessions. */
export function addSession(cycleId: number, data: any) {
  if (isPastDate(data.exam_date)) throw new Error(PAST_DATE_MESSAGE)
  checkTimes(data)
  const exists = db.queryOne<any>(
    "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=?",
    [cycleId, data.exam_date, data.session_type]
  )
  if (exists) throw new Error(`A ${slotName(data.session_type)} session already exists for ${data.exam_date} in this cycle.`)

  const maxStep = db.queryOne<any>("SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?", [cycleId])
  const { lastInsertRowid } = db.run(
    "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
    [cycleId, data.exam_date, data.session_type, (maxStep?.m ?? 0) + 1, data.reporting_time??null, data.exam_start??null, data.exam_end??null, "pending"]
  )
  renumberUnconfirmedSessions(cycleId)
  refreshCycleStatus(cycleId) // a new pending session reopens a confirmed batch
  return db.queryOne("SELECT * FROM exam_sessions WHERE id=?", [lastInsertRowid])
}

/**
 * Reschedule a session (date, slot, times). Status and rotation_step are not taken from the
 * caller: they change only through generate/confirm and date-order renumbering, so a stale
 * copy in the window can never reopen or reorder a confirmed session.
 */
export function updateSession(id: number, data: any) {
  const current = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
  if (!current) return null
  const examDate = data.exam_date ?? current.exam_date
  const sessionType = data.session_type ?? current.session_type
  // Moving a session to a day that has passed is refused; changing only the times of a session
  // that keeps its date is still allowed, so an older record can be corrected.
  if (examDate !== current.exam_date && isPastDate(examDate)) throw new Error(PAST_DATE_MESSAGE)

  // Check for duplicate session date and slot within the same cycle
  const conflict = db.queryOne<any>(
    "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=? AND id!=?",
    [current.cycle_id, examDate, sessionType, id]
  )
  if (conflict) throw new Error(`A ${slotName(sessionType)} session already exists for ${examDate} in this cycle.`)

  const reportingTime = data.reporting_time !== undefined ? data.reporting_time : current.reporting_time
  const examStart = data.exam_start !== undefined ? data.exam_start : current.exam_start
  const examEnd = data.exam_end !== undefined ? data.exam_end : current.exam_end
  // An old record may have no times at all; those are left alone. Otherwise the final times must be valid and in order.
  if (reportingTime != null && examStart != null && examEnd != null) checkTimes({ reporting_time: reportingTime, exam_start: examStart, exam_end: examEnd })

  db.run(
    "UPDATE exam_sessions SET exam_date=?,session_type=?,reporting_time=?,exam_start=?,exam_end=?,updated_at=datetime('now') WHERE id=?",
    [examDate, sessionType, reportingTime, examStart, examEnd, id]
  )
  renumberUnconfirmedSessions(current.cycle_id)
  return db.queryOne("SELECT * FROM exam_sessions WHERE id=?", [id])
}

// Deleting an entire batch (exam cycle) is a deliberate, explicit action distinct from
// deleteSession above: unlike removing one session from an in-progress workflow, this is
// meant to work even on a confirmed/published batch (the UI gates it behind a typed DELETE
// confirmation instead; the web build also asks for the password). It removes the batch's rotation_history too, so any fairness
// effect that batch had on future allocations is fully undone along with it — the rotation
// engine only ever reads the *latest* remaining entry per staff member and the running
// MAX(global_order), neither of which requires the deleted step numbers to be contiguous.
export function deleteCycle(id: number) {
  const cycle = db.queryOne<any>("SELECT * FROM exam_cycles WHERE id=?", [id])
  if (!cycle) return { success: false, error: "Allocation batch not found." }

  return db.runTransaction(() => {
    const sessions = db.query<any>("SELECT id FROM exam_sessions WHERE cycle_id=?", [id])
    for (const s of sessions) {
      db.run("DELETE FROM rotation_history WHERE session_id=?", [s.id])
      db.run("DELETE FROM allocations WHERE session_id=?", [s.id])
    }
    db.run("DELETE FROM exam_sessions WHERE cycle_id=?", [id])
    db.run("DELETE FROM exam_cycles WHERE id=?", [id])
    writeAuditLog(null, "CYCLE_DELETE",
      `Allocation batch deleted: ${cycle.name} (${cycle.academic_year}) — ${sessions.length} session(s) removed`,
      { id, name: cycle.name, sessionCount: sessions.length })
    return { success: true }
  })
}