/**
 * Reports list duties chronologically: by date, then Forenoon before Afternoon.
 * (A plain ORDER BY session_type would put "AN" before "FN".)
 */
import { describe, it, expect, beforeAll } from "vitest"
import { initDatabase, db } from "../db/database"
import { getStaffWiseReport, getRotationAuditReport } from "./report.service"

beforeAll(async () => {
  await initDatabase({ inMemory: true })
  db.run("INSERT INTO departments(id, code, name) VALUES(1, 'CSE', 'Computer Science')")
  for (const [id, staffId, name] of [[101, "S1", "Anitha"], [102, "S2", "Bala"]] as const) {
    db.run("INSERT INTO users(id, staff_id, name, role, department_id, is_active) VALUES(?,?,?,'staff',1,1)", [id, staffId, name])
  }
  db.run("INSERT INTO halls(id, hall_code, name) VALUES(1, 'H1', 'Hall 1'), (2, 'H2', 'Hall 2')")
  db.run("INSERT INTO exam_cycles(id, name, academic_year) VALUES(1, 'November', '2026-27')")
  // Inserted out of order on purpose: AN before FN on 01 Nov.
  const sessions = [[1, "2099-11-01", "AN", 2], [2, "2099-11-01", "FN", 1], [3, "2099-11-02", "FN", 3]] as const
  for (const [id, date, type, step] of sessions) {
    db.run("INSERT INTO exam_sessions(id, cycle_id, exam_date, session_type, rotation_step, status) VALUES(?,1,?,?,?,'confirmed')", [id, date, type, step])
    db.run("INSERT INTO allocations(session_id, user_id, hall_id) VALUES(?,101,?), (?,102,?)", [id, id % 2 + 1, id, (id + 1) % 2 + 1])
  }
})

const when = (r: any) => `${r.exam_date} ${r.session_type}`
const chronological = ["2099-11-01 FN", "2099-11-01 AN", "2099-11-02 FN"]

describe("Report order", () => {
  it("staff-wise: each person's duties FN before AN on the same day", () => {
    expect(getStaffWiseReport(101).map(when)).toEqual(chronological)
    expect(getStaffWiseReport().map(r => `${r.staff_id} ${when(r)}`)).toEqual([
      ...chronological.map(w => `S1 ${w}`), ...chronological.map(w => `S2 ${w}`),
    ])
  })

  it("rotation audit: FN before AN on the same day", () => {
    expect(getRotationAuditReport(1).map(when)).toEqual(chronological.flatMap(w => [w, w]))
  })
})
