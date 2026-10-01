/**
 * BACKUP AND RESTORE of the local database file (no network involved).
 * A backup is a plain copy of eias.db. A restore first checks that the chosen file really
 * is a HIAS database, keeps a timestamped safety copy of the current data next to it, and
 * then replaces eias.db; the caller restarts the app so the restored file is loaded.
 */
import fs from "fs"
import initSqlJs from "sql.js"
import { getDbPath } from "../db/database"

// Tables every HIAS database has had since the first version.
const REQUIRED_TABLES = ["departments", "users", "halls", "settings", "exam_cycles", "exam_sessions", "allocations", "rotation_history"]

export function backupDatabase(destPath: string): { success: boolean; error?: string } {
  try {
    const src = getDbPath()
    if (!fs.existsSync(src)) return { success: false, error: "Database file not found." }
    fs.copyFileSync(src, destPath)
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}

/** Why `filePath` cannot be restored, or null if it is a readable HIAS database. */
export async function checkBackupFile(filePath: string): Promise<string | null> {
  if (!fs.existsSync(filePath)) return "Backup file not found."
  try {
    const SQL = await initSqlJs()
    const candidate = new SQL.Database(fs.readFileSync(filePath))
    try {
      const tables = new Set((candidate.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map(r => String(r[0])))
      const missing = REQUIRED_TABLES.filter(t => !tables.has(t))
      if (missing.length) return `This file is not a HIAS database backup (missing: ${missing.join(", ")}).`
    } finally {
      candidate.close()
    }
    return null
  } catch {
    return "This file is not a HIAS database backup (it could not be read as a database)."
  }
}

/** Safety-copy name for the current data, e.g. eias.db.before-restore-20261001-093000.bak */
function safetyCopyPath(dbPath: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  return `${dbPath}.before-restore-${stamp}.bak`
}

export async function restoreDatabase(srcPath: string): Promise<{ success: boolean; error?: string; safetyCopy?: string }> {
  try {
    const dest = getDbPath()
    const problem = await checkBackupFile(srcPath)
    if (problem) return { success: false, error: problem }
    let safetyCopy: string | undefined
    if (fs.existsSync(dest)) {
      safetyCopy = safetyCopyPath(dest)
      fs.copyFileSync(dest, safetyCopy)
    }
    fs.copyFileSync(srcPath, dest)
    return { success: true, safetyCopy }
  } catch (e: any) {
    return { success: false, error: e.message }
  }
}
