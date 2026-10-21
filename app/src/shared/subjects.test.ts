import { describe, it, expect } from "vitest"
import { planSeating, validateSeatingPlan, applySessionSubjects, sessionSubjectOf, normalizeConfig, type SeatStudent, type SeatHall, type SeatingConfig, type Gender } from "./seating"
import { assignHalls, minimumRepeats } from "./assignment"
import { categoryKey } from "./categories"

const AY = "2025-2026"
const FINAL = "2022-2026", THIRD = "2023-2027"
let nextId = 1
function students(gender: Gender, batch: string, count: number, dept: number): SeatStudent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId++, roll_no: `${dept}-${batch.slice(2, 4)}-${String(i + 1).padStart(3, "0")}`, gender, batch, department_id: dept, dept_code: `D${dept}`
  }))
}
const hall = (id: number, rows: number, cols: number): SeatHall => ({ id, hall_code: `H${id}`, rows, cols, disabled: [] })
const used = (ids: number[], extra: Partial<SeatingConfig> = {}): SeatingConfig => ({ halls: ids.map(hallId => ({ hallId, pattern: ["MM"] })), ...extra })

/** Pairs of seats side by side across the aisle (same row, next bench column) that hold the same paper. */
function sideClashes(plan: ReturnType<typeof planSeating>, all: SeatStudent[]) {
  const by = new Map(all.map(s => [s.id, s]))
  const at = new Map(plan.seats.map(x => [`${x.hallId}/${x.row}/${x.col}/${x.seat}`, by.get(x.studentId)!]))
  let n = 0
  for (const x of plan.seats) {
    if (x.seat !== "R") continue
    const right = at.get(`${x.hallId}/${x.row}/${x.col + 1}/L`)
    if (right && right.paper === by.get(x.studentId)!.paper) n++
  }
  return n
}

describe("Seating by subject", () => {
  it("without subjects the plan is exactly the plan by class", () => {
    const all = [...students("M", FINAL, 20, 1), ...students("M", THIRD, 20, 2)]
    const halls = [hall(1, 5, 4)]
    const a = planSeating(all, halls, used([1]), AY)
    const b = planSeating(applySessionSubjects(all, {}), halls, used([1]), AY)
    expect(b.seats).toEqual(a.seats)
  })

  it("two classes writing the same subject never share a bench", () => {
    // Departments 1 and 2 write subject 7, department 3 writes subject 8.
    const all = [...students("M", FINAL, 10, 1), ...students("M", FINAL, 10, 2), ...students("M", FINAL, 20, 3)]
    const subjects = { [categoryKey(1, FINAL)]: 7, [categoryKey(2, FINAL)]: 7, [categoryKey(3, FINAL)]: 8 }
    const papers = applySessionSubjects(all, subjects)
    const halls = [hall(1, 5, 4)]
    const cfg = used([1], { subjects })
    const plan = planSeating(papers, halls, cfg, AY)
    expect(validateSeatingPlan(plan, papers, halls, cfg).errors).toEqual([])
    expect(plan.unallocated).toEqual([])
    const by = new Map(papers.map(s => [s.id, s]))
    const benches = new Map<number, string[]>()
    for (const x of plan.seats) benches.set(x.benchNo, [...(benches.get(x.benchNo) ?? []), by.get(x.studentId)!.paper!])
    for (const b of benches.values()) if (b.length === 2) expect(b[0]).not.toBe(b[1])
  })

  it("students side by side across the aisle never write the same subject", () => {
    const all = [...students("M", FINAL, 30, 1), ...students("M", THIRD, 30, 2), ...students("M", THIRD, 20, 3)]
    const subjects = { [categoryKey(1, FINAL)]: 1, [categoryKey(2, THIRD)]: 2, [categoryKey(3, THIRD)]: 3 }
    const papers = applySessionSubjects(all, subjects)
    const halls = [hall(1, 5, 4), hall(2, 5, 4)]
    const cfg = used([1, 2], { subjects })
    const plan = planSeating(papers, halls, cfg, AY)
    expect(validateSeatingPlan(plan, papers, halls, cfg).errors).toEqual([])
    expect(sideClashes(plan, papers)).toBe(0)
    expect(plan.unallocated).toEqual([])
  })

  it("the validator reports two side-by-side students writing the same subject", () => {
    const papers = applySessionSubjects([...students("M", FINAL, 2, 1), ...students("M", THIRD, 2, 2)], { [categoryKey(1, FINAL)]: 1, [categoryKey(2, THIRD)]: 2 })
    const [a1, a2, b1, b2] = papers
    const halls = [hall(1, 1, 2)]
    const seat = (s: SeatStudent, col: number, side: "L" | "R") => ({ studentId: s.id, hallId: 1, row: 1, col, benchNo: col, seat: side })
    // Bench 1: a1 | b1, bench 2: b2 | a2. Bench mates differ, but b1 and b2 sit side by side.
    const plan = { seats: [seat(a1, 1, "L"), seat(b1, 1, "R"), seat(b2, 2, "L"), seat(a2, 2, "R")], unallocated: [] }
    expect(validateSeatingPlan(plan, papers, halls, used([1])).errors).toEqual([expect.stringMatching(/sit side by side and write the same subject/)])
  })

  it("the subjects are kept with the configuration", () => {
    expect(normalizeConfig({ halls: [], subjects: { "1|2022-2026": 4, bad: "x" as any } }, []).subjects).toEqual({ "1|2022-2026": 4 })
    expect(normalizeConfig({ halls: [] }, []).subjects).toBeUndefined()
  })
})

