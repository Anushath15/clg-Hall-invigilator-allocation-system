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
      const seen = new Set<string>()
      let step = 1
      for (const s of sessions) {
        const key = `${s.exam_date}_${s.session_type}`
        if (seen.has(key)) continue
        seen.add(key)
        db.run(
          "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
          [cycleId, s.exam_date, s.session_type, step++, s.reporting_time??null, s.exam_start??null, s.exam_end??null, "pending"]
        )
      }
      return db.query("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cycleId])
    })
  })
  ipcMain.handle("cycle:updateSession", async (_, id, data) => {
    const current = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
    if (!current) return null
    const examDate = data.exam_date ?? current.exam_date
    const sessionType = data.session_type ?? current.session_type

    // Check for duplicate session date and slot within the same cycle
    const conflict = db.queryOne<any>(
      "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=? AND id!=?",
      [current.cycle_id, examDate, sessionType, id]
    )
    if (conflict) {
      throw new Error(`A ${sessionType === "FN" ? "Forenoon (FN)" : "Afternoon (AN)"} session already exists for ${examDate} in this cycle.`)
    }

    const reportingTime = data.reporting_time !== undefined ? data.reporting_time : current.reporting_time
    const examStart = data.exam_start !== undefined ? data.exam_start : current.exam_start
    const examEnd = data.exam_end !== undefined ? data.exam_end : current.exam_end
    const status = data.status ?? current.status
    const rotationStep = data.rotation_step !== undefined ? data.rotation_step : current.rotation_step

    db.run(
      "UPDATE exam_sessions SET exam_date=?,session_type=?,reporting_time=?,exam_start=?,exam_end=?,status=?,rotation_step=?,updated_at=datetime('now') WHERE id=?",
      [examDate, sessionType, reportingTime, examStart, examEnd, status, rotationStep, id]
    )
    return db.queryOne("SELECT * FROM exam_sessions WHERE id=?", [id])
  })
  ipcMain.handle("cycle:addSession", async (_, cycleId, data) => {
    // Check for duplicate session date and slot
    const exists = db.queryOne<any>(
      "SELECT id FROM exam_sessions WHERE cycle_id=? AND exam_date=? AND session_type=?",
      [cycleId, data.exam_date, data.session_type]
    )
    if (exists) {
      throw new Error(`A ${data.session_type === "FN" ? "Forenoon (FN)" : "Afternoon (AN)"} session already exists for ${data.exam_date} in this cycle.`)
    }

    const maxStep = db.queryOne<any>("SELECT MAX(rotation_step) as m FROM exam_sessions WHERE cycle_id=?", [cycleId])
    const step = (maxStep?.m ?? 0) + 1
    const { lastInsertRowid } = db.run(
      "INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
      [cycleId, data.exam_date, data.session_type, step, data.reporting_time??null, data.exam_start??null, data.exam_end??null, "pending"]
    )
    return db.queryOne("SELECT * FROM exam_sessions WHERE id=?", [lastInsertRowid])
  })
  ipcMain.handle("cycle:deleteSession", async (_, id) => {
    const session = db.queryOne<any>("SELECT * FROM exam_sessions WHERE id=?", [id])
    if (!session) return { success: false, error: "Session not found." }
    const hasAllocations = db.queryOne<any>("SELECT COUNT(*) as c FROM allocations WHERE session_id=?", [id])
    if (hasAllocations && hasAllocations.c > 0) {
      return { success: false, error: "Cannot delete session: allocations already exist." }
    }
    db.run("DELETE FROM exam_sessions WHERE id=?", [id])
    // Renumber remaining sessions in this cycle to maintain contiguous 1..N rotation_step
    const remaining = db.query<any>("SELECT id FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step, id", [session.cycle_id])
    remaining.forEach((s, idx) => {
      db.run("UPDATE exam_sessions SET rotation_step=? WHERE id=?", [idx + 1, s.id])
    })
    return { success: true }
  })
}
