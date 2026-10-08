/** Field rules for every form (shared/validation.ts): offline format checks only. */
import { describe, it, expect } from "vitest"
import * as V from "./validation"

describe("Staff fields", () => {
  it("designation: words pass, numbers alone do not, letters mixed with digits pass", () => {
    for (const ok of ["Assistant Professor", "harish101", "Prof101", "HOD (CSE)", "", "  ", undefined, null]) expect(V.validateDesignation(ok), String(ok)).toBeNull()
    for (const bad of ["1010", "10120", " 55 ", "---", "12-34"]) expect(V.validateDesignation(bad), bad).toMatch(/must contain letters/)
    expect(V.validateDesignation("x".repeat(61))).toMatch(/at most 60/)
  })
  it("e-mail: a real address shape passes, a missing domain ending does not", () => {
    for (const ok of ["harish@gmail.com", "a.b@c.co.in", "  name@example.edu  ", "", undefined]) expect(V.validateEmail(ok), String(ok)).toBeNull()
    for (const bad of ["harish@gmail", "harish", "@gmail.com", "a b@c.com", "a@@c.com", "a@c.", "a@.com", "a@c..com"]) expect(V.validateEmail(bad), bad).toMatch(/not valid/)
  })
  it("Staff ID: required, no spaces or odd characters; numbers are fine (101)", () => {
    for (const ok of ["STF001", "101", "CSE-12", "a_b.c/d"]) expect(V.validateStaffId(ok), ok).toBeNull()
    expect(V.validateStaffId("")).toBe("Staff ID is required.")
    expect(V.validateStaffId("STF 001")).toMatch(/no spaces/)
    expect(V.validateStaffId("STF#1")).toMatch(/only letters/)
    expect(V.validateStaffId("S".repeat(21))).toMatch(/at most 20/)
  })
  it("name: needs a letter; initials, dots and apostrophes are fine", () => {
    for (const ok of ["Anitha R", "Dr. A. P. J. Kumar", "O'Brien", "Mary-Ann", "Staff 12"]) expect(V.validateStaffName(ok), ok).toBeNull()
    expect(V.validateStaffName("")).toBe("Full Name is required.")
    expect(V.validateStaffName("1010")).toMatch(/not only numbers/)
    expect(V.validateStaffName("A")).toMatch(/too short/)
    expect(V.validateStaffName("Bob <b>")).toMatch(/not allowed/)
  })
  it("a record reports its first problem", () => {
    expect(V.validateStaff({ staff_id: "S1", name: "Anitha", designation: "Professor", email: "a@b.com" })).toBeNull()
    expect(V.validateStaff({ staff_id: "", name: "1010" })).toBe("Staff ID is required.")
    expect(V.validateStaff({ staff_id: "S1", name: "Anitha", designation: "1010" })).toMatch(/Designation/)
    expect(V.validateStaff({ staff_id: "S1", name: "Anitha", email: "harish@gmail" })).toMatch(/E-mail/)
  })
})

describe("Department, hall, batch, settings, times", () => {
  it("department code and name", () => {
    for (const ok of ["CSE", "Mech", "S-H", "IT2"]) expect(V.validateDepartmentCode(ok), ok).toBeNull()
    for (const bad of ["", "123", "C S E", "CSE&ECE", "ABCDEFGHIJKLM"]) expect(V.validateDepartmentCode(bad), bad).not.toBeNull()
    expect(V.validateDepartmentName("Computer Science")).toBeNull()
    expect(V.validateDepartmentName("1234")).not.toBeNull()
  })
  it("hall block and floor lengths", () => {
    expect(V.validateHallPlace("Block", "Main Block")).toBeNull()
    expect(V.validateHallPlace("Floor", "x".repeat(41))).toMatch(/Floor can be at most 40/)
  })
  it("batch name and academic year", () => {
    expect(V.validateBatchName("November 2026 End Semester")).toBeNull()
    expect(V.validateBatchName("  ")).not.toBeNull()
    expect(V.validateBatchName("2026")).not.toBeNull()
    for (const ok of ["2026-27", "2026-2027", "1999-00", "2099-2100"]) expect(V.validateAcademicYear(ok), ok).toBeNull()
    for (const bad of ["", "2026", "2026-28", "2026-2028", "26-27", "2026/27", "2027-26"]) expect(V.validateAcademicYear(bad), bad).not.toBeNull()
  })
  it("college names", () => {
    expect(V.validateCollegeName("St. Xavier's")).toBeNull()
    expect(V.validateCollegeName(" ")).toMatch(/required/)
    expect(V.validateCollegeShortName("SXCCE")).toBeNull()
    expect(V.validateCollegeShortName("")).toMatch(/required/)
    expect(V.validateCollegeShortName("X".repeat(13))).toMatch(/at most 12/)
  })
  it("times of day and session times", () => {
    for (const ok of ["00:00", "09:30", "23:59"]) expect(V.validateTimeOfDay(ok), ok).toBeNull()
    for (const bad of ["24:00", "9:30", "09:60", "", "abc"]) expect(V.validateTimeOfDay(bad), bad).not.toBeNull()
    expect(V.validateSessionTimes("09:15", "09:30", "12:30")).toBeNull()
    expect(V.validateSessionTimes("09:30", "09:30", "12:30")).toBeNull() // reporting at the start is allowed
    expect(V.validateSessionTimes("09:45", "09:30", "12:30")).toMatch(/Reporting time must be at or before/)
    expect(V.validateSessionTimes("09:15", "12:30", "09:30")).toMatch(/Exam end must be after/)
    expect(V.validateSessionTimes("09:15", "09:30", "09:30")).toMatch(/Exam end must be after/)
    expect(V.validateSessionTimes("", "09:30", "12:30")).toMatch(/required/)
  })
})

describe("Deleting a batch", () => {
  const base = { batchName: "November 2026 End Semester", typedBatchName: "November 2026 End Semester", personName: "Anitha R", staffId: "STF001" }
  it("passes with the exact batch name, a name and a Staff ID", () => {
    expect(V.validateBatchDeletion(base)).toBeNull()
    expect(V.validateBatchDeletion({ ...base, typedBatchName: "  november 2026 end semester " })).toBeNull()
  })
  it("reports the first thing missing or wrong", () => {
    expect(V.validateBatchDeletion({ ...base, typedBatchName: "" })).toBe("Type the batch name to confirm.")
    expect(V.validateBatchDeletion({ ...base, typedBatchName: "November 2026" })).toMatch(/does not match/)
    expect(V.validateBatchDeletion({ ...base, personName: " " })).toBe("Enter your name.")
    expect(V.validateBatchDeletion({ ...base, personName: "1010" })).toMatch(/Your name must contain letters/)
    expect(V.validateBatchDeletion({ ...base, staffId: "" })).toBe("Enter your Staff ID.")
    expect(V.validateBatchDeletion({ ...base, staffId: "ST F1" })).toMatch(/no spaces/)
  })
})
