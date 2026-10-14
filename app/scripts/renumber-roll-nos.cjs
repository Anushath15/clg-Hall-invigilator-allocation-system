/**
 * Renumbers student roll numbers as <department code><batch start year, 2 digits><serial, 2 digits>:
 *
 *   CSE final year (batch 2023-2027), 1st student → 102301
 *
 * Department codes: CSE 10, ECE 20, EEE 30, CIVIL 40, IT 50, MECH 60, AI 90. Students of other departments
 * keep their roll numbers. Within each department + batch the serial follows the current roll-number
 * order. Seating plans refer to students by id, so they are unaffected; the saved lists of
 * unallocated students show roll numbers and are updated too.
 *
 *   node scripts/renumber-roll-nos.cjs              dry run: shows the changes, writes nothing
 *   node scripts/renumber-roll-nos.cjs --apply      writes them (a backup of the database is made first)
 *   node scripts/renumber-roll-nos.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

const DEPT_CODES = { CSE: "10", ECE: "20", EEE: "30", CIVIL: "40", IT: "50", MECH: "60", AI: "90" }

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

  const students = rows(`SELECT s.id, s.roll_no, s.batch, d.code AS dept FROM students s LEFT JOIN departments d ON d.id = s.department_id`)
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  const groups = new Map()
  for (const s of students) {
    const code = DEPT_CODES[String(s.dept ?? "").toUpperCase()]
    const year = String(s.batch).match(/^(\d{4})/)
    if (!code || !year) continue
    const key = `${code}${year[1].slice(2)}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }

  const changes = []
  for (const [prefix, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => order.compare(a.roll_no, b.roll_no) || a.id - b.id)
    if (list.length > 99) throw new Error(`${prefix}: ${list.length} students, but the serial has only 2 digits (at most 99).`)
    list.forEach((s, i) => changes.push({ id: s.id, dept: s.dept, batch: s.batch, from: s.roll_no, to: `${prefix}${String(i + 1).padStart(2, "0")}` }))
  }

  // A new roll number must not belong to a student who keeps theirs (roll numbers are unique).
  const changing = new Set(changes.map(c => c.id))
  const kept = new Map(students.filter(s => !changing.has(s.id)).map(s => [String(s.roll_no).toUpperCase(), s.roll_no]))
  const clashes = changes.filter(c => kept.has(c.to.toUpperCase()))
  if (clashes.length) throw new Error(`New roll numbers already used by other students: ${clashes.map(c => c.to).join(", ")}`)

  console.table(changes.map(({ dept, batch, from, to }) => ({ dept, batch, from, to })))
  const skipped = students.filter(s => !changing.has(s.id))
  const skippedDepts = [...new Set(skipped.map(s => s.dept ?? "(none)"))]
  console.log(`${changes.length} roll numbers to change; ${skipped.length} unchanged${skippedDepts.length ? ` (departments without a code: ${skippedDepts.join(", ")})` : ""}.`)

  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  const newRoll = new Map(changes.map(c => [c.id, c.to]))
  db.run("BEGIN")
  try {
    // Two steps, so a new number never collides with an old one still in place.
    for (const c of changes) db.run("UPDATE students SET roll_no = ? WHERE id = ?", [`__renumber_${c.id}`, c.id])
    for (const c of changes) db.run("UPDATE students SET roll_no = ?, updated_at = datetime('now') WHERE id = ?", [c.to, c.id])
    // Saved lists of unallocated students carry roll numbers.
    for (const r of rows("SELECT session_id, unallocated FROM seating_configs")) {
      let list
      try { list = JSON.parse(r.unallocated) } catch { continue }
      if (!Array.isArray(list)) continue
      const updated = list.map(u => (newRoll.has(u.studentId) ? { ...u, roll_no: newRoll.get(u.studentId) } : u))
      db.run("UPDATE seating_configs SET unallocated = ? WHERE session_id = ?", [JSON.stringify(updated), r.session_id])
    }
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nSaved ${changes.length} changes to ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
