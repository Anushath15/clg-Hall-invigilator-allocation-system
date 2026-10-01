/**
 * The selector dialog's search (lib/search.ts), used for both lists: staff by name or Staff ID,
 * halls by hall code or block.
 */
import { describe, it, expect } from "vitest"
import { matchesSearch } from "./search"

const halls = [
  { id: 1, hall_code: "H101", block: "A", floor: "Ground" },
  { id: 2, hall_code: "H102", block: "Main Block", floor: "1st" },
  { id: 3, hall_code: "H104", block: "Main Block", floor: "2nd" },
  { id: 4, hall_code: "LAB-1", block: null, floor: null },
]
const hallSearch = (q: string) => halls.filter(h => matchesSearch(q, h.hall_code, h.block)).map(h => h.hall_code)

const staff = [
  { id: 1, name: "Anitha R", staff_id: "STF001" },
  { id: 2, name: "Bala S", staff_id: "STF002" },
  { id: 3, name: null, staff_id: 1003 },
]
const staffSearch = (q: string) => staff.filter(u => matchesSearch(q, u.name, u.staff_id)).map(u => u.id)

describe("Hall search", () => {
  it("filters by hall code", () => {
    expect(hallSearch("H101")).toEqual(["H101"])
    expect(hallSearch("H10")).toEqual(["H101", "H102", "H104"]) // matches anywhere, like the staff search
  })
  it("filters by block name", () => {
    expect(hallSearch("Main Block")).toEqual(["H102", "H104"])
    expect(hallSearch("block")).toEqual(["H102", "H104"])
  })
  it("ignores case and surrounding spaces", () => {
    expect(hallSearch("h104")).toEqual(["H104"])
    expect(hallSearch("  MAIN block ")).toEqual(["H102", "H104"])
    expect(hallSearch("lab-1")).toEqual(["LAB-1"])
  })
  it("matches nothing when no hall fits, and everything for an empty search", () => {
    expect(hallSearch("H999")).toEqual([])
    expect(hallSearch("Ground")).toEqual([]) // the floor is not searched
    expect(hallSearch("")).toEqual(["H101", "H102", "H104", "LAB-1"])
    expect(hallSearch("   ")).toEqual(["H101", "H102", "H104", "LAB-1"])
  })
})

describe("Staff search (same function)", () => {
  it("filters by name or Staff ID, ignoring case; missing fields never match", () => {
    expect(staffSearch("anitha")).toEqual([1])
    expect(staffSearch("stf00")).toEqual([1, 2])
    expect(staffSearch("1003")).toEqual([3]) // numeric Staff ID
    expect(staffSearch("zzz")).toEqual([])
    expect(staffSearch("")).toEqual([1, 2, 3])
  })
})
