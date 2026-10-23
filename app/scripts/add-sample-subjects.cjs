/**
 * Adds sample subjects: 3 per department for each batch (year of study), the students of that
 * department and batch are enrolled in them, and two staff of the department handle each subject.
 *
 *   subject code   <dept code><year of study><serial 2 digits>   e.g. CSE401 (CSE, 4th year, 1st subject)
 *
 * Re-running skips subjects that already exist and only fills in missing enrolments and staff.
 *
 *   node scripts/add-sample-subjects.cjs              dry run: shows what would be added
 *   node scripts/add-sample-subjects.cjs --apply      adds them (a backup of the database is made first)
 *   node scripts/add-sample-subjects.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 * Start the app once on the database beforehand so the subjects tables exist (migrations 012 and 013).
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

/** Department -> 12 subject names: three for each year of study, 1st year first. */
const SUBJECTS = {
  CSE: ["Programming in C", "Engineering Mathematics I", "Digital Principles", "Data Structures", "Object Oriented Programming", "Discrete Mathematics",
    "Database Management Systems", "Operating Systems", "Computer Networks", "Compiler Design", "Machine Learning", "Cloud Computing"],
  AI: ["Python Programming", "Linear Algebra", "Fundamentals of AI", "Data Exploration and Visualisation", "Probability and Statistics", "Machine Learning Basics",
    "Deep Learning", "Natural Language Processing", "Big Data Analytics", "Computer Vision", "Reinforcement Learning", "AI Ethics"],
  IT: ["Problem Solving Using C", "Engineering Mathematics I", "Web Fundamentals", "Data Structures", "Software Engineering", "Computer Architecture",
    "Web Technologies", "Information Security", "Mobile Application Development", "Internet of Things", "DevOps", "Data Warehousing"],
  ECE: ["Basic Electronics", "Circuit Theory", "Engineering Physics", "Signals and Systems", "Analog Circuits", "Electromagnetic Fields",
    "Digital Signal Processing", "Communication Systems", "VLSI Design", "Microwave Engineering", "Embedded Systems", "Antenna Theory"],
  EEE: ["Basic Electrical Engineering", "Engineering Physics", "Engineering Graphics", "Electric Circuit Analysis", "Electrical Machines I", "Measurements and Instrumentation",
    "Power Systems I", "Control Systems", "Power Electronics", "Electrical Machines II", "High Voltage Engineering", "Renewable Energy Systems"],
  MECH: ["Engineering Mechanics", "Engineering Chemistry", "Workshop Practice", "Thermodynamics", "Fluid Mechanics", "Manufacturing Technology",
    "Heat and Mass Transfer", "Machine Design", "Dynamics of Machinery", "Automobile Engineering", "Finite Element Analysis", "Robotics"],
  CIVIL: ["Engineering Mechanics", "Engineering Geology", "Surveying", "Strength of Materials", "Construction Materials", "Fluid Mechanics",
    "Structural Analysis", "Soil Mechanics", "Water Supply Engineering", "Design of RC Structures", "Transportation Engineering", "Estimation and Costing"]
}
const LATEST_BATCH_START = 2026 // the 2026-2030 batch is in its 1st year

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const dbPath = path.resolve(args.includes("--db") ? args[args.indexOf("--db") + 1] : "eias.db")

async function main() {
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`)
  const SQL = await initSqlJs()
  const db = new SQL.Database(fs.readFileSync(dbPath))
  const rows = (sql, params = []) => {
    const st = db.prepare(sql); st.bind(params)
    const out = []
    while (st.step()) out.push(st.getAsObject())
    st.free()
    return out
  }
  for (const t of ["subjects", "staff_subjects", "student_subjects"])
    if (!rows("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t]).length)
      throw new Error(`Table ${t} is missing: start the app once on this database so it migrates, then close it.`)

  const plan = []
  for (const [dept, names] of Object.entries(SUBJECTS)) {
    const d = rows("SELECT id FROM departments WHERE code = ? COLLATE NOCASE", [dept])[0]
    if (!d) throw new Error(`Department ${dept} not found.`)
    const staff = rows("SELECT id FROM users WHERE department_id = ? AND is_active = 1 AND role = 'staff' ORDER BY id", [d.id]).map(r => r.id)
    for (let year = 1; year <= 4; year++) {
      const batch = `${LATEST_BATCH_START - (year - 1)}-${LATEST_BATCH_START - (year - 1) + 4}`
      const students = rows("SELECT id FROM students WHERE department_id = ? AND batch = ? AND is_active = 1", [d.id, batch]).map(r => r.id)
      for (let n = 0; n < 3; n++) {
        const idx = (year - 1) * 3 + n
        const handlers = staff.length ? [staff[(idx * 2) % staff.length], staff[(idx * 2 + 1) % staff.length]] : []
        plan.push({ code: `${dept}${year}${String(n + 1).padStart(2, "0")}`, name: names[idx], dept, deptId: d.id, batch, students, staff: [...new Set(handlers)] })
      }
    }
  }

  console.table(plan.map(p => ({ code: p.code, name: p.name, batch: p.batch, students: p.students.length, staff: p.staff.length })))
  console.log(`${plan.length} subjects (existing ones are skipped).`)
  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  for (const p of plan) {
    let s = rows("SELECT id FROM subjects WHERE code = ? COLLATE NOCASE", [p.code])[0]
    if (!s) {
      db.run("INSERT INTO subjects(code, name, department_id, is_active) VALUES(?,?,?,1)", [p.code, p.name, p.deptId])
      s = rows("SELECT id FROM subjects WHERE code = ?", [p.code])[0]
    }
    for (const u of p.staff) db.run("INSERT OR IGNORE INTO staff_subjects(user_id, subject_id) VALUES(?,?)", [u, s.id])
    for (const st of p.students) db.run("INSERT OR IGNORE INTO student_subjects(student_id, subject_id) VALUES(?,?)", [st, s.id])
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nAdded subjects to ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1) })
