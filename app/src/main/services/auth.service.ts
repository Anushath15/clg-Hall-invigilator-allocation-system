import { db } from "../db/database"

// The offline desktop app has no login and no passwords: it always runs as the local
// administrator, a fixed identity (ADMIN001) used for audit records. The security boundary
// is the Windows account and physical access to the computer.

export interface LocalAdminResult {
  success: boolean
  user?: { id: number; name: string; staff_id: string; role: "admin" | "staff"; department_id?: number }
  error?: string
}

// ensureDefaultAdmin() runs at startup, so an admin account always exists.
export function getLocalAdmin(): LocalAdminResult {
  const user = db.queryOne<any>("SELECT * FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1")
  if (!user) return { success: false, error: "No active administrator account found." }
  return { success: true, user: { id: user.id, name: user.name, staff_id: user.staff_id, role: user.role, department_id: user.department_id } }
}

/** Creates the local administrator identity on a fresh database (without any password). */
export async function ensureDefaultAdmin(): Promise<void> {
  const adminExists = db.queryOne<any>("SELECT id FROM users WHERE role = 'admin'")
  if (!adminExists) {
    db.run(
      "INSERT INTO users(staff_id, name, role, is_active) VALUES(?,?,?,?)",
      ["ADMIN001", "System Administrator", "admin", 1]
    )
  }
}
