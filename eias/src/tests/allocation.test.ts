/**
 * EIAS Vitest Test Suite
 * Tests round-robin engine, validation rules R1-R7, and lifecycle.
 * Run with: npm run test
 */
import { describe, it, expect, beforeEach } from "vitest"
import initSqlJs from "sql.js"

let db: any

const run = (sql: string, p: any[] = []) => db.run(sql, p)
const q = (sql: string, p: any[] = []): any[] => {
  const s = db.prepare(sql); s.bind(p)
  const rows: any[] = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows
}
const one = (sql: string, p: any[] = []) => q(sql, p)[0]

function setupSchema() {
  run(`CREATE TABLE departments (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL)`)
  run(`CREATE TABLE halls (id INTEGER PRIMARY KEY AUTOINCREMENT, hall_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1)`)
  run(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT DEFAULT 'staff', is_active INTEGER DEFAULT 1, department_id INTEGER)`)
  run(`CREATE TABLE exam_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, academic_year TEXT NOT NULL, status TEXT DEFAULT 'draft')`)
  run(`CREATE TABLE exam_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL, exam_date TEXT NOT NULL, session_type TEXT NOT NULL, rotation_step INTEGER NOT NULL, status TEXT DEFAULT 'pending')`)
  run(`CREATE TABLE allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, user_id INTEGER NOT NULL, hall_id INTEGER NOT NULL, is_manually_edited INTEGER DEFAULT 0, edit_reason TEXT, generated_hall_id INTEGER, UNIQUE(session_id, user_id), UNIQUE(session_id, hall_id))`)
  run(`CREATE TABLE rotation_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, session_id INTEGER NOT NULL, hall_id INTEGER NOT NULL, rotation_step INTEGER NOT NULL, global_order INTEGER, recorded_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, session_id))`)
  run(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, description TEXT, payload TEXT, created_at TEXT DEFAULT (datetime('now')))`)
  run(`CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, session_id INTEGER, is_read INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
}

function seedBaseData() {
  run("INSERT INTO departments(code,name) VALUES('CSE','Computer Science')")
  run("INSERT INTO halls(hall_code,name,sort_order) VALUES('H1','Hall 1',1),('H2','Hall 2',2),('H3','Hall 3',3)")
  run("INSERT INTO users(staff_id,name,department_id) VALUES('U1','Alice',1),('U2','Bob',1),('U3','Carol',1)")
  run("INSERT INTO exam_cycles(name,academic_year) VALUES('Test Cycle','2026-27')")
}

function computeNextHall(userId: number, hallIds: number[], alreadyAssigned: Set<number>): number {
  const lastRecord = one("SELECT hall_id FROM rotation_history WHERE user_id = ? ORDER BY COALESCE(global_order,0) DESC, id DESC LIMIT 1", [userId])
  if (!lastRecord) {
    const firstFree = hallIds.find(h => !alreadyAssigned.has(h))
    return firstFree !== undefined ? firstFree : hallIds[0]
  }
  const lastIdx = hallIds.indexOf(lastRecord.hall_id)
  if (lastIdx === -1) {
    return hallIds.find(h => !alreadyAssigned.has(h)) ?? hallIds[0]
  }
  for (let a = 1; a <= hallIds.length; a++) {
    const c = hallIds[(lastIdx + a) % hallIds.length]
    if (!alreadyAssigned.has(c)) return c
  }
  return hallIds[0]
}

function generateRotation(userIds: number[], hallIds: number[]): Map<number, number> {
  if (userIds.length !== hallIds.length) throw new Error("Staff count must equal hall count")
  const withHistory: number[] = [], withoutHistory: number[] = []
  for (const uid of userIds) {
    one("SELECT id FROM rotation_history WHERE user_id = ? LIMIT 1", [uid]) ? withHistory.push(uid) : withoutHistory.push(uid)
  }
  const assignedMap = new Map<number, number>()
  const assignedHalls = new Set<number>()
  for (const uid of [...withHistory, ...withoutHistory]) {
    const hall = computeNextHall(uid, hallIds, assignedHalls)
    assignedMap.set(uid, hall); assignedHalls.add(hall)
  }
  return assignedMap
}

function confirmSession(sessionId: number, assignedMap: Map<number, number>, step: number) {
  const maxRow = one("SELECT MAX(global_order) as m FROM rotation_history")
  let nextOrder = (maxRow?.m ?? 0) + 1
  for (const [uid, hallId] of assignedMap) {
    const ex = one("SELECT id FROM rotation_history WHERE user_id = ? AND session_id = ?", [uid, sessionId])
    if (ex) {
      run("UPDATE rotation_history SET hall_id=?,rotation_step=? WHERE id=?", [hallId, step, ex.id])
    } else {
      run("INSERT INTO rotation_history(user_id,session_id,hall_id,rotation_step,global_order) VALUES(?,?,?,?,?)", [uid, sessionId, hallId, step, nextOrder++])
    }
  }
  run("UPDATE exam_sessions SET status='confirmed' WHERE id=?", [sessionId])
}

function getIds() {
  const halls = q("SELECT id FROM halls ORDER BY sort_order").map(r => r.id as number)
  const users = q("SELECT id FROM users").map(r => r.id as number)
  const cycle = one("SELECT id FROM exam_cycles")!.id as number
  return { halls, users, cycle }
}

function createSession(cycleId: number, step: number): number {
  run("INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step) VALUES(?,?,?,?)", [cycleId, `2026-11-0${step}`, "FN", step])
  return one("SELECT last_insert_rowid() as id").id as number
}

describe("Round-Robin Engine", () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    setupSchema(); seedBaseData()
  })

  it("Session 1: no duplicates, all 3 halls assigned", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    const assigned = generateRotation(users, halls)
    expect(new Set(assigned.values()).size).toBe(3)
    expect(assigned.size).toBe(3)
    confirmSession(s1, assigned, 1)
  })

  it("Session 2: circular advance — each staff moves to next hall", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    const s1map = new Map([[users[0],halls[0]],[users[1],halls[1]],[users[2],halls[2]]])
    confirmSession(s1, s1map, 1)

    const s2 = createSession(cycle, 2)
    const s2map = generateRotation(users, halls)
    expect(s2map.get(users[0])).toBe(halls[1]) // H1→H2
    expect(s2map.get(users[1])).toBe(halls[2]) // H2→H3
    expect(s2map.get(users[2])).toBe(halls[0]) // H3→H1 wrap
    expect(new Set(s2map.values()).size).toBe(3)
  })

  it("Session 3: rotation continues from session 2", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    confirmSession(s1, new Map([[users[0],halls[0]],[users[1],halls[1]],[users[2],halls[2]]]), 1)
    const s2 = createSession(cycle, 2)
    confirmSession(s2, generateRotation(users, halls), 2)
    const s3 = createSession(cycle, 3)
    const s3map = generateRotation(users, halls)
    expect(s3map.get(users[0])).toBe(halls[2])
    expect(s3map.get(users[1])).toBe(halls[0])
    expect(s3map.get(users[2])).toBe(halls[1])
    expect(new Set(s3map.values()).size).toBe(3)
  })

  it("Full cycle wrap: after N sessions, staff returns to original hall", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    confirmSession(s1, new Map([[users[0],halls[0]],[users[1],halls[1]],[users[2],halls[2]]]), 1)
    const s2 = createSession(cycle, 2); confirmSession(s2, generateRotation(users, halls), 2)
    const s3 = createSession(cycle, 3); confirmSession(s3, generateRotation(users, halls), 3)
    const s4 = createSession(cycle, 4)
    const s4map = generateRotation(users, halls)
    expect(s4map.get(users[0])).toBe(halls[0])
    expect(new Set(s4map.values()).size).toBe(3)
  })

  it("New staff fills remaining halls without duplicates", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    confirmSession(s1, new Map([[users[0],halls[0]]]), 1) // only user 0 has history

    const s2 = createSession(cycle, 2)
    const assigned = generateRotation(users, halls)
    expect(assigned.get(users[0])).toBe(halls[1]) // advances from H1→H2
    expect(new Set(assigned.values()).size).toBe(3)
  })

  it("Throws when staff count != hall count", () => {
    const { users } = getIds()
    expect(() => generateRotation(users, [1, 2])).toThrow("Staff count must equal hall count")
  })
})

describe("Validation Rules", () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    setupSchema(); seedBaseData()
  })

  it("R2: DB rejects duplicate hall in same session", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[0], halls[0]])
    expect(() => run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[1], halls[0]])).toThrow()
  })

  it("R3: DB rejects duplicate staff in same session", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[0], halls[0]])
    expect(() => run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[0], halls[1]])).toThrow()
  })

  it("R5: Inactive staff is flagged in DB", () => {
    const { users } = getIds()
    run("UPDATE users SET is_active=0 WHERE id=?", [users[0]])
    expect(one("SELECT is_active FROM users WHERE id=?", [users[0]]).is_active).toBe(0)
  })

  it("R6: Inactive hall is flagged in DB", () => {
    const { halls } = getIds()
    run("UPDATE halls SET is_active=0 WHERE id=?", [halls[0]])
    expect(one("SELECT is_active FROM halls WHERE id=?", [halls[0]]).is_active).toBe(0)
  })

  it("R7: Engine throws if staff != halls", () => {
    const { users } = getIds()
    expect(() => generateRotation(users, [1, 2])).toThrow()
  })

  it("R1: No staff assigned same hall within N sessions", () => {
    const { halls, users, cycle } = getIds()
    const s1 = createSession(cycle, 1)
    confirmSession(s1, new Map([[users[0],halls[0]],[users[1],halls[1]],[users[2],halls[2]]]), 1)
    const s2 = createSession(cycle, 2)
    const s2map = generateRotation(users, halls)
    expect(s2map.get(users[0])).not.toBe(halls[0])
    confirmSession(s2, s2map, 2)
    const s3 = createSession(cycle, 3)
    const s3map = generateRotation(users, halls)
    expect(s3map.get(users[0])).not.toBe(halls[0])
    expect(s3map.get(users[0])).not.toBe(halls[1])
  })
})

describe("Allocation Lifecycle", () => {
  beforeEach(async () => {
    const SQL = await initSqlJs()
    db = new SQL.Database()
    setupSchema(); seedBaseData()
  })

  it("Status transitions: pending → draft → confirmed → published", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("pending")

    for (let i = 0; i < users.length; i++) {
      run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[i], halls[i]])
    }
    run("UPDATE exam_sessions SET status='draft' WHERE id=?", [s])
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("draft")

    const assignedMap = new Map(users.map((uid, i) => [uid, halls[i]] as [number, number]))
    confirmSession(s, assignedMap, 1)
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("confirmed")
    expect(q("SELECT id FROM rotation_history WHERE session_id=?", [s]).length).toBe(3)

    run("UPDATE exam_sessions SET status='published' WHERE id=?", [s])
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("published")
  })

  it("Manual edit preserves generated_hall_id and sets is_manually_edited", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    run("INSERT INTO allocations(session_id,user_id,hall_id,generated_hall_id) VALUES(?,?,?,?)", [s, users[0], halls[0], halls[0]])
    run("UPDATE allocations SET hall_id=?,is_manually_edited=1,edit_reason='Override' WHERE session_id=? AND user_id=?", [halls[1], s, users[0]])
    const a = one("SELECT * FROM allocations WHERE session_id=? AND user_id=?", [s, users[0]])
    expect(a.hall_id).toBe(halls[1])
    expect(a.generated_hall_id).toBe(halls[0])
    expect(a.is_manually_edited).toBe(1)
  })

  it("Audit log stores entries correctly", () => {
    run("INSERT INTO audit_log(user_id,action,description) VALUES(1,'LOGIN','Admin logged in')")
    const entry = one("SELECT * FROM audit_log WHERE action='LOGIN'")
    expect(entry).toBeTruthy()
    expect(entry.description).toBe("Admin logged in")
  })

  it("Rotation history records confirmed session assignments", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    const assignedMap = new Map([[users[0],halls[0]],[users[1],halls[1]],[users[2],halls[2]]])
    confirmSession(s, assignedMap, 1)
    const hist = q("SELECT * FROM rotation_history WHERE session_id=?", [s])
    expect(hist.length).toBe(3)
    for (const h of hist) {
      expect(h.global_order).toBeGreaterThan(0)
    }
  })

  it("Reopen session resets status to draft, clears rotation_history, and enables regeneration", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    const assignedMap = new Map([[users[0], halls[0]], [users[1], halls[1]], [users[2], halls[2]]])
    confirmSession(s, assignedMap, 1)
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("confirmed")
    expect(q("SELECT id FROM rotation_history WHERE session_id=?", [s]).length).toBe(3)

    // Reopen logic
    run("DELETE FROM rotation_history WHERE session_id=?", [s])
    run("UPDATE allocations SET is_manually_edited=0, edit_reason=NULL WHERE session_id=?", [s])
    run("UPDATE exam_sessions SET status='draft' WHERE id=?", [s])

    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("draft")
    expect(q("SELECT id FROM rotation_history WHERE session_id=?", [s]).length).toBe(0)

    // Can re-confirm
    const newAssigned = new Map([[users[0], halls[1]], [users[1], halls[2]], [users[2], halls[0]]])
    confirmSession(s, newAssigned, 1)
    expect(one("SELECT status FROM exam_sessions WHERE id=?", [s]).status).toBe("confirmed")
    expect(q("SELECT id FROM rotation_history WHERE session_id=?", [s]).length).toBe(3)
  })

  it("In-app notifications are created for staff when allocation is published", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    for (let i = 0; i < users.length; i++) {
      run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[i], halls[i]])
    }
    // Simulate notification creation
    for (let i = 0; i < users.length; i++) {
      run(
        "INSERT INTO notifications(user_id, title, message, session_id) VALUES(?,?,?,?)",
        [users[i], "New Exam Duty Published", `Duty in Hall H${i+1}`, s]
      )
    }
    const user0Notes = q("SELECT * FROM notifications WHERE user_id=?", [users[0]])
    expect(user0Notes.length).toBe(1)
    expect(user0Notes[0].is_read).toBe(0)

    // Mark as read
    run("UPDATE notifications SET is_read=1 WHERE id=?", [user0Notes[0].id])
    expect(one("SELECT is_read FROM notifications WHERE id=?", [user0Notes[0].id]).is_read).toBe(1)
  })

  it("Deleting all cycles wipes cycle & allocation data while preserving staff, halls, departments", () => {
    const { halls, users, cycle } = getIds()
    const s = createSession(cycle, 1)
    for (let i = 0; i < users.length; i++) {
      run("INSERT INTO allocations(session_id,user_id,hall_id) VALUES(?,?,?)", [s, users[i], halls[i]])
    }
    confirmSession(s, new Map([[users[0], halls[0]], [users[1], halls[1]], [users[2], halls[2]]]), 1)

    // Execute wipe
    run("DELETE FROM allocations")
    run("DELETE FROM rotation_history")
    run("DELETE FROM notifications")
    run("DELETE FROM exam_sessions")
    run("DELETE FROM exam_cycles")

    expect(q("SELECT * FROM exam_cycles").length).toBe(0)
    expect(q("SELECT * FROM exam_sessions").length).toBe(0)
    expect(q("SELECT * FROM allocations").length).toBe(0)
    expect(q("SELECT * FROM rotation_history").length).toBe(0)
    expect(q("SELECT * FROM notifications").length).toBe(0)

    // Users, halls, and departments preserved
    expect(q("SELECT * FROM users").length).toBe(3)
    expect(q("SELECT * FROM halls").length).toBe(3)
    expect(q("SELECT * FROM departments").length).toBe(1)
  })
})
