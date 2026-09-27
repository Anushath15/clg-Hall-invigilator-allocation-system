const path = require("path")
const fs   = require("fs")
const bcrypt = require("bcryptjs")

async function seed() {
  const initSqlJs = require("sql.js")
  const SQL = await initSqlJs()
  const dbPath = path.join(process.cwd(), "eias.db")
  let db
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath))
    console.log("Loaded existing database")
  } else {
    console.error("eias.db not found - run the app first to create it")
    process.exit(1)
  }

  const persist = () => fs.writeFileSync(dbPath, Buffer.from(db.export()))
  const run = (sql, p=[]) => db.run(sql, p)
  const q = (sql, p=[]) => {
    const s = db.prepare(sql); s.bind(p)
    const rows = []; while(s.step()) rows.push(s.getAsObject()); s.free()
    return rows
  }
  const one = (sql, p=[]) => q(sql, p)[0]

  console.log("\n=== SEEDING DEPARTMENTS ===")
  const depts = [
    ["CSE", "Computer Science and Engineering"],
    ["ECE", "Electronics and Communication Engineering"],
    ["ME",  "Mechanical Engineering"],
    ["CE",  "Civil Engineering"],
    ["EEE", "Electrical and Electronics Engineering"],
    ["IT",  "Information Technology"],
    ["AIDS","Artificial Intelligence and Data Science"],
  ]
  for (const [code, name] of depts) {
    const ex = one("SELECT id FROM departments WHERE code=?", [code])
    if (!ex) { run("INSERT INTO departments(code,name) VALUES(?,?)", [code, name]); console.log(`  + ${code}: ${name}`) }
    else console.log(`  ~ ${code} already exists`)
  }

  console.log("\n=== SEEDING HALLS ===")
  const halls = [
    ["H001","Xavier Hall",   40,"Block A",1],
    ["H002","Loyola Hall",   38,"Block A",2],
    ["H003","Bethlehem Hall",42,"Block B",3],
    ["H004","Annai Hall",    40,"Block B",4],
    ["H005","Joseph Hall",   36,"Block C",5],
    ["H006","Mary Hall",     38,"Block C",6],
    ["H007","Peter Hall",    40,"Block D",7],
    ["H008","Paul Hall",     35,"Block D",8],
    ["H009","Francis Hall",  42,"Block E",9],
    ["H010","Ignatius Hall", 38,"Block E",10],
  ]
  for (const [code, name, cap, block, ord] of halls) {
    const ex = one("SELECT id FROM halls WHERE hall_code=?", [code])
    if (!ex) { run("INSERT INTO halls(hall_code,name,capacity,block,is_active,sort_order) VALUES(?,?,?,?,1,?)",[code,name,cap,block,ord]); console.log(`  + ${code}: ${name}`) }
    else console.log(`  ~ ${code} already exists`)
  }

  console.log("\n=== SEEDING STAFF ===")
  const staffPw = await bcrypt.hash("sxcce@2026", 12)
  const allDepts = q("SELECT id,code FROM departments")
  const deptMap = Object.fromEntries(allDepts.map(d=>[d.code, d.id]))

  const staff = [
    ["SX001","Dr. A. Maria Joseph",   "Head of Department",  "CSE"],
    ["SX002","Prof. B. Xavier Paul",  "Associate Professor", "ECE"],
    ["SX003","Dr. C. Antony Raj",     "Associate Professor", "ME" ],
    ["SX004","Prof. D. Roseline Mary","Assistant Professor", "CE" ],
    ["SX005","Dr. E. John Kennedy",   "Head of Department",  "EEE"],
    ["SX006","Prof. F. Stella Mary",  "Assistant Professor", "IT" ],
    ["SX007","Dr. G. Michael John",   "Associate Professor", "AIDS"],
    ["SX008","Prof. H. Clara Rose",   "Assistant Professor", "CSE"],
    ["SX009","Dr. I. Raj Kumar",      "Assistant Professor", "ECE"],
    ["SX010","Prof. J. Priya Devi",   "Assistant Professor", "ME" ],
  ]
  for (const [sid, name, desg, dept] of staff) {
    const ex = one("SELECT id FROM users WHERE staff_id=?", [sid])
    if (!ex) {
      run("INSERT INTO users(staff_id,name,designation,role,department_id,is_active,password_hash) VALUES(?,?,?,?,?,?,?)",
        [sid, name, desg, "staff", deptMap[dept]||null, 1, staffPw])
      console.log(`  + ${sid}: ${name}`)
    } else console.log(`  ~ ${sid} already exists`)
  }

  console.log("\n=== CREATING EXAM CYCLE ===")
  let cycle = one("SELECT id FROM exam_cycles WHERE name LIKE '%November 2026%'")
  if (!cycle) {
    run("INSERT INTO exam_cycles(name,academic_year,status) VALUES(?,?,?)",
      ["November 2026 End Semester Examinations","2026-27","draft"])
    cycle = one("SELECT id FROM exam_cycles ORDER BY id DESC LIMIT 1")
    console.log(`  + Cycle created: id=${cycle.id}`)
  } else { console.log(`  ~ Cycle already exists: id=${cycle.id}`) }

  console.log("\n=== CREATING EXAM SESSIONS ===")
  const sessions = [
    ["2026-11-03","FN","09:30","10:00","13:00"],
    ["2026-11-03","AN","13:30","14:00","17:00"],
    ["2026-11-04","FN","09:30","10:00","13:00"],
    ["2026-11-04","AN","13:30","14:00","17:00"],
    ["2026-11-05","FN","09:30","10:00","13:00"],
    ["2026-11-05","AN","13:30","14:00","17:00"],
  ]
  const existSess = q("SELECT id FROM exam_sessions WHERE cycle_id=?", [cycle.id])
  if (!existSess.length) {
    sessions.forEach(([date, stype, rep, start, end], i) => {
      run("INSERT INTO exam_sessions(cycle_id,exam_date,session_type,rotation_step,reporting_time,exam_start,exam_end,status) VALUES(?,?,?,?,?,?,?,?)",
        [cycle.id, date, stype, i+1, rep, start, end, "pending"])
      console.log(`  + Session ${i+1}: ${date} ${stype}`)
    })
  } else { console.log(`  ~ ${existSess.length} sessions already exist`) }

  persist()

  // PRINT SUMMARY
  console.log("\n========== SEED COMPLETE ==========")
  console.log("Departments:", q("SELECT COUNT(*) as c FROM departments")[0].c)
  console.log("Halls:      ", q("SELECT COUNT(*) as c FROM halls")[0].c)
  console.log("Staff:      ", q("SELECT COUNT(*) as c FROM users WHERE role='staff'")[0].c)
  console.log("Cycles:     ", q("SELECT COUNT(*) as c FROM exam_cycles")[0].c)
  console.log("Sessions:   ", q("SELECT COUNT(*) as c FROM exam_sessions")[0].c)
  console.log("====================================\n")
}

seed().catch(e => { console.error(e); process.exit(1) })
