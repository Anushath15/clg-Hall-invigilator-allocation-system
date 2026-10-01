/**
 * STAFF IMPORT FROM EXCEL (pure logic, no database access)
 * Shared by the desktop handler (master.ipc.ts) and the web build (web-api.ts), which
 * each supply the department lookup, the existing-staff check and the insert.
 */
import * as XLSX from "xlsx"

// Column names accepted in the staff import sheet, matched case-insensitively
// against the header row so "Staff ID", "staff id" and "staff_id" all work.
const STAFF_ID_ALIASES = ["staff id", "staff_id", "staffid", "id"]
const NAME_ALIASES = ["name", "staff name", "full name"]
const DEPARTMENT_ALIASES = ["department", "department code", "dept", "dept code", "department_code"]

function findColumn(headers: string[], aliases: string[]) {
  return headers.find(h => aliases.includes(h.trim().toLowerCase()))
}

// Reads the sheet's header row first so a whole-file problem ("no Department column at
// all") is reported once, up front, rather than as N confusing per-row errors. Only after
// all three required columns are confirmed present does it walk the data rows, collecting a
// specific reason for every row it skips (missing field, unknown department, duplicate staff
// ID) so the UI can show the person exactly what to fix instead of a bare "3 skipped".
export function importStaffFromSheet(
  sheet: XLSX.WorkSheet,
  findDepartment: (code: string) => { id: number } | undefined,
  findExistingStaff: (staffId: string) => { id: number } | undefined,
  insertStaff: (staffId: string, name: string, email: string | null, designation: string | null, deptId: number) => void
) {
  const headerRow = ((XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as any[]) || []).map(h => String(h ?? "").trim())
  const staffIdCol = findColumn(headerRow, STAFF_ID_ALIASES)
  const nameCol = findColumn(headerRow, NAME_ALIASES)
  const deptCol = findColumn(headerRow, DEPARTMENT_ALIASES)

  const missingColumns: string[] = []
  if (!staffIdCol) missingColumns.push("Staff ID")
  if (!nameCol) missingColumns.push("Name")
  if (!deptCol) missingColumns.push("Department")
  if (missingColumns.length) {
    return {
      success: false,
      error: `This Excel file is missing required column(s): ${missingColumns.join(", ")}. The first row must have a column for Staff ID, Name and Department.`,
      missingColumns
    }
  }

  const rows: any[] = XLSX.utils.sheet_to_json(sheet)
  if (rows.length === 0) {
    return { success: false, error: "This Excel file has no data rows below the header." }
  }

  let inserted = 0
  const issues: { row: number; reason: string }[] = []
  rows.forEach((row, idx) => {
    const excelRow = idx + 2 // +1 for 0-index, +1 for the header row
    const staffId = String(row[staffIdCol!] ?? "").trim()
    const name = String(row[nameCol!] ?? "").trim()
    const deptCode = String(row[deptCol!] ?? "").trim()

    const missing: string[] = []
    if (!staffId) missing.push("Staff ID")
    if (!name) missing.push("Name")
    if (!deptCode) missing.push("Department")
    if (missing.length) {
      issues.push({ row: excelRow, reason: `Missing ${missing.join(", ")}` })
      return
    }

    const dept = findDepartment(deptCode)
    if (!dept) {
      issues.push({ row: excelRow, reason: `Department "${deptCode}" does not match any existing department (check Master Data → Departments).` })
      return
    }

    if (findExistingStaff(staffId)) {
      issues.push({ row: excelRow, reason: `Staff ID "${staffId}" already exists — skipped.` })
      return
    }

    insertStaff(staffId, name, row["Email"] ?? null, row["Designation"] ?? null, dept.id)
    inserted++
  })

  return { success: true, inserted, skipped: issues.length, issues }
}
