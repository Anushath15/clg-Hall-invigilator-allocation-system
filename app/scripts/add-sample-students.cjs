/**
 * Adds sample students to every section (department + batch): 30 each to CSE, AI and IT, 10 each to
 * CIVIL, ECE, EEE and MECH, for the batches 2023-2027 to 2026-2030. The EEE department is created
 * when it does not exist.
 *
 * Numbers continue each section's existing ones:
 *   roll no     <dept code><batch start yy><serial 2 digits>       e.g. 102306  (CSE 2023-2027, 6th)
 *   register no 9612<batch start yy><branch code><serial 3 digits> e.g. 961223104006
 * Boys and girls alternate (about half each); names come from fixed lists, so a run is repeatable.
 *
 *   node scripts/add-sample-students.cjs              dry run: shows what would be added
 *   node scripts/add-sample-students.cjs --apply      adds them (a backup of the database is made first)
 *   node scripts/add-sample-students.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

const BATCHES = ["2023-2027", "2024-2028", "2025-2029", "2026-2030"]
/** Department: students to add per section, roll-number code, Anna University branch code. */
const DEPARTMENTS = {
  CSE: { add: 30, code: "10", branch: "104" },
  AI: { add: 30, code: "90", branch: "243" },
  IT: { add: 30, code: "50", branch: "205" },
  CIVIL: { add: 10, code: "40", branch: "103" },
  ECE: { add: 10, code: "20", branch: "106" },
  EEE: { add: 10, code: "30", branch: "105", name: "Electrical and Electronics Engineering" },
  MECH: { add: 10, code: "60", branch: "114" }
}
const BOYS = ["Arun", "Bala", "Dinesh", "Ganesh", "Hari", "Karthik", "Lokesh", "Manoj", "Naveen", "Prakash", "Rahul", "Santhosh", "Surya", "Tamil", "Vijay", "Yuvaraj", "Ajith", "Gokul", "Kavin", "Sanjay"]
const GIRLS = ["Abinaya", "Bharathi", "Deepa", "Gayathri", "Harini", "Janani", "Kaviya", "Lakshmi", "Meena", "Nandhini", "Pavithra", "Priya", "Sandhiya", "Swetha", "Thenmozhi", "Vaishnavi", "Yamini", "Aishwarya", "Kowsalya", "Sowmiya"]
const INITIALS = ["A", "B", "C", "D", "G", "J", "K", "M", "N", "P", "R", "S", "T", "V"]

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
  const deptId = code => rows("SELECT id FROM departments WHERE code = ? COLLATE NOCASE", [code])[0]?.id
  const missing = Object.keys(DEPARTMENTS).filter(code => !deptId(code))

  const usedRoll = new Set(rows("SELECT roll_no FROM students").map(r => String(r.roll_no).toUpperCase()))
  const usedReg = new Set(rows("SELECT register_no FROM students").map(r => String(r.register_no).toUpperCase()))
  const plan = []
  let n = 0
  for (const [dept, d] of Object.entries(DEPARTMENTS)) {
    const id = deptId(dept)
    for (const batch of BATCHES) {
      const yy = batch.slice(2, 4)
      const rollPrefix = `${d.code}${yy}`, regPrefix = `9612${yy}${d.branch}`
      // Continue after the section's highest serial already in use.
      const existing = id ? rows("SELECT roll_no, register_no FROM students WHERE department_id = ? AND batch = ?", [id, batch]) : []
      let roll = Math.max(0, ...existing.map(r => String(r.roll_no)).filter(r => r.startsWith(rollPrefix)).map(r => Number(r.slice(rollPrefix.length)) || 0))
      let reg = Math.max(0, ...existing.map(r => String(r.register_no)).filter(r => r.startsWith(regPrefix)).map(r => Number(r.slice(regPrefix.length)) || 0))
      for (let i = 0; i < d.add; i++) {
        roll++; reg++
        if (roll > 99) throw new Error(`${dept} ${batch}: roll serial would pass 99 (2-digit serial).`)
        const rollNo = `${rollPrefix}${String(roll).padStart(2, "0")}`, regNo = `${regPrefix}${String(reg).padStart(3, "0")}`
        if (usedRoll.has(rollNo) || usedReg.has(regNo)) throw new Error(`${rollNo} / ${regNo} is already in use.`)
        usedRoll.add(rollNo); usedReg.add(regNo)
        const gender = n % 2 === 0 ? "M" : "F"
        const first = (gender === "M" ? BOYS : GIRLS)[Math.floor(n / 2) % 20]
        plan.push({ dept, batch, roll_no: rollNo, register_no: regNo, name: `${first} ${INITIALS[n % INITIALS.length]}`, gender })
        n++
      }
    }
  }

  const summary = {}
  for (const p of plan) {
    const k = `${p.dept} ${p.batch}`
    summary[k] = summary[k] ?? { added: 0, boys: 0, girls: 0, from: p.roll_no, to: p.roll_no }
    summary[k].added++; summary[k][p.gender === "M" ? "boys" : "girls"]++; summary[k].to = p.roll_no
  }
  console.table(summary)
  console.log(`${plan.length} students to add${missing.length ? `; departments to create: ${missing.join(", ")}` : ""}.`)
  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  db.run("BEGIN")
  try {
    for (const code of missing) db.run("INSERT INTO departments(code, name, is_active) VALUES(?, ?, 1)", [code, DEPARTMENTS[code].name ?? code])
    for (const p of plan) {
      db.run("INSERT INTO students(roll_no, register_no, name, gender, department_id, batch, is_active) VALUES(?,?,?,?,?,?,1)",
        [p.roll_no, p.register_no, p.name, p.gender, deptId(p.dept), p.batch])
    }
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nAdded ${plan.length} students to ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
