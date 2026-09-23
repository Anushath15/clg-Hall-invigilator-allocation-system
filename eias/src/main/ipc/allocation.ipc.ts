import { ipcMain } from "electron"
import { db } from "../db/database"
import {
  getOrCreateAllocation,
  editAllocationEntry,
  confirmAllocation,
  publishAllocation,
  reopenSession,
  getSessionAllocationFull,
  getValidHallsFor,
  getStaffDutyHistory
} from "..\/services\/allocation.service"

export function registerAllocationHandlers() {
  ipcMain.handle("allocation:generate", async (_, sessionId, userIds, hallIds) =>
    getOrCreateAllocation(sessionId, userIds, hallIds)
  )
  ipcMain.handle("allocation:getSession", async (_, sessionId) => getSessionAllocationFull(sessionId))
  ipcMain.handle("allocation:edit", async (_, sessionId, userId, hallId, reason) =>
    editAllocationEntry(sessionId, userId, hallId, reason)
  )
  ipcMain.handle("allocation:removeEntry", async (_, sessionId, userId) =>
    removeAllocationEntry(sessionId, userId)
  )

  ipcMain.handle("allocation:getValidHalls", async (_, userId, sessionId) => getValidHallsFor(userId, sessionId))
  ipcMain.handle("allocation:confirm", async (_, sessionId) => confirmAllocation(sessionId))
  ipcMain.handle("allocation:publish", async (_, sessionId) => publishAllocation(sessionId))
  ipcMain.handle("allocation:reopen", async (_, sessionId) => reopenSession(sessionId))
  ipcMain.handle("allocation:staffDutyHistory", async (_, userId) => getStaffDutyHistory(userId))
  ipcMain.handle("allocation:history", async (_, filters) => {
    let sql = `SELECT u.staff_id, u.name as staffName, d.code as deptCode, h.hall_code,
               es.exam_date, es.session_type, ec.name as cycleName, a.is_manually_edited
               FROM allocations a
               JOIN users u ON a.user_id=u.id
               JOIN halls h ON a.hall_id=h.id
               JOIN exam_sessions es ON a.session_id=es.id
               JOIN exam_cycles ec ON es.cycle_id=ec.id
               LEFT JOIN departments d ON u.department_id=d.id
               WHERE 1=1`
    const params: any[] = []
    if (filters?.cycleId) { sql += ` AND es.cycle_id=?`; params.push(filters.cycleId) }
    if (filters?.userId) { sql += ` AND a.user_id=?`; params.push(filters.userId) }
    if (filters?.hallId) { sql += ` AND a.hall_id=?`; params.push(filters.hallId) }
    if (filters?.sessionId) { sql += ` AND a.session_id=?`; params.push(filters.sessionId) }
    sql += ` ORDER BY es.exam_date, es.session_type, u.name`
    return db.query(sql, params)
  })

  // In-app notifications
  ipcMain.handle("notification:get", async (_, userId) => {
    return db.query(
      `SELECT n.*, es.exam_date, es.session_type, h.hall_code
       FROM notifications n
       LEFT JOIN exam_sessions es ON n.session_id = es.id
       LEFT JOIN allocations a ON a.session_id = n.session_id AND a.user_id = n.user_id
       LEFT JOIN halls h ON a.hall_id = h.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [userId]
    )
  })

  ipcMain.handle("notification:unreadCount", async (_, userId) => {
    const row = db.queryOne<any>("SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0", [userId])
    return row?.c ?? 0
  })

  ipcMain.handle("notification:markRead", async (_, id) => {
    db.run("UPDATE notifications SET is_read=1 WHERE id=?", [id])
    return { success: true }
  })

  ipcMain.handle("notification:markAllRead", async (_, userId) => {
    db.run("UPDATE notifications SET is_read=1 WHERE user_id=?", [userId])
    return { success: true }
  })

  // Audit log
  ipcMain.handle("audit:get", async (_, limit = 100) => {
    return db.query(
      `SELECT al.*, u.name as actor_name, u.staff_id as actor_staff_id
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       ORDER BY al.created_at DESC
       LIMIT ?`,
      [limit]
    )
  })
}
