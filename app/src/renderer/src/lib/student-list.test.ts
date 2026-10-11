import { describe, it, expect } from "vitest"
import { readStudentList } from "./student-list"

const students = [
  { id: 1, roll_no: "23CS001", register_no: "961223104001" },
  { id: 2, roll_no: "23CS002", register_no: "961223104002" },
  { id: 3, roll_no: "24EC001", register_no: "961224106001" }
]

describe("Uploaded student list", () => {
  it("matches a Register No column, reporting unknown and repeated values", () => {
    const r = readStudentList([["Sl", "Register No", "Name"], [1, "961223104001", "A"], [2, 961224106001, "C"], [3, "999", "X"], [4, "961223104001", "A"]], students)
    expect(r).toEqual({ studentIds: [1, 3], notFound: ["999"], duplicates: ["961223104001"] })
  })

  it("matches a Roll No column ignoring case", () => {
    expect(readStudentList([["Roll No"], ["23cs002"], ["24EC001"]], students).studentIds).toEqual([2, 3])
  })

  it("without a header the first column holds register or roll numbers", () => {
    expect(readStudentList([["23CS001"], ["961223104002"], [""]], students).studentIds).toEqual([1, 2])
  })
})
