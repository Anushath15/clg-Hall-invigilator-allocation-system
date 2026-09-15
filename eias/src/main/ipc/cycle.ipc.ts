import { ipcMain } from "electron"
import { db } from "../db/database"

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
  ipcMain.handle("cycle:createSessions", async (_, cycleId, sessions) => {
    return db.runTransaction(() => {
      db.run("DELETE FROM exam_sessions WHERE cycle_id=?", [cycleId])
      sessions.forEach((s: any, i: number) => {
        db.run(
          "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
          [cycleId, s.exam_date, s.session_type, i+1, s.reporting_time??null, s.exam_start??null, s.exam_end??null, "pending"]
        )
      })
      return db.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
    })
  })
  ipcMain.handle("cycle:updateSession", async (_, id, data) => {
    db.run(
      "UPDATE exam_sessions SET reporting_time=?,exam_start=?,exam_end=?,status=?,updated_at=datetime('now') WHERE id=?",
      [data.reporting_time??null, data.exam_start??null, data.exam_end??null, data.status, id]
    )
    return db.queryOne("SELECT * FROM exam_sessions WHERE id=?", [id])
  })
}
