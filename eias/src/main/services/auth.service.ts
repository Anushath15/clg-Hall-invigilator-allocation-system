import bcrypt from "bcryptjs"
import { db } from "../db/database"

export interface LoginResult {
  success: boolean
  user?: { id: number; name: string; staff_id: string; role: "admin" | "staff"; department_id?: number }
  error?: string
}

export async function login(staffId: string, password: string): Promise<LoginResult> {
  const user = db.queryOne<any>("SELECT * FROM users WHERE staff_id = ?", [staffId])
  if (!user) return { success: false, error: "Invalid Staff ID or password." }
  if (!user.is_active) return { success: false, error: "Account is inactive. Please contact administrator." }

  if (!user.password_hash) {
    const hash = await bcrypt.hash(password, 12)
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, user.id])
    return { success: true, user: { id: user.id, name: user.name, staff_id: user.staff_id, role: user.role, department_id: user.department_id } }
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return { success: false, error: "Invalid Staff ID or password." }
  try {
    db.run(
      "INSERT INTO audit_log(user_id, action, description, payload, created_at) VALUES(?,?,?,?,datetime('now'))",
      [user.id, "LOGIN", `User ${user.staff_id} logged in`, JSON.stringify({ role: user.role })]
    )
  } catch (e) {
    // Ignore audit failure
  }
  return { success: true, user: { id: user.id, name: user.name, staff_id: user.staff_id, role: user.role, department_id: user.department_id } }
}

export async function changePassword(userId: number, oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  const user = db.queryOne<any>("SELECT * FROM users WHERE id = ?", [userId])
  if (!user) return { success: false, error: "User not found." }
  if (user.password_hash) {
    const valid = await bcrypt.compare(oldPassword, user.password_hash)
    if (!valid) return { success: false, error: "Current password is incorrect." }
  }
  const hash = await bcrypt.hash(newPassword, 12)
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId])
  return { success: true }
}

export async function ensureDefaultAdmin(): Promise<void> {
  const adminExists = db.queryOne<any>("SELECT id FROM users WHERE role = 'admin'")
  if (!adminExists) {
    const hash = await bcrypt.hash("admin123", 12)
    db.run(
      "INSERT INTO users(staff_id, name, role, password_hash, is_active) VALUES(?,?,?,?,?)",
      ["ADMIN001", "System Administrator", "admin", hash, 1]
    )
  }
}
