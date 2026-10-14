/**
 * Adds 41 sample staff (invigilators), enough for one per hall: Staff IDs continue after the
 * highest numeric one in use (101–104 exist, so 105–145), spread over the departments
 * (CSE 8, AI 6, IT 6, ECE 6, EEE 5, MECH 5, CIVIL 5), mostly Assistant Professors.
 * Names come from fixed lists, so a run is repeatable.
 *
 *   node scripts/add-sample-staff.cjs              dry run: shows the staff, writes nothing
 *   node scripts/add-sample-staff.cjs --apply      adds them (a backup of the database is made first)
 *   node scripts/add-sample-staff.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

const PER_DEPARTMENT = { CSE: 8, AI: 6, IT: 6, ECE: 6, EEE: 5, MECH: 5, CIVIL: 5 }
const MEN = ["Arulmani", "Balasubramanian", "Chandrasekar", "Dhanasekaran", "Elangovan", "Ganesan", "Jayakumar", "Kannan", "Logeshwaran", "Murugan", "Natarajan", "Palanisamy", "Rajendran", "Saravanan", "Senthil Kumar", "Thirumalai", "Velmurugan", "Vinoth Kumar", "Prabhu", "Sathish", "Manikandan"]
const WOMEN = ["Anitha", "Bhuvaneswari", "Chitra", "Devi", "Geetha", "Hemalatha", "Jothi", "Kalaiselvi", "Lavanya", "Malathi", "Nirmala", "Revathi", "Sangeetha", "Sumathi", "Uma Maheswari", "Vasanthi", "Rajeswari", "Shanthi", "Padma", "Kavitha"]
const INITIALS = ["A", "B", "C", "G", "J", "K", "M", "N", "P", "R", "S", "T", "V"]
/** Designations in turn: one Professor, two Associate Professors, then Assistant Professors. */
const designation = i => (i % 8 === 0 ? "Professor" : i % 8 <= 2 ? "Associate Professor" : "Assistant Professor")

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
  const used = new Set(rows("SELECT staff_id FROM users").map(r => String(r.staff_id).toUpperCase()))
  let next = Math.max(100, ...[...used].filter(s => /^\d+$/.test(s)).map(Number)) + 1

  const staff = []
  let i = 0
  for (const [dept, count] of Object.entries(PER_DEPARTMENT)) {
    const deptId = rows("SELECT id FROM departments WHERE code = ? COLLATE NOCASE", [dept])[0]?.id
    if (!deptId) throw new Error(`Department ${dept} not found.`)
    for (let k = 0; k < count; k++, i++) {
      while (used.has(String(next))) next++
      const man = i % 2 === 0
      const first = (man ? MEN : WOMEN)[Math.floor(i / 2) % (man ? MEN.length : WOMEN.length)]
      const d = designation(i)
      const title = d === "Professor" ? "Dr." : man ? "Mr." : "Ms."
      staff.push({ staff_id: String(next), name: `${title} ${first} ${INITIALS[i % INITIALS.length]}`, designation: d, dept, deptId })
      used.add(String(next++))
    }
  }

  console.table(staff.map(({ staff_id, name, designation, dept }) => ({ staff_id, name, designation, dept })))
  console.log(`${staff.length} staff to add.`)
  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  db.run("BEGIN")
  try {
    for (const s of staff) {
      db.run("INSERT INTO users(staff_id, name, designation, role, department_id, is_active) VALUES(?,?,?,'staff',?,1)", [s.staff_id, s.name, s.designation, s.deptId])
    }
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nAdded ${staff.length} staff to ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
