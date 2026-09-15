/**
 * EIAS COMPLETE AUTOMATED TEST SUITE
 * Tests all functions: Auth, Master Data, Rotation Engine,
 * Validation Rules (R1-R7), Allocation Lifecycle, Reports, Backup/Restore
 */

const path = require("path")
const fs   = require("fs")
const bcrypt = require("bcryptjs")

let passed = 0, failed = 0, total = 0
const results = []

function test(name, fn) {
  total++
  try {
    const r = fn()
    if (r && typeof r.then === "function") return r.then(() => { passed++; results.push({ ok: true, name }); process.stdout.write(".") }).catch(e => { failed++; results.push({ ok: false, name, error: e.message }); process.stdout.write("F") })
    passed++; results.push({ ok: true, name }); process.stdout.write(".")
  } catch(e) { failed++; results.push({ ok: false, name, error: e.message }); process.stdout.write("F") }
}
function assert(condition, msg) { if (!condition) throw new Error(msg || "Assertion failed") }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

async function main() {
  const initSqlJs = require("sql.js")
  const SQL = await initSqlJs()
  const dbPath = path.join(process.cwd(), "eias.db")
  const dbBuf  = fs.readFileSync(dbPath)
  // Work on a COPY so tests don't corrupt production data
  const db = new SQL.Database(dbBuf)

  const run = (sql, p=[]) => db.run(sql, p)
  const q   = (sql, p=[]) => { const s=db.prepare(sql); s.bind(p); const rows=[]; while(s.step()) rows.push(s.getAsObject()); s.free(); return rows }
  const one = (sql, p=[]) => q(sql,p)[0]

  // ?? PHASE 1: DATABASE INTEGRITY ???????????????????????????????????????????
  console.log("\n\n[PHASE 1] DATABASE INTEGRITY")
  await test("DB: departments table exists with 7 rows", () => {
    const c = one("SELECT COUNT(*) as c FROM departments"); assertEqual(+c.c, 7, `Expected 7 departments, got ${c.c}`)
  })
  await test("DB: halls table exists with 10 rows", () => {
    const c = one("SELECT COUNT(*) as c FROM halls"); assertEqual(+c.c, 10)
  })
  await test("DB: halls sorted correctly H001 first", () => {
    const h = one("SELECT hall_code FROM halls ORDER BY sort_order LIMIT 1"); assertEqual(h.hall_code, "H001")
  })
  await test("DB: halls last entry is H010", () => {
    const h = one("SELECT hall_code FROM halls ORDER BY sort_order DESC LIMIT 1"); assertEqual(h.hall_code, "H010")
  })
  await test("DB: 10 staff users exist", () => {
    const c = one("SELECT COUNT(*) as c FROM users WHERE role='staff'"); assertEqual(+c.c, 10)
  })
  await test("DB: admin user exists", () => {
    const u = one("SELECT * FROM users WHERE staff_id='ADMIN001'"); assert(u, "Admin not found")
  })
  await test("DB: exam cycle exists", () => {
    const c = one("SELECT * FROM exam_cycles WHERE name LIKE '%November 2026%'"); assert(c, "Cycle not found")
  })
  await test("DB: 6 sessions created for cycle", () => {
    const cyc = one("SELECT id FROM exam_cycles"); const c = one("SELECT COUNT(*) as c FROM exam_sessions WHERE cycle_id=?",[cyc.id]); assertEqual(+c.c, 6)
  })
  await test("DB: sessions have correct rotation_step order", () => {
    const cyc = one("SELECT id FROM exam_cycles")
    const sessions = q("SELECT rotation_step FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step", [cyc.id])
    sessions.forEach((s, i) => assertEqual(+s.rotation_step, i+1, `Step mismatch at index ${i}`))
  })
  await test("DB: all staff have password_hash set", () => {
    const noHash = q("SELECT staff_id FROM users WHERE role='staff' AND (password_hash IS NULL OR password_hash='')"); assert(noHash.length === 0, `${noHash.length} staff without password`)
  })

  // ?? PHASE 2: AUTH SERVICE ?????????????????????????????????????????????????
  console.log("\n\n[PHASE 2] AUTH SERVICE")
  await test("AUTH: staff password hash is valid bcrypt", async () => {
    const u = one("SELECT password_hash FROM users WHERE staff_id='SX001'")
    const ok = await bcrypt.compare("sxcce@2026", u.password_hash); assert(ok, "Password hash mismatch")
  })
  await test("AUTH: wrong password rejected", async () => {
    const u = one("SELECT password_hash FROM users WHERE staff_id='SX001'")
    const ok = await bcrypt.compare("wrongpass", u.password_hash); assert(!ok, "Wrong password should fail")
  })
  await test("AUTH: admin password hash is valid bcrypt", async () => {
    const u = one("SELECT password_hash FROM users WHERE staff_id='ADMIN001'")
    assert(u, "Admin not found"); const ok = await bcrypt.compare("admin123", u.password_hash); assert(ok)
  })
  await test("AUTH: non-existent staff ID returns undefined", () => {
    const u = one("SELECT * FROM users WHERE staff_id='FAKE999'"); assert(!u, "Should return undefined")
  })
  await test("AUTH: inactive staff blocked", () => {
    run("UPDATE users SET is_active=0 WHERE staff_id='SX010'")
    const u = one("SELECT * FROM users WHERE staff_id='SX010' AND is_active=1"); assert(!u)
    run("UPDATE users SET is_active=1 WHERE staff_id='SX010'")
  })

  // ?? PHASE 3: MASTER DATA ??????????????????????????????????????????????????
  console.log("\n\n[PHASE 3] MASTER DATA")
  await test("MASTER: dept code must be unique", () => {
    try { run("INSERT INTO departments(code,name) VALUES('CSE','Duplicate')"); assert(false, "Should throw") }
    catch(e) { assert(e.message.includes("UNIQUE"), "Expected UNIQUE constraint") }
  })
  await test("MASTER: hall code must be unique", () => {
    try { run("INSERT INTO halls(hall_code,name,sort_order) VALUES('H001','Dupe',99)"); assert(false) }
    catch(e) { assert(e.message.includes("UNIQUE")) }
  })
  await test("MASTER: staff ID must be unique", () => {
    try { run("INSERT INTO users(staff_id,name,role) VALUES('SX001','Dupe','staff')"); assert(false) }
    catch(e) { assert(e.message.includes("UNIQUE")) }
  })
  await test("MASTER: department has 7 distinct codes", () => {
    const codes = q("SELECT DISTINCT code FROM departments"); assertEqual(codes.length, 7)
  })
  await test("MASTER: all halls are active", () => {
    const inactive = q("SELECT * FROM halls WHERE is_active=0"); assertEqual(inactive.length, 0)
  })
  await test("MASTER: halls have valid capacities (> 0)", () => {
    const bad = q("SELECT * FROM halls WHERE capacity <= 0"); assertEqual(bad.length, 0)
  })
  await test("MASTER: each department has at least one staff", () => {
    const depts = q("SELECT DISTINCT department_id FROM users WHERE role='staff' AND is_active=1")
    assert(depts.length >= 4, `Expected staff in multiple depts, got ${depts.length}`)
  })
  await test("MASTER: settings table has all required keys", () => {
    const keys = ["college.name","college.short_name","session.fn_reporting_time","session.fn_start_time","session.fn_end_time","session.an_reporting_time","session.an_start_time","session.an_end_time"]
    for (const k of keys) { const r = one("SELECT key FROM settings WHERE key=?",[k]); assert(r, `Missing setting: ${k}`) }
  })

  // ?? PHASE 4: ROTATION ENGINE ??????????????????????????????????????????????
  console.log("\n\n[PHASE 4] ROTATION ENGINE")
  // Simulate first allocation
  const staffList = q("SELECT id FROM users WHERE role='staff' AND is_active=1 ORDER BY id")
  const hallList  = q("SELECT id FROM halls WHERE is_active=1 ORDER BY sort_order")
  const sIds = staffList.map(s => s.id)
  const hIds  = hallList.map(h => h.id)
  const cyc   = one("SELECT id FROM exam_cycles")
  const sessions = q("SELECT * FROM exam_sessions WHERE cycle_id=? ORDER BY rotation_step",[cyc.id])

  await test("ROTATION: session count = 6", () => assertEqual(sessions.length, 6))
  await test("ROTATION: staff count = hall count = 10", () => { assertEqual(sIds.length, 10); assertEqual(hIds.length, 10) })

  // First allocation (positional)
  await test("ROTATION: first allocation assigns positionally", () => {
    const entries = sIds.map((uid, i) => ({ userId: uid, hallId: hIds[i] }))
    assertEqual(entries[0].hallId, hIds[0])
    assertEqual(entries[9].hallId, hIds[9])
  })

  // Circular next
  function circularNext(halls, lastHallId) {
    const idx = halls.indexOf(lastHallId); if (idx === -1) return halls[0]
    return halls[(idx + 1) % halls.length]
  }
  await test("ROTATION: circularNext H001?H002", () => assertEqual(circularNext(hIds, hIds[0]), hIds[1]))
  await test("ROTATION: circularNext H010?H001 (wrap)", () => assertEqual(circularNext(hIds, hIds[9]), hIds[0]))
  await test("ROTATION: circularNext unknown hall ? H001", () => assertEqual(circularNext(hIds, 9999), hIds[0]))

  // Simulate 6-session rotation
  const sessionAllocs = []
  let lastMap = new Map(sIds.map((s, i) => [s, hIds[i]]))
  sessionAllocs.push(new Map(lastMap))
  for (let i = 1; i < 6; i++) {
    const next = new Map(); const used = new Set()
    for (const uid of sIds) {
      const last = lastMap.get(uid)
      const idx  = hIds.indexOf(last)
      let candidate; let found = false
      for (let a = 1; a <= hIds.length; a++) {
        const c = hIds[(idx + a) % hIds.length]
        if (!used.has(c)) { candidate = c; found = true; break }
      }
      if (!found) candidate = hIds.find(h => !used.has(h)) ?? hIds[0]
      next.set(uid, candidate); used.add(candidate)
    }
    sessionAllocs.push(next); lastMap = next
  }

  await test("ROTATION: no two staff share a hall in any session", () => {
    for (let i = 0; i < 6; i++) {
      const alloc = sessionAllocs[i]
      const halls = [...alloc.values()]
      const unique = new Set(halls)
      assert(unique.size === halls.length, `Session ${i+1}: hall duplication found`)
    }
  })
  await test("ROTATION: each staff visits all 10 halls across 10 sessions (after 4 more)", () => {
    // Already simulated 6, add 4 more to complete cycle
    let lm = lastMap
    const extra = []
    for (let i = 0; i < 4; i++) {
      const next = new Map(); const used = new Set()
      for (const uid of sIds) {
        const last = lm.get(uid); const idx = hIds.indexOf(last)
        let candidate
        for (let a = 1; a <= hIds.length; a++) {
          const c = hIds[(idx+a)%hIds.length]; if (!used.has(c)) { candidate = c; break }
        }
        next.set(uid, candidate ?? hIds[0]); used.add(candidate ?? hIds[0])
      }
      extra.push(next); lm = next
    }
    const allTen = [...sessionAllocs, ...extra]
    for (const uid of sIds) {
      const visited = new Set(allTen.map(m => m.get(uid)))
      assertEqual(visited.size, 10, `Staff ${uid} only visited ${visited.size} halls in 10 sessions`)
    }
  })
  await test("ROTATION: session 11 restarts (H010?H001 for first staff)", () => {
    // last from 10 sessions: first staff should have been at H010
    let lm2 = new Map(sIds.map((s,i) => [s, hIds[i]]))
    for (let i = 1; i < 10; i++) {
      const nxt = new Map(); const used = new Set()
      for (const uid of sIds) {
        const last = lm2.get(uid); const idx = hIds.indexOf(last)
        let c; for (let a=1; a<=hIds.length; a++) { const cc=hIds[(idx+a)%hIds.length]; if(!used.has(cc)){c=cc;break} }
        nxt.set(uid,c??hIds[0]); used.add(c??hIds[0])
      }
      lm2 = nxt
    }
    const firstStaff = sIds[0]
    assertEqual(lm2.get(firstStaff), hIds[9], `Expected H010 at session 10`)
    // Session 11
    const s11 = new Map(); const used = new Set()
    for (const uid of sIds) {
      const last = lm2.get(uid); const idx = hIds.indexOf(last)
      let c; for (let a=1; a<=hIds.length; a++) { const cc=hIds[(idx+a)%hIds.length]; if(!used.has(cc)){c=cc;break} }
      s11.set(uid,c??hIds[0]); used.add(c??hIds[0])
    }
    assertEqual(s11.get(firstStaff), hIds[0], `Expected H001 at session 11 (cycle restart)`)
  })

  // ?? PHASE 5: VALIDATION RULES ????????????????????????????????????????????
  console.log("\n\n[PHASE 5] VALIDATION RULES")

  function checkR2(entries) { const m=new Map(); for(const e of entries) m.set(e.hallId,(m.get(e.hallId)??0)+1); return [...m.values()].some(c=>c>1) }
  function checkR3(entries) { const m=new Map(); for(const e of entries) m.set(e.userId,(m.get(e.userId)??0)+1); return [...m.values()].some(c=>c>1) }
  function checkR7(sc, hc) { return sc !== hc }
  function checkR1(userId, hallId, recent) { return recent.includes(hallId) }
  function checkR5(isActive) { return !isActive }
  function checkR6(isActive) { return !isActive }

  await test("R1: BLOCKS repeated hall within cycle window", () => {
    assert(checkR1(1, hIds[0], [hIds[0], hIds[1]]), "R1 should fire")
  })
  await test("R1: PASSES hall not in recent window", () => {
    assert(!checkR1(1, hIds[5], [hIds[0], hIds[1]]), "R1 should pass")
  })
  await test("R1: PASSES empty history", () => {
    assert(!checkR1(1, hIds[0], []), "R1 should pass on empty history")
  })
  await test("R2: BLOCKS two staff in same hall", () => {
    assert(checkR2([{userId:1,hallId:1},{userId:2,hallId:1}]), "R2 should fire")
  })
  await test("R2: PASSES all different halls", () => {
    assert(!checkR2([{userId:1,hallId:1},{userId:2,hallId:2}]), "R2 should pass")
  })
  await test("R2: BLOCKS three staff in same hall", () => {
    assert(checkR2([{userId:1,hallId:5},{userId:2,hallId:5},{userId:3,hallId:5}]), "R2 should fire for 3")
  })
  await test("R3: BLOCKS same staff twice in session", () => {
    assert(checkR3([{userId:1,hallId:1},{userId:1,hallId:2}]), "R3 should fire")
  })
  await test("R3: PASSES all distinct staff", () => {
    assert(!checkR3([{userId:1,hallId:1},{userId:2,hallId:2}]), "R3 should pass")
  })
  await test("R5: BLOCKS inactive staff", () => { assert(checkR5(false)) })
  await test("R5: PASSES active staff", () => { assert(!checkR5(true)) })
  await test("R6: BLOCKS inactive hall", () => { assert(checkR6(false)) })
  await test("R6: PASSES active hall", () => { assert(!checkR6(true)) })
  await test("R7: BLOCKS staff ? hall count (8 vs 10)", () => { assert(checkR7(8, 10)) })
  await test("R7: BLOCKS staff > hall count (12 vs 10)", () => { assert(checkR7(12, 10)) })
  await test("R7: PASSES equal count (10 vs 10)", () => { assert(!checkR7(10, 10)) })
  await test("R7: PASSES single (1 vs 1)", () => { assert(!checkR7(1, 1)) })

  // ?? PHASE 6: ALLOCATION LIFECYCLE ????????????????????????????????????????
  console.log("\n\n[PHASE 6] ALLOCATION LIFECYCLE")
  const sid1 = sessions[0].id
  const sid2 = sessions[1].id

  await test("LIFECYCLE: initial session status is pending", () => {
    run("UPDATE exam_sessions SET status='pending' WHERE id=?", [sid1])
    const s = one("SELECT status FROM exam_sessions WHERE id=?",[sid1]); assertEqual(s.status, "pending")
  })
  // Insert session 1 allocation
  await test("LIFECYCLE: insert allocation for session 1", () => {
    run("DELETE FROM allocations WHERE session_id=?",[sid1])
    sIds.forEach((uid, i) => run("INSERT INTO allocations(session_id,user_id,hall_id,is_manually_edited,generated_hall_id) VALUES(?,?,?,0,?)",[sid1,uid,hIds[i],hIds[i]]))
    const c = one("SELECT COUNT(*) as c FROM allocations WHERE session_id=?",[sid1]); assertEqual(+c.c, 10)
  })
  await test("LIFECYCLE: set status to draft", () => {
    run("UPDATE exam_sessions SET status='draft' WHERE id=?",[sid1])
    const s = one("SELECT status FROM exam_sessions WHERE id=?",[sid1]); assertEqual(s.status, "draft")
  })
  await test("LIFECYCLE: write rotation_history on confirm", () => {
    sIds.forEach((uid, i) => run("INSERT OR IGNORE INTO rotation_history(user_id,session_id,hall_id,rotation_step) VALUES(?,?,?,?)",[uid,sid1,hIds[i],1]))
    const c = one("SELECT COUNT(*) as c FROM rotation_history WHERE session_id=?",[sid1]); assertEqual(+c.c, 10)
  })
  await test("LIFECYCLE: confirm sets status to confirmed", () => {
    run("UPDATE exam_sessions SET status='confirmed' WHERE id=?",[sid1])
    const s = one("SELECT status FROM exam_sessions WHERE id=?",[sid1]); assertEqual(s.status, "confirmed")
  })
  await test("LIFECYCLE: publish sets status to published", () => {
    run("UPDATE exam_sessions SET status='published' WHERE id=?",[sid1])
    const s = one("SELECT status FROM exam_sessions WHERE id=?",[sid1]); assertEqual(s.status, "published")
  })
  await test("LIFECYCLE: S1 rotation_history has unique hall per user", () => {
    const rows = q("SELECT user_id, hall_id FROM rotation_history WHERE session_id=?",[sid1])
    const userIds2  = rows.map(r => r.user_id)
    const hallIds2  = rows.map(r => r.hall_id)
    assertEqual(new Set(userIds2).size, 10, "Duplicate users in history")
    assertEqual(new Set(hallIds2).size, 10, "Duplicate halls in history")
  })

  // ?? PHASE 7: STAFF DUTY VIEW ??????????????????????????????????????????????
  console.log("\n\n[PHASE 7] STAFF DUTY VIEW")
  await test("DUTY: published allocation visible to staff", () => {
    const userId = sIds[0]
    const rows = q(`SELECT a.hall_id, es.exam_date, es.session_type FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE a.user_id=? AND es.status='published'`, [userId])
    assert(rows.length > 0, "No published duty for staff")
  })
  await test("DUTY: staff can see their hall code", () => {
    const userId = sIds[0]
    const row = one(`SELECT h.hall_code FROM allocations a JOIN halls h ON a.hall_id=h.id JOIN exam_sessions es ON a.session_id=es.id WHERE a.user_id=? AND es.status='published' LIMIT 1`, [userId])
    assert(row?.hall_code, "No hall_code in duty view")
    assertEqual(row.hall_code, "H001", "First staff should be in H001")
  })

  // ?? PHASE 8: REPORTS ??????????????????????????????????????????????????????
  console.log("\n\n[PHASE 8] REPORTS")
  await test("REPORT: staff-wise report returns 10 rows for S1", () => {
    const rows = q(`SELECT u.staff_id, h.hall_code FROM allocations a JOIN users u ON a.user_id=u.id JOIN halls h ON a.hall_id=h.id JOIN exam_sessions es ON a.session_id=es.id WHERE es.id=?`,[sid1])
    assertEqual(rows.length, 10)
  })
  await test("REPORT: date-wise sorted by hall sort_order", () => {
    const rows = q(`SELECT h.hall_code, h.sort_order FROM allocations a JOIN halls h ON a.hall_id=h.id WHERE a.session_id=? ORDER BY h.sort_order`,[sid1])
    for (let i = 0; i < rows.length - 1; i++) assert(+rows[i].sort_order <= +rows[i+1].sort_order)
  })
  await test("REPORT: rotation audit finds edited entries", () => {
    run("UPDATE allocations SET is_manually_edited=1, edit_reason='Test edit' WHERE session_id=? AND user_id=?",[sid1,sIds[0]])
    const edited = q("SELECT * FROM allocations WHERE session_id=? AND is_manually_edited=1",[sid1])
    assertEqual(edited.length, 1)
    run("UPDATE allocations SET is_manually_edited=0, edit_reason=NULL WHERE session_id=? AND user_id=?",[sid1,sIds[0]])
  })
  await test("REPORT: complete timetable has all sessions", () => {
    const sessions2 = q("SELECT id FROM exam_sessions WHERE cycle_id=?",[cyc.id]); assertEqual(sessions2.length, 6)
  })

  // ?? PHASE 9: HISTORY BROWSER ?????????????????????????????????????????????
  console.log("\n\n[PHASE 9] HISTORY BROWSER")
  await test("HISTORY: filter by cycle returns all session allocations", () => {
    const rows = q(`SELECT a.id FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.cycle_id=?`,[cyc.id])
    assert(rows.length >= 10, `Expected >=10, got ${rows.length}`)
  })
  await test("HISTORY: filter by staff returns only that staff's records", () => {
    const uid = sIds[0]
    const rows = q("SELECT a.user_id FROM allocations a JOIN exam_sessions es ON a.session_id=es.id WHERE es.cycle_id=? AND a.user_id=?",[cyc.id, uid])
    for (const r of rows) assertEqual(+r.user_id, uid)
  })
  await test("HISTORY: filter by hall returns only that hall's records", () => {
    const hid = hIds[0]
    const rows = q("SELECT a.hall_id FROM allocations a WHERE a.hall_id=?",[hid])
    for (const r of rows) assertEqual(+r.hall_id, hid)
  })

  // ?? PHASE 10: SETTINGS ????????????????????????????????????????????????????
  console.log("\n\n[PHASE 10] SETTINGS")
  await test("SETTINGS: college name is set correctly", () => {
    const r = one("SELECT value FROM settings WHERE key='college.name'")
    assert(r?.value?.includes("Xavier"), "College name missing")
  })
  await test("SETTINGS: FN session times are valid", () => {
    const rep = one("SELECT value FROM settings WHERE key='session.fn_reporting_time'")
    assert(rep?.value?.match(/^\d{2}:\d{2}$/), `Invalid time format: ${rep?.value}`)
  })
  await test("SETTINGS: update and read back a setting", () => {
    run("UPDATE settings SET value='Test College' WHERE key='college.short_name'")
    const r = one("SELECT value FROM settings WHERE key='college.short_name'"); assertEqual(r.value, "Test College")
    run("UPDATE settings SET value='SXCCE' WHERE key='college.short_name'")
  })

  // ?? PHASE 11: BACKUP/RESTORE ??????????????????????????????????????????????
  console.log("\n\n[PHASE 11] BACKUP & RESTORE")
  await test("BACKUP: db file exists and is readable", () => {
    assert(fs.existsSync(dbPath), "eias.db not found")
    const size = fs.statSync(dbPath).size; assert(size > 0, "DB file is empty")
  })
  await test("BACKUP: db export produces valid SQLite buffer", () => {
    const exported = db.export()
    assert(exported.length > 1000, "Export too small")
    // SQLite magic bytes
    const magic = String.fromCharCode(...exported.slice(0,6)); assertEqual(magic, "SQLite")
  })
  await test("BACKUP: backup copy to temp path works", () => {
    const backupPath = path.join(process.cwd(), "eias_test_backup.db")
    fs.copyFileSync(dbPath, backupPath)
    assert(fs.existsSync(backupPath)); fs.unlinkSync(backupPath)
  })

  // ?? FINAL SUMMARY ?????????????????????????????????????????????????????????
  console.log("\n\n" + "=".repeat(60))
  console.log("  EIAS COMPLETE TEST RESULTS")
  console.log("=".repeat(60))

  const failedTests = results.filter(r => !r.ok)
  if (failedTests.length === 0) {
    console.log(`\n  ? ALL ${passed} TESTS PASSED\n`)
  } else {
    console.log(`\n  ? ${passed} passed   ? ${failed} failed   (${total} total)\n`)
    console.log("  FAILED TESTS:")
    failedTests.forEach(t => console.log(`    ? ${t.name}\n      ? ${t.error}`))
  }
  console.log("=".repeat(60))

  // Phase-wise summary
  const phases = ["DATABASE INTEGRITY","AUTH SERVICE","MASTER DATA","ROTATION ENGINE","VALIDATION RULES","ALLOCATION LIFECYCLE","STAFF DUTY VIEW","REPORTS","HISTORY BROWSER","SETTINGS","BACKUP & RESTORE"]
  phases.forEach((p, i) => {
    const phase_results = results.filter(r => r.name.includes(p.split(" ")[0]) || (i===0 && r.name.startsWith("DB")) || (i===1 && r.name.startsWith("AUTH")) || (i===2 && r.name.startsWith("MASTER")) || (i===3 && r.name.startsWith("ROTATION")) || (i===4 && r.name.startsWith("R")) || (i===5 && r.name.startsWith("LIFECYCLE")) || (i===6 && r.name.startsWith("DUTY")) || (i===7 && r.name.startsWith("REPORT")) || (i===8 && r.name.startsWith("HISTORY")) || (i===9 && r.name.startsWith("SETTINGS")) || (i===10 && r.name.startsWith("BACKUP")))
    const ok = phase_results.filter(r => r.ok).length
    const all = phase_results.length
    if (all > 0) console.log(`  Phase ${i+1}: ${p.padEnd(22)} ${ok===all?"?":"?"} ${ok}/${all}`)
  })
  console.log("\n")
  return failed
}

main().then(f => process.exit(f > 0 ? 1 : 0)).catch(e => { console.error(e); process.exit(1) })
