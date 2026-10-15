/**
 * Splits every class (department + batch) into two sections by roll number: the first half of the
 * class becomes section A, the rest section B. With an odd strength A gets the extra student
 * (31 students: A 16, B 15).
 *
 *   node scripts/assign-sections.cjs              dry run: shows the split for each class
 *   node scripts/assign-sections.cjs --apply      saves it (a backup of the database is made first)
 *   node scripts/assign-sections.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Every student is given a section, replacing any section already set. The section column is
 * added when the database predates it (the app would add it on its next start anyway).
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

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
  const hasSection = rows("PRAGMA table_info(students)").some(c => c.name === "section")
  const students = rows(`SELECT s.id, s.roll_no, s.batch, ${hasSection ? "s.section" : "'' AS section"}, COALESCE(d.code, '—') AS dept
    FROM students s LEFT JOIN departments d ON d.id = s.department_id`)
  if (students.length === 0) { console.log("No students in the database."); return }

  // Classes: department + batch, students in roll number order (23CS2 before 23CS10).
  const rollOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  const classes = new Map()
  for (const s of students) {
    const k = `${s.dept} ${s.batch}`
    classes.set(k, [...(classes.get(k) ?? []), s])
  }
  const plan = [], summary = {}
  for (const k of [...classes.keys()].sort()) {
    const list = classes.get(k).sort((a, b) => rollOrder.compare(a.roll_no, b.roll_no))
    const half = Math.ceil(list.length / 2)
    list.forEach((s, i) => plan.push({ id: s.id, section: i < half ? "A" : "B", old: s.section }))
    summary[k] = {
      strength: list.length,
      A: half, "A rolls": `${list[0].roll_no} – ${list[half - 1].roll_no}`,
      B: list.length - half, "B rolls": list.length > half ? `${list[half].roll_no} – ${list[list.length - 1].roll_no}` : "—"
    }
  }
  console.table(summary)
  const changes = plan.filter(p => p.old !== p.section)
  console.log(`${classes.size} classes, ${plan.length} students; ${changes.length} section(s) to set${hasSection ? "" : " (the section column will be added)"}.`)
  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }
  if (changes.length === 0) { console.log("Nothing to change."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  db.run("BEGIN")
  try {
    if (!hasSection) db.run("ALTER TABLE students ADD COLUMN section TEXT NOT NULL DEFAULT ''")
    for (const p of changes) db.run("UPDATE students SET section = ?, updated_at = datetime('now') WHERE id = ?", [p.section, p.id])
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nSet ${changes.length} sections in ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
