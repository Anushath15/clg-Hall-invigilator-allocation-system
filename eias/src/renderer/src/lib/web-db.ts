/**
 * Browser-compatible SQLite database module using sql.js and IndexedDB.
 * Used when running as a web application (e.g. Firebase Hosting).
 */

import initSqlJs, { Database, SqlJsStatic } from "sql.js"

let SQL: SqlJsStatic | null = null
let _db: Database | null = null
let _inTransaction = false
let _lastInsertRowid = 0
let _initPromise: Promise<void> | null = null

const IDB_NAME = "eias_web_db"
const IDB_STORE = "sqlite_store"
const IDB_KEY = "database_binary"

function getIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await getIndexedDB()
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE, "readonly")
      const store = tx.objectStore(IDB_STORE)
      const getReq = store.get(IDB_KEY)
      getReq.onsuccess = () => resolve(getReq.result || null)
      getReq.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function saveToIndexedDB(buffer: Uint8Array): Promise<void> {
  try {
    const idb = await getIndexedDB()
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, "readwrite")
      const store = tx.objectStore(IDB_STORE)
      store.put(buffer, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.error("[EIAS Web DB] Failed to persist to IndexedDB", e)
  }
}

function persistDb(): void {
  if (!_db || _inTransaction) return
  const data = _db.export()
  saveToIndexedDB(data)
}

export async function initWebDatabase(): Promise<void> {
  if (_db) return
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    SQL = await initSqlJs({
      locateFile: (file) => `/${file}`
    })

    // 1. Try to load saved database from browser IndexedDB
    const savedBuffer = await loadFromIndexedDB()
    if (savedBuffer && savedBuffer.length > 0) {
      _db = new SQL.Database(savedBuffer)
      console.log("[EIAS Web DB] Loaded existing database from IndexedDB")
    } else {
      // 2. Try to load pre-seeded default-eias.db from server
      let loadedPreseed = false
      try {
        const res = await fetch("/default-eias.db")
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer()
          const u8 = new Uint8Array(arrayBuffer)
          _db = new SQL.Database(u8)
          await saveToIndexedDB(u8)
          loadedPreseed = true
          console.log("[EIAS Web DB] Loaded pre-seeded college database from /default-eias.db")
        }
      } catch (e) {
        console.warn("[EIAS Web DB] Could not fetch default-eias.db, initializing blank database", e)
      }

      if (!loadedPreseed) {
        _db = new SQL.Database()
        runMigrations()
        seedDefaults()
        persistDb()
      }
    }
  })()

  return _initPromise
}

export function run(sql: string, params: any[] = []): { lastInsertRowid: number; changes: number } {
  if (!_db) throw new Error("Web database not initialized")
  _db.run(sql, params)
  const res = _db.exec("SELECT last_insert_rowid() as id")
  if (res && res[0] && res[0].values && res[0].values[0]) {
    const id = Number(res[0].values[0][0])
    if (id > 0) {
      _lastInsertRowid = id
    }
  }
  const changes = _db.getRowsModified()
  persistDb()
  return { lastInsertRowid: _lastInsertRowid, changes }
}

export function query<T = Record<string, any>>(sql: string, params: any[] = []): T[] {
  if (!_db) throw new Error("Web database not initialized")
  const normalizedSql = sql.replace(/last_insert_rowid\(\)/gi, String(_lastInsertRowid))
  const stmt = _db.prepare(normalizedSql)
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
  return _lastInsertRowid
}

export async function runTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
  if (!_db) throw new Error("Web database not initialized")
  if (_inTransaction) return await fn()

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
      console.error("[EIAS Web DB] Rollback failed:", rbErr)
    }
    _inTransaction = false
    throw err
  }
}

export function exportDatabaseBlob(): Uint8Array {
  if (!_db) throw new Error("Web database not initialized")
  return _db.export()
}

export async function importDatabaseBuffer(buffer: Uint8Array): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: (file) => `/${file}` })
  }
  _db = new SQL.Database(buffer)
  await saveToIndexedDB(buffer)
}

// Default migrations & seeds if starting fresh
function runMigrations(): void {
  run(`PRAGMA foreign_keys=ON`)
  run(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TEXT)`)

  const migrations: Record<string, () => void> = {
    "001_initial_schema": () => {
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
        global_order INTEGER,
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
  }

  for (const [name, fn] of Object.entries(migrations)) {
    const already = queryOne("SELECT name FROM _migrations WHERE name = ?", [name])
    if (!already) {
      fn()
      run("INSERT INTO _migrations(name, run_at) VALUES(?,?)", [name, new Date().toISOString()])
    }
  }
}

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

export const webDb = {
  run,
  query,
  queryOne,
  lastInsertId,
  runTransaction,
  initWebDatabase,
  exportDatabaseBlob,
  importDatabaseBuffer
}
