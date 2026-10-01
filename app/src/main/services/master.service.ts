/**
 * MASTER DATA: departments and the staff list.
 * Department codes are saved exactly as typed but treated case-insensitively: "CSE" and
 * "cse" are the same department (a second one is refused), lookups ignore case, and lists
 * sort by code ignoring case. The UNIQUE constraint on departments.code is case-sensitive,
 * so the check lives here rather than in the schema; existing databases need no migration.
 */
import { db } from "../db/database"

export interface DepartmentInput { id?: number; code: string; name: string; is_active?: boolean }

export function saveDepartment(data: DepartmentInput): { success: boolean; error?: string; department?: any } {
  if (!String(data?.code ?? "").trim() || !String(data?.name ?? "").trim()) return { success: false, error: "Code and Name are required." }
  const clash = db.queryOne<any>("SELECT code FROM departments WHERE code = ? COLLATE NOCASE AND id != ?", [data.code, data.id ?? 0])
  if (clash) return { success: false, error: `A department with code "${clash.code}" already exists (codes are not case-sensitive).` }
  if (data.id) {
    db.run("UPDATE departments SET code=?,name=?,is_active=? WHERE id=?", [data.code, data.name, data.is_active ? 1 : 0, data.id])
    return { success: true, department: db.queryOne("SELECT * FROM departments WHERE id=?", [data.id]) }
  }
  const { lastInsertRowid } = db.run("INSERT INTO departments(code,name) VALUES(?,?)", [data.code, data.name])
  return { success: true, department: db.queryOne("SELECT * FROM departments WHERE id=?", [lastInsertRowid]) }
}

/** The department an import row names, by code or name, ignoring case; a code match wins over a name match. */
export function findDepartmentByCodeOrName(value: string): { id: number } | undefined {
  return db.queryOne<any>(
    "SELECT id FROM departments WHERE code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE ORDER BY (code = ? COLLATE NOCASE) DESC, id LIMIT 1",
    [value, value, value]
  )
}

/** Every users column except password_hash (the desktop app has no passwords; never send one to the window). */
export const USER_COLUMNS = "id, staff_id, name, email, designation, role, department_id, is_active, created_at, updated_at"

export function listUsers(filters?: { role?: string; is_active?: boolean; department_id?: number }) {
  let sql = `SELECT ${USER_COLUMNS.split(", ").map(c => "u." + c).join(", ")}, d.name as department_name, d.code as department_code
             FROM users u LEFT JOIN departments d ON u.department_id=d.id WHERE 1=1`
  const params: any[] = []
  if (filters?.role) { sql += ` AND u.role=?`; params.push(filters.role) }
  if (filters?.is_active !== undefined) { sql += ` AND u.is_active=?`; params.push(filters.is_active ? 1 : 0) }
  if (filters?.department_id) { sql += ` AND u.department_id=?`; params.push(filters.department_id) }
  sql += ` ORDER BY d.code COLLATE NOCASE, u.name`
  return db.query(sql, params)
}
