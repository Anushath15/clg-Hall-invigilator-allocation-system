/**
 * Creates a classroom (hall with a bench layout) for every class, enough for all its students:
 *
 *   code = <block><floor><room, 2 digits>   e.g. B101 = block B, 1st floor, 1st room
 *
 * The floor is the year of study in the latest exam cycle's academic year (1st year → 1st floor,
 * final year → 4th floor). CSE and ECE get two rooms per year, the class split in half; the other
 * departments one room per year:
 *
 *   B: CSE (rooms 01, 02) and ECE (03, 04)   C: AI (01) and IT (02)   D: MECH   E: CIVIL   F: EEE
 *
 * A room number already used on that floor (e.g. the existing D101) is skipped. Each room has 4
 * columns of benches and as many rows as its students need at two per bench.
 *
 *   node scripts/add-classrooms.cjs              dry run: shows the rooms, writes nothing
 *   node scripts/add-classrooms.cjs --apply      creates them (a backup of the database is made first)
 *   node scripts/add-classrooms.cjs --db <path>  another database file (default: ./eias.db)
 *
 * Close the app first: it keeps the database in memory and would overwrite the changes.
 */
const fs = require("fs")
const path = require("path")
const initSqlJs = require("sql.js")

/** Block per department, and how many rooms each year of that department gets. */
const PLAN = [
  { block: "B", dept: "CSE", rooms: 2 },
  { block: "B", dept: "ECE", rooms: 2 },
  { block: "C", dept: "AI", rooms: 1 },
  { block: "C", dept: "IT", rooms: 1 },
  { block: "D", dept: "MECH", rooms: 1 },
  { block: "E", dept: "CIVIL", rooms: 1 },
  { block: "F", dept: "EEE", rooms: 1 }
]
const COLUMNS = 4
const FLOOR_NAME = ["1st", "2nd", "3rd", "4th", "5th", "6th"]

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

  const academicYear = rows("SELECT academic_year FROM exam_cycles ORDER BY id DESC LIMIT 1")[0]?.academic_year
  const start = Number(String(academicYear ?? "").slice(0, 4))
  if (!start) throw new Error("No exam cycle with an academic year (e.g. 2026-2027) to work out each batch's year.")
  const usedCodes = new Set(rows("SELECT hall_code FROM halls").map(r => String(r.hall_code).toUpperCase()))
  let sortOrder = rows("SELECT MAX(sort_order) m FROM halls")[0]?.m ?? 0

  const rooms = []
  const nextRoom = new Map() // "B1" → next room number to try on that floor of that block
  for (const p of PLAN) {
    const classes = rows(`SELECT s.batch, COUNT(*) n FROM students s JOIN departments d ON d.id = s.department_id
      WHERE d.code = ? COLLATE NOCASE AND s.is_active = 1 GROUP BY s.batch ORDER BY s.batch DESC`, [p.dept])
    for (const c of classes) {
      const year = start - Number(String(c.batch).slice(0, 4)) + 1
      if (year < 1 || year > 6) continue // a batch not studying in this academic year
      // The class split as evenly as possible over its rooms.
      for (let r = 0; r < p.rooms; r++) {
        const students = Math.floor(c.n / p.rooms) + (r < c.n % p.rooms ? 1 : 0)
        const key = `${p.block}${year}`
        let no = nextRoom.get(key) ?? 1, code
        do { code = `${p.block}${year}${String(no).padStart(2, "0")}`; no++ } while (usedCodes.has(code))
        nextRoom.set(key, no)
        usedCodes.add(code)
        const benches = Math.ceil(students / 2)
        const benchRows = Math.max(1, Math.ceil(benches / COLUMNS))
        rooms.push({
          code, block: `${p.block} Block`, floor: FLOOR_NAME[year - 1], dept: p.dept, batch: c.batch, year,
          section: p.rooms > 1 ? String.fromCharCode(65 + r) : "", students, rows: benchRows, cols: COLUMNS, seats: benchRows * COLUMNS * 2
        })
      }
    }
  }

  console.table(rooms.map(r => ({ room: r.code, block: r.block, floor: r.floor, class: `${r.dept} ${r.batch}${r.section ? ` (section ${r.section})` : ""}`, students: r.students, benches: `${r.cols} x ${r.rows}`, seats: r.seats })))
  const total = rooms.reduce((n, r) => n + r.students, 0), seats = rooms.reduce((n, r) => n + r.seats, 0)
  console.log(`${rooms.length} classrooms for ${total} students, ${seats} seats.`)
  if (!apply) { console.log("\nDry run: nothing written. Run again with --apply to save."); return }

  const backup = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`
  fs.copyFileSync(dbPath, backup)
  db.run("BEGIN")
  try {
    for (const r of rooms) {
      db.run(`INSERT INTO halls(hall_code, name, floor, capacity, block, is_active, sort_order, bench_rows, bench_cols, disabled_benches)
              VALUES(?,?,?,?,?,1,?,?,?,'[]')`, [r.code, r.code, r.floor, r.seats, r.block, ++sortOrder, r.rows, r.cols])
    }
    db.run("COMMIT")
  } catch (e) {
    db.run("ROLLBACK")
    throw e
  }
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
  console.log(`\nCreated ${rooms.length} classrooms in ${dbPath}.\nBackup of the previous database: ${backup}`)
}

main().catch(e => { console.error(`Error: ${e.message}`); process.exit(1) })
