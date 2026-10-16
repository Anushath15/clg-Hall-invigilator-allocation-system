/**
 * Splits every department + batch into two sections by roll-number order: the first half becomes
 * section A, the second half section B. With an odd number of students, section A gets the extra one.
 *
 *   CSE 2023-2027, 60 students → roll numbers 1–30 in A, 31–60 in B
 *
 * Students without a department are left as they are.
 *
 *   node scripts/split-sections.cjs              dry run: shows the changes, writes nothing
 *   node scripts/split-sections.cjs --apply      writes them (a backup of the database is made first)
 *   node scripts/split-sections.cjs --db <path>  another database file (default: ./eias.db)
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

  const students = rows(`SELECT s.id, s.roll_no, s.batch, s.section, d.code AS dept FROM students s JOIN departments d ON d.id = s.department_id`)
  const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
  const groups = new Map()
  for (const s of students) {
    const key = `${s.dept}|${s.batch}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }

  const changes = []
  const summary = []
  for (const [, list] of [...groups].sort(([a], [b]) => order.compare(a, b))) {
    list.sort((a, b) => order.compare(a.roll_no, b.roll_no) || a.id - b.id)
    const half = Math.ceil(list.length / 2)
    list.forEach((s, i) => {
      const to = i < half ? "A" : "B"
      if (s.section !== to) changes.push({ id: s.id, to })
    })
    summary.push({
      dept: list[0].dept, batch: list[0].batch, students: list.length,
      A: `${half} (${list[0].roll_no}–${list[half - 1].roll_no})`,
      B: list.length > half ? `${list.length - half} (${list[half].roll_no}–${list[list.length - 1].roll_no})` : "0",
    })
  }

  console.table(summary)
  const skipped = rows("SELECT COUNT(*) AS n FROM students WHERE department_id IS NULL")[0].n
  console.log(`${changes.length} students change section; ${students.length - changes.length} already right${skipped ? `; ${skipped} without a department left as they are` : ""}.`)

  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }
  if (!changes.length) { console.log("Nothing to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  db.run("BEGIN")
  try {
    for (const c of changes) db.run("UPDATE students SET section = ?, updated_at = datetime('now') WHERE id = ?", [c.to, c.id])
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nSaved ${changes.length} changes to ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
