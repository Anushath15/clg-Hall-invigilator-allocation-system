/**
 * Database module using sql.js (pure WASM SQLite ? no native compilation required).
 * Provides a simple query interface compatible with the rest of the application.
 * Data is persisted to disk by saving the DB buffer to a .db file on every write.
 */

import path from "path"
import fs from "fs"
import { app } from "electron"
import initSqlJs, { Database, SqlJsStatic } from "sql.js"

let SQL: SqlJsStatic
let _db: Database
let _isInMemory = false
let _inTransaction = false

function getDbPath(): string {
  const base = app && typeof app.getPath === "function"
    ? (app.isPackaged ? app.getPath("userData") : process.cwd())
    : process.cwd()
  return path.join(base, "eias.db")
}

function persistDb(): void {
  if (_isInMemory || _inTransaction) return
  if (!_db) return
  const data = _db.export()
  fs.writeFileSync(getDbPath(), Buffer.from(data))
}

export async function initDatabase(options?: { inMemory?: boolean }): Promise<void> {
  SQL = await initSqlJs()
  _isInMemory = !!options?.inMemory

  if (_isInMemory) {
    _db = new SQL.Database()
  } else {
    const dbPath = getDbPath()
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath)
      _db = new SQL.Database(fileBuffer)
    } else {
      _db = new SQL.Database()
    }
  }

  runMigrations()
  seedDefaults()
  persistDb()
}

// ?? Simple query interface ????????????????????????????????????????????????

export interface QueryResult {
  columns: string[]
  values: any[][]
}

export function run(sql: string, params: any[] = []): void {
  _db.run(sql, params)
  persistDb()
}

export function query<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
  const stmt = _db.prepare(sql)
  stmt.bind(params)
  const results: T[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject()
    results.push(row as unknown as T)
  }
  stmt.free()
  return results
}

export function queryOne<T = Record<string, any>>(sql: string, params: any[] = []): T | undefined {
  return query<T>(sql, params)[0]
}

export function lastInsertId(): number {
  const r = queryOne<{ id: number }>("SELECT last_insert_rowid() as id")
  return r?.id ?? 0
}

export async function runTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
  if (_inTransaction) {
    return await fn()
  }
  _db.run("BEGIN TRANSACTION")
  _inTransaction = true
  try {
    const result = await fn()
    _db.run("COMMIT")
    _inTransaction = false
    persistDb()
    return result
  } catch (err) {
    try {
      _db.run("ROLLBACK")
    } catch (rbErr) {
      console.error("Rollback failed:", rbErr)
    }
    _inTransaction = false
    throw err
  }
}

// ?? Migrations ????????????????????????????????????????????????????????????

function runMigrations(): void {
  run(`PRAGMA journal_mode=WAL`)
  run(`PRAGMA foreign_keys=ON`)

  run(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TEXT)`)

  const migrations: Record<string, () => void> = {
    "001_initial_schema": migration001,
    "002_rotation_global_order": migration002
  }

  for (const [name, fn] of Object.entries(migrations)) {
    const already = queryOne("SELECT name FROM _migrations WHERE name = ?", [name])
    if (!already) {
      fn()
      run("INSERT INTO _migrations(name, run_at) VALUES(?,?)", [name, new Date().toISOString()])
    }
  }
}

function migration001(): void {
  run(`CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    designation TEXT,
    password_hash TEXT,
    role TEXT DEFAULT 'staff',
    department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)

  run(`CREATE TABLE IF NOT EXISTS halls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hall_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 0,
    block TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`)

  run(`CREATE TABLE IF NOT EXISTS exam_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)

  run(`CREATE TABLE IF NOT EXISTS exam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER NOT NULL REFERENCES exam_cycles(id) ON DELETE CASCADE,
    exam_date TEXT NOT NULL,
    session_type TEXT NOT NULL,
    rotation_step INTEGER NOT NULL,
    reporting_time TEXT,
    exam_start TEXT,
    exam_end TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`)

  run(`CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    is_manually_edited INTEGER DEFAULT 0,
    edit_reason TEXT,
    generated_hall_id INTEGER REFERENCES halls(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(session_id, user_id),
    UNIQUE(session_id, hall_id)
  )`)

  run(`CREATE TABLE IF NOT EXISTS rotation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
    rotation_step INTEGER NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, session_id)
  )`)

  run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    description TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`)
}

function migration002(): void {
  // Check if global_order column already exists
  const cols = query<any>("PRAGMA table_info(rotation_history)")
  const hasCol = cols.some((c: any) => c.name === "global_order")
  if (!hasCol) {
    run(`ALTER TABLE rotation_history ADD COLUMN global_order INTEGER`)
  }

  // Create index for fast user-specific chronological lookup
  run(`CREATE INDEX IF NOT EXISTS idx_rotation_history_user_order ON rotation_history(user_id, global_order DESC)`)

  // Backfill existing records deterministically: ORDER BY datetime(recorded_at) ASC, id ASC
  const rows = query<any>("SELECT id FROM rotation_history ORDER BY datetime(recorded_at) ASC, id ASC")
  let order = 1
  for (const r of rows) {
    run("UPDATE rotation_history SET global_order = ? WHERE id = ?", [order++, r.id])
  }
}

// ?? Default seed data ?????????????????????????????????????????????????????

function seedDefaults(): void {
  const defaults: [string, string][] = [
    ["college.name", "St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil"],
    ["college.short_name", "SXCCE"],
    ["session.fn_reporting_time", "09:30"],
    ["session.fn_start_time", "10:00"],
    ["session.fn_end_time", "13:00"],
    ["session.an_reporting_time", "13:30"],
    ["session.an_start_time", "14:00"],
    ["session.an_end_time", "17:00"],
    ["app.version", "1.0.0"]
  ]
  for (const [key, value] of defaults) {
    const existing = queryOne("SELECT key FROM settings WHERE key = ?", [key])
    if (!existing) run("INSERT INTO settings(key, value) VALUES(?,?)", [key, value])
  }
}

// ?? Export db helper ??????????????????????????????????????????????????????
export const db = { run, query, queryOne, lastInsertId, runTransaction }