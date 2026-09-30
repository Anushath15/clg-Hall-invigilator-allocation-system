import { describe, it, expect } from "vitest"
import { readDutyList } from "./duty-list"

const staff = [
  { id: 1, staff_id: "STF001", name: "Anitha R" },
  { id: 2, staff_id: "STF002", name: "Bala S" },
  { id: 3, staff_id: "1003", name: "Chitra M" },
  { id: 4, staff_id: "STF004", name: "Dinesh K" },
  { id: 5, staff_id: "STF005", name: "Dinesh K" }, // same name as id 4
]
const halls = [{ id: 10, hall_code: "H101" }, { id: 11, hall_code: "H102" }, { id: 12, hall_code: "H103" }]

describe("readDutyList (Excel duty list upload)", () => {
  it("matches a Staff ID column, ignoring case, spaces and numeric cells", () => {
    const r = readDutyList([["Staff ID", "Name"], [" stf001 ", "x"], ["STF002", ""], [1003, "Chitra"]], staff, halls)
    expect(r.matchedBy).toBe("staff id")
    expect(r.userIds).toEqual([1, 2, 3])
    expect(r.notFound).toEqual([])
    expect(r.hasHallColumn).toBe(false)
  })

  it("reports unknown IDs and duplicates", () => {
    const r = readDutyList([["staff_id"], ["STF001"], ["STF999"], ["stf001"]], staff, halls)
    expect(r.userIds).toEqual([1])
    expect(r.notFound).toEqual(["STF999"])
    expect(r.duplicates).toEqual(["stf001"])
  })

  it("reads a Hall column and reports unknown hall codes", () => {
    const r = readDutyList([["Staff ID", "Hall"], ["STF001", "H101"], ["STF002", "h102"], ["1003", "H999"]], staff, halls)
    expect(r.hasHallColumn).toBe(true)
    expect(r.userIds).toEqual([1, 2, 3])
    expect(r.hallIds).toEqual([10, 11])
    expect(r.hallsNotFound).toEqual(["H999"])
  })

  it("falls back to names when there is no Staff ID column, flagging ambiguous names", () => {
    const r = readDutyList([["Name"], ["anitha  r"], ["Dinesh K"], ["Nobody"]], staff, halls)
    expect(r.matchedBy).toBe("name")
    expect(r.userIds).toEqual([1])
    expect(r.ambiguous).toEqual(["Dinesh K"])
    expect(r.notFound).toEqual(["Nobody"])
  })

  it("treats the first column as Staff IDs when there is no header, skipping blank rows", () => {
    const r = readDutyList([["STF002"], [], ["", ""], ["STF004"]], staff, halls)
    expect(r.userIds).toEqual([2, 4])
  })

  it("finds a header below a title row", () => {
    const r = readDutyList([["November Exams - FN duty list"], [], ["S.No", "Staff ID", "Name"], [1, "STF005", "Dinesh K"]], staff, halls)
    expect(r.userIds).toEqual([5])
  })
})
