import { ipcMain } from "electron"
import { db } from "../db/database"
import { getOrCreateAllocation, editAllocationEntry, confirmAllocation, publishAllocation, getSessionAllocationFull, getValidHallsFor, getStaffDutyHistory } from "../services/allocation.service"

export function registerAllocationHandlers() {
  ipcMain.handle("allocation:generate", async (_, sessionId, userIds, hallIds) =>
    getOrCreateAllocation(sessionId, userIds, hallIds))
  ipcMain.handle("allocation:getSession", async (_, sessionId) => getSessionAllocationFull(sessionId))
  ipcMain.handle("allocation:edit", async (_, sessionId, userId, hallId, reason) =>
    editAllocationEntry(sessionId, userId, hallId, reason))
  ipcMain.handle("allocation:getValidHalls", async (_, userId, sessionId) => getValidHallsFor(userId, sessionId))
  ipcMain.handle("allocation:confirm", async (_, sessionId) => confirmAllocation(sessionId))
  ipcMain.handle("allocation:publish", async (_, sessionId) => publishAllocation(sessionId))
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
}