describe("Invigilators and subjects", () => {
  const staff = [1, 2, 3, 4], halls = [10, 20, 30, 40]

  it("keeps a person out of a hall writing a subject they handle", () => {
    // Person 1 handles the subject written in halls 10 and 20; person 2 the one in hall 30.
    const clash = (u: number, h: number) => (u === 1 && (h === 10 || h === 20)) || (u === 2 && h === 30)
    for (let s = 0; s < 20; s++) {
      const { entries } = assignHalls(staff, halls, () => [], `seed${s}`, clash)
      expect(entries.filter(e => clash(e.userId, e.hallId))).toEqual([])
    }
  })

  it("places a subject teacher in such a hall only when nothing else is possible", () => {
    // Everybody handles the subject of every hall: clashes cannot be avoided, everyone is still placed.
    const { entries } = assignHalls(staff, halls, () => [], "x", () => true)
    expect(new Set(entries.map(e => e.hallId)).size).toBe(4)
  })

  it("the rotation comes first: a clash is accepted rather than an R1 repeat", () => {
    // Person 1 has already had halls 20, 30 and 40 this cycle, so only hall 10 is new for them,
    // and hall 10 writes their subject.
    const history = (u: number) => (u === 1 ? [20, 30, 40] : [])
    const clash = (u: number, h: number) => u === 1 && h === 10
    const { entries, unavoidableRepeats } = assignHalls(staff, halls, history, "x", clash)
    expect(unavoidableRepeats).toBe(minimumRepeats(staff, halls, history))
    expect(entries.find(e => e.userId === 1)!.hallId).toBe(10)
  })

  it("without clashes the assignment is unchanged", () => {
    const history = (u: number) => [halls[u % 4]]
    for (let s = 0; s < 10; s++) {
      expect(assignHalls(staff, halls, history, `k${s}`, () => false)).toEqual(assignHalls(staff, halls, history, `k${s}`))
    }
  })
})

describe("Students mapped to subjects", () => {
  const s = (subject_ids?: number[]): SeatStudent => ({ id: nextId++, roll_no: "X", gender: "M", batch: FINAL, department_id: 1, subject_ids })
  const classSubject = { [categoryKey(1, FINAL)]: 9 }

  it("a student mapped to a subject of the exam writes it, before the class subject", () => {
    expect(sessionSubjectOf(s([3, 4]), classSubject, [4])).toEqual({ id: 4, from: "student", also: [] })
    expect(sessionSubjectOf(s([3]), classSubject, [4])).toEqual({ id: 9, from: "class", also: [] })
    expect(sessionSubjectOf(s(), {}, [4])).toBeNull()
  })

  it("a student mapped to two subjects of the same exam writes the first one ticked", () => {
    expect(sessionSubjectOf(s([3, 4]), {}, [4, 3])).toEqual({ id: 4, from: "student", also: [3] })
  })

  it("an elective splits a class: students of one class writing different subjects may share a bench", () => {
    // One class of 16: half mapped to elective 1, half to elective 2.
    const cls = students("M", FINAL, 16, 1).map((x, i) => ({ ...x, subject_ids: [i % 2 ? 2 : 1] }))
    const papers = applySessionSubjects(cls, {}, [1, 2])
    const halls = [hall(1, 4, 2)]
    const cfg = used([1], { sessionSubjects: [1, 2] })
    const plan = planSeating(papers, halls, cfg, AY)
    expect(validateSeatingPlan(plan, papers, halls, cfg).errors).toEqual([])
    expect(plan.unallocated).toEqual([])
  })
})
