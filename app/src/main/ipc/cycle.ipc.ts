import { ipcMain } from "electron"
import { db } from "../db/database"
import { deleteSession, deleteCycle, createSessions, addSession, updateSession } from "../services/allocation.service"

export function registerCycleHandlers() {
  ipcMain.handle("cycle:getCycles", () => db.query("SELECT * FROM exam_cycles ORDER BY created_at DESC"))
  ipcMain.handle("cycle:createCycle", async (_, data) => {
    const { lastInsertRowid } = db.run("INSERT INTO exam_cycles(name,academic_year,status) VALUES(?,?,?)", [data.name, data.academic_year, "draft"])
    return db.queryOne("SELECT * FROM exam_cycles WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("cycle:updateCycle", async (_, id, data) => {
    db.run("UPDATE exam_cycles SET name=?,academic_year=?,status=?,updated_at=datetime('now') WHERE id=?",
      [data.name, data.academic_year, data.status, id])
    return db.queryOne("SELECT * FROM exam_cycles WHERE id=?", [id])
  })
  ipcMain.handle("cycle:getSessions", async (_, cycleId) =>
    db.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
  )
  // Session changes keep the unconfirmed sessions in date order (allocation.service.ts).
  ipcMain.handle("cycle:createSessions", async (_, cycleId, sessions) => createSessions(cycleId, sessions))
  ipcMain.handle("cycle:updateSession", async (_, id, data) => updateSession(id, data))
  ipcMain.handle("cycle:addSession", async (_, cycleId, data) => addSession(cycleId, data))
  ipcMain.handle("cycle:deleteSession", async (_, id) => deleteSession(id))
  ipcMain.handle("cycle:deleteCycle", async (_, id) => deleteCycle(id))
}
