import { describe, it, expect } from "vitest"
import {
  planSeating, benchUnits, validateSeatingPlan, checkConfig, autoConfigure, mergeConfig, normalizeConfig, studentCategories, unallocatedMessage,
  type SeatStudent, type SeatHall, type Gender, type SeatingConfig, type SeatingPlan
} from "./seating"
import { categoryKey, yearOfStudy, academicStartYear } from "./categories"
import { enabledBenches, benchKey, validateHallLayout, cleanDisabled } from "./hall-layout"
import { validateStudent, validateStudentBatch, parseGender } from "./validation"
import { patternSlotAt, validatePattern, type SeatingPattern, type PatternSlot } from "./seating-pattern"

/** Academic year of every plan below: batch 2022-2026 is Final Year, 2023-2027 Third, 2024-2028 Second, 2025-2029 First. */
const AY = "2025-2026"
const FINAL = "2022-2026", THIRD = "2023-2027", SECOND = "2024-2028"
const DEPTS: Record<string, number> = { CSE: 1, IT: 2, ECE: 3, EEE: 4, AIDS: 5 }

let nextId = 1
function students(gender: Gender, batch: string, count: number, dept = "CSE"): SeatStudent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId++, roll_no: `${batch.slice(2, 4)}${dept}${gender}${String(i + 1).padStart(3, "0")}`, gender, batch, department_id: DEPTS[dept], dept_code: dept
  }))
}
const hall = (id: number, rows: number, cols: number, extra: Partial<SeatHall> = {}): SeatHall => ({ id, hall_code: `H${id}`, rows, cols, disabled: [], ...extra })
const key = (dept: string, batch: string) => categoryKey(DEPTS[dept], batch)
/** A hall's settings: gender, the categories it may hold (quantity null = fill) and optional limit. */
const cfgHall = (hallId: number, gender: Gender | null, cats: [string, string, (number | null)?][], maxCategories: number | null = null, genderFixed = true) =>
  ({ hallId, gender, genderFixed, maxCategories, categories: cats.map(([d, b, q]) => ({ key: key(d, b), quantity: q ?? null })) })
const config = (halls: SeatingConfig["halls"], categoryOrder: string[] = []): SeatingConfig => ({ categoryOrder, halls })

/** Checks a plan with the independent validator and returns its benches as student lists. */
function checkPlan(all: SeatStudent[], halls: SeatHall[], cfg: SeatingConfig | null, plan: SeatingPlan) {
  expect(validateSeatingPlan(plan, all, halls, cfg, AY).errors).toEqual([])
  const byId = new Map(all.map(s => [s.id, s]))
  const benches = new Map<string, SeatStudent[]>()
  for (const s of plan.seats) benches.set(`${s.hallId}/${s.benchNo}`, [...(benches.get(`${s.hallId}/${s.benchNo}`) ?? []), byId.get(s.studentId)!])
  return [...benches.values()]
}
const yearOf = (s: SeatStudent) => (yearOfStudy(s.batch, AY) as any).label
const seatedIn = (plan: SeatingPlan, hallId: number) => plan.seats.filter(s => s.hallId === hallId).map(s => s.studentId)

describe("Hall bench layout", () => {
  it("numbers benches column by column, front to back, skipping switched-off ones", () => {
    const b = enabledBenches({ rows: 3, cols: 2, disabled: [benchKey(2, 1)] })
    expect(b).toEqual([
      { row: 1, col: 1, benchNo: 1 }, { row: 3, col: 1, benchNo: 2 },
      { row: 1, col: 2, benchNo: 3 }, { row: 2, col: 2, benchNo: 4 }, { row: 3, col: 2, benchNo: 5 }
    ])
  })

  it("6 columns x 6 rows with the last bench of column 3 removed has 35 benches", () => {
    expect(enabledBenches({ rows: 6, cols: 6, disabled: [benchKey(6, 3)] })).toHaveLength(35)
  })

  it("rows and columns must both be set (or both 0) and within limits", () => {
    expect(validateHallLayout(6, 6)).toBeNull()
    expect(validateHallLayout(0, 0)).toBeNull()
    expect(validateHallLayout(6, 0)).toMatch(/both/)
    expect(validateHallLayout(2.5, 3)).toMatch(/whole/)
    expect(validateHallLayout(31, 3)).toMatch(/at most/)
  })

  it("drops switched-off positions outside a shrunk grid", () => {
    expect(cleanDisabled({ rows: 2, cols: 2, disabled: ["1-1", "3-1", "2-5", "x", "1-1"] })).toEqual(["1-1"])
  })
})

describe("Student fields", () => {
  it("batch is start year - end year, end after start", () => {
    expect(validateStudentBatch("2023-2026")).toBeNull()
    expect(validateStudentBatch("2023-2027")).toBeNull()
    expect(validateStudentBatch("2023 - 2027")).toBeNull()
    expect(validateStudentBatch("2023-27")).toMatch(/look like/)
    expect(validateStudentBatch("2027-2023")).toMatch(/after/)
  })
  it("gender accepts Male/Female/Boy/Girl/M/F", () => {
    expect(["Male", "m", "BOY"].map(parseGender)).toEqual(["M", "M", "M"])
    expect(["Female", "f", "girl"].map(parseGender)).toEqual(["F", "F", "F"])
    expect(parseGender("other")).toBeNull()
  })
  it("a complete student passes; each missing field is reported", () => {
    const ok = { roll_no: "23CS001", register_no: "961223104001", name: "Anu S", gender: "F", batch: "2023-2027" }
    expect(validateStudent(ok)).toBeNull()
    expect(validateStudent({ ...ok, roll_no: "" })).toBe("Roll Number is required.")
    expect(validateStudent({ ...ok, register_no: "96 12" })).toMatch(/Register Number can contain only/)
    expect(validateStudent({ ...ok, name: "" })).toBe("Name is required.")
    expect(validateStudent({ ...ok, gender: "X" })).toMatch(/Gender/)
    expect(validateStudent({ ...ok, batch: "2023" })).toMatch(/Batch/)
  })
})


describe("Student categories and academic year", () => {
  it("derives the year of study from the batch and the cycle's academic year; the last year is Final Year", () => {
    expect(yearOfStudy("2022-2026", "2025-2026")).toMatchObject({ ok: true, year: 4, label: "Final Year" })
    expect(yearOfStudy("2023-2027", "2025-26")).toMatchObject({ ok: true, year: 3, label: "Third Year" })
    expect(yearOfStudy("2025-2029", "2025-2026")).toMatchObject({ ok: true, year: 1, label: "First Year" })
    expect(yearOfStudy("2023-2026", "2025-2026")).toMatchObject({ ok: true, year: 3, label: "Final Year" }) // a 3-year batch
    expect(academicStartYear("2026-27")).toBe(2026)
  })
  it("a batch not yet started or already finished has no academic year, with the reason", () => {
    expect(yearOfStudy("2026-2030", AY)).toMatchObject({ ok: false, reason: expect.stringMatching(/not started/) })
    expect(yearOfStudy("2020-2024", AY)).toMatchObject({ ok: false, reason: expect.stringMatching(/already finished/) })
    expect(yearOfStudy("2022-2026", "")).toMatchObject({ ok: false, reason: expect.stringMatching(/academic year/) })
  })
  it("groups students by department and batch, counting boys and girls, in batch then department order", () => {
    const { categories } = studentCategories([...students("M", THIRD, 2, "IT"), ...students("F", FINAL, 3, "CSE"), ...students("M", FINAL, 1, "CSE")], AY)
    expect(categories.map(c => [c.label, c.boys, c.girls])).toEqual([["CSE – Final Year (2022-2026)", 1, 3], ["IT – Third Year (2023-2027)", 2, 0]])
  })
})

describe("Seating plan: bench rule (different academic years)", () => {
  it("students of the same department but different years may share a bench", () => {
    const all = [...students("M", FINAL, 10, "CSE"), ...students("M", THIRD, 10, "CSE")]
    const halls = [hall(1, 5, 2)] // 10 benches
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["CSE", THIRD]])])
    const plan = planSeating(all, halls, cfg, AY)
    const benches = checkPlan(all, halls, cfg, plan)
    expect(benches).toHaveLength(10)
    for (const b of benches) expect(b.map(yearOf).sort()).toEqual(["Final Year", "Third Year"])
    expect(plan.unallocated).toEqual([])
  })

  it("students of the same year never share a bench, even from different departments; extras are unallocated, not paired", () => {
    const all = [...students("M", FINAL, 10, "CSE"), ...students("M", FINAL, 10, "IT")]
    const halls = [hall(1, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["IT", FINAL]])])
    const plan = planSeating(all, halls, cfg, AY)
    const benches = checkPlan(all, halls, cfg, plan)
    expect(benches.every(b => b.length === 1)).toBe(true)
    expect(plan.seats).toHaveLength(10)
    expect(plan.unallocated).toHaveLength(10)
    expect(plan.unallocated[0].reason).toMatch(/No compatible bench mate/)
  })

  it("a valid pairing is impossible (one year only): students sit alone and the rest are listed with the reason", () => {
    const all = students("M", FINAL, 25)
    const halls = [hall(1, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL]])])
    const plan = planSeating(all, halls, cfg, AY)
    const benches = checkPlan(all, halls, cfg, plan)
    expect(benches).toHaveLength(10)
    expect(benches.every(b => b.length === 1)).toBe(true)
    expect(plan.unallocated).toHaveLength(15)
    expect(plan.halls[0]).toMatchObject({ occupied: 10, empty: 10, capacity: 20 })
    expect(unallocatedMessage(plan)).toBe("15 boys could not be seated under the seating rules.")
  })

  it("a 3-year and a 4-year batch in their last year are both Final Year and never share a bench", () => {
    const all = [...students("M", FINAL, 4, "CSE"), ...students("M", "2023-2026", 4, "IT"), ...students("M", THIRD, 8, "ECE")]
    const halls = [hall(1, 4, 2)] // 8 benches
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["IT", "2023-2026"], ["ECE", THIRD]])])
    const plan = planSeating(all, halls, cfg, AY)
    const benches = checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    for (const b of benches) expect(new Set(b.map(yearOf)).size).toBe(b.length)
  })

  it("benchUnits pairs different years and seats the extras of a large year alone", () => {
    const y = (s: string) => s[0]
    expect(benchUnits(["A1", "A2", "B1", "B2", "C1"], y).map(u => u.left + (u.right ?? ""))).toEqual(["A1B2", "A2C1", "B1"])
    expect(benchUnits(["A1", "A2", "A3", "A4", "B1"], y).map(u => u.left + (u.right ?? ""))).toEqual(["A1B1", "A2", "A3", "A4"])
  })
})

describe("Seating plan: halls, genders and categories", () => {
  it("boys and girls go only to halls assigned to them", () => {
    const all = [...students("M", FINAL, 10), ...students("M", THIRD, 10), ...students("F", FINAL, 8), ...students("F", THIRD, 8)]
    const halls = [hall(1, 5, 2), hall(2, 5, 2)]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD]]
    const cfg = config([cfgHall(1, "F", cats), cfgHall(2, "M", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    const gender = new Map(all.map(s => [s.id, s.gender]))
    expect(new Set(seatedIn(plan, 1).map(id => gender.get(id)))).toEqual(new Set(["F"]))
    expect(new Set(seatedIn(plan, 2).map(id => gender.get(id)))).toEqual(new Set(["M"]))
    expect(plan.hallGender).toEqual({ 1: "F", 2: "M" })
  })

  it("a group with no hall is unallocated with the reason", () => {
    const all = [...students("M", FINAL, 2), ...students("F", THIRD, 3)]
    const halls = [hall(1, 2, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["CSE", THIRD]])])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated.map(u => u.reason)).toEqual(Array(3).fill("No hall with benches is assigned to girls."))
  })

  it("all students of one category continue in roll order from one hall into the next", () => {
    const final = students("M", FINAL, 50, "CSE"), third = students("M", THIRD, 30, "IT")
    const all = [...third, ...final]
    const halls = [hall(1, 5, 2), hall(2, 5, 3), hall(3, 5, 5)] // 10, 15, 25 benches
    const cats: [string, string][] = [["CSE", FINAL], ["IT", THIRD]]
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "M", cats), cfgHall(3, "M", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    const finalIds = final.map(s => s.id)
    const inHall = (h: number) => finalIds.filter(id => seatedIn(plan, h).includes(id))
    expect(inHall(1)).toEqual(finalIds.slice(0, 10))
    expect(inHall(2)).toEqual(finalIds.slice(10, 25))
    expect(inHall(3)).toEqual(finalIds.slice(25, 50))
    expect(plan.halls.map(h => h.occupied)).toEqual([20, 30, 30]) // earlier halls fill first
  })

  it("halls are filled in the configured order, not the hall list order", () => {
    const all = [...students("M", FINAL, 4), ...students("M", THIRD, 4)]
    const halls = [hall(1, 2, 2), hall(2, 2, 2)]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD]]
    const cfg = config([cfgHall(2, "M", cats), cfgHall(1, "M", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    expect(seatedIn(plan, 2)).toHaveLength(8)
    expect(seatedIn(plan, 1)).toHaveLength(0)
    expect(plan.halls.map(h => h.hallId)).toEqual([2, 1])
    expect(plan.warnings).toContain("Hall H1: No students in this hall.")
  })

  it("a hall takes only the categories selected for it, never others to fill empty seats", () => {
    const all = [...students("M", FINAL, 4, "CSE"), ...students("M", THIRD, 6, "IT")]
    const halls = [hall(1, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL]])])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.seats).toHaveLength(4)
    expect(plan.unallocated.map(u => u.reason)).toEqual(Array(6).fill("No boys' hall permits IT – Third Year (2023-2027)."))
  })

  it("the category limit holds: the smallest extra category moves on to the next hall that permits it", () => {
    const all = [...students("M", FINAL, 6, "CSE"), ...students("M", THIRD, 6, "CSE"), ...students("M", SECOND, 6, "IT")]
    const halls = [hall(1, 5, 2), hall(2, 5, 2)]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD], ["IT", SECOND]]
    const cfg = config([cfgHall(1, "M", cats, 2), cfgHall(2, "M", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.halls[0].categories.filter(c => c.actual > 0).map(c => c.key)).toEqual([key("CSE", FINAL), key("CSE", THIRD)])
    expect(plan.halls[1].categories.filter(c => c.actual > 0).map(c => [c.key, c.actual])).toEqual([[key("IT", SECOND), 6]])
  })

  it("three categories of one department count as three categories", () => {
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 3), ...students("M", SECOND, 3)]
    const halls = [hall(1, 5, 2)]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD], ["CSE", SECOND]]
    const ok = planSeating(all, halls, config([cfgHall(1, "M", cats, 3)]), AY)
    expect(ok.unallocated).toEqual([])
    const limited = planSeating(all, halls, config([cfgHall(1, "M", cats, 2)]), AY)
    expect(limited.seats).toHaveLength(6)
    expect(limited.unallocated[0].reason).toMatch(/category limits/)
  })

  it("the hall's default category limit applies unless the session sets its own", () => {
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 3)]
    const halls = [hall(1, 5, 2, { default_max_categories: 1 })]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD]]
    expect(planSeating(all, halls, config([cfgHall(1, "M", cats)]), AY).seats).toHaveLength(3)
    expect(planSeating(all, halls, config([cfgHall(1, "M", cats, 2)]), AY).seats).toHaveLength(6)
  })

  it("students whose batch is not studying this academic year are listed, never seated", () => {
    const all = [...students("M", "2026-2030", 2), ...students("M", FINAL, 2)]
    const halls = [hall(1, 2, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["CSE", "2026-2030"]])])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated.map(u => u.reason)).toEqual(Array(2).fill("Batch 2026-2030 has not started in academic year 2025-2026."))
  })

  it("halls without a bench layout get nobody and a warning", () => {
    const all = students("M", FINAL, 2)
    const halls = [hall(1, 0, 0), hall(2, 1, 2)]
    const cats: [string, string][] = [["CSE", FINAL]]
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "M", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(seatedIn(plan, 2)).toHaveLength(2)
    expect(plan.warnings[0]).toMatch(/H1 has no bench layout/)
  })

  it("switched-off benches are never used", () => {
    const disabled = [benchKey(5, 3), benchKey(6, 3), benchKey(6, 6)]
    const all = [...students("M", FINAL, 33), ...students("M", THIRD, 33)]
    const halls = [hall(1, 6, 6, { disabled })]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["CSE", THIRD]])])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.seats).toHaveLength(66)
    for (const s of plan.seats) expect(disabled).not.toContain(benchKey(s.row, s.col))
  })
})

describe("Seating plan: requested quantities", () => {
  it("meets requested quantities, the rest of each category continuing in the next hall", () => {
    const cseFinal = students("M", FINAL, 30, "CSE")
    const all = [...cseFinal, ...students("M", THIRD, 10, "CSE"), ...students("M", SECOND, 10, "IT")]
    const halls = [hall(1, 5, 2), hall(2, 5, 2)]
    const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD], ["IT", SECOND]]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL, 10], ["CSE", THIRD, 5], ["IT", SECOND, 5]]), cfgHall(2, "M", cats)])
    expect(checkConfig(cfg, halls, studentCategories(all, AY).categories).errors).toEqual([])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.halls[0].categories.map(c => [c.requested, c.actual])).toEqual([[10, 10], [5, 5], [5, 5]])
    expect(seatedIn(plan, 1).filter(id => cseFinal.some(s => s.id === id))).toEqual(cseFinal.slice(0, 10).map(s => s.id))
    expect(plan.halls[1].occupied).toBe(20)
    expect(plan.unallocated).toHaveLength(10) // hall 2 is full
    expect(plan.unallocated.every(u => /Insufficient hall capacity/.test(u.reason))).toBe(true)
  })

  it("requested quantities above the hall's seats are refused before planning", () => {
    const all = [...students("M", FINAL, 30), ...students("M", THIRD, 30)]
    const halls = [hall(1, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL, 10], ["CSE", THIRD, 14]])])
    expect(checkConfig(cfg, halls, studentCategories(all, AY).categories).errors[0]).toMatch(/24 students requested, but it seats only 20/)
  })

  it("quantities for more categories than the limit are refused", () => {
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 3), ...students("M", SECOND, 3)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL, 2], ["CSE", THIRD, 2], ["CSE", SECOND, 2]], 2)])
    expect(checkConfig(cfg, [hall(1, 5, 2)], studentCategories(all, AY).categories).errors[0]).toMatch(/3 categories, but the hall allows at most 2/)
  })

  it("more of one year than benches: warned; the hall seats one per bench and the rest move on", () => {
    const all = [...students("M", FINAL, 15, "CSE"), ...students("M", THIRD, 5, "IT")]
    const halls = [hall(1, 5, 2), hall(2, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL, 15], ["IT", THIRD, 5]]), cfgHall(2, "M", [["CSE", FINAL]])])
    expect(checkConfig(cfg, halls, studentCategories(all, AY).categories).warnings[0]).toMatch(/15 Final Year students requested.*at most 10/)
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.halls[0].categories.map(c => c.actual)).toEqual([10, 5])
    expect(seatedIn(plan, 2)).toHaveLength(5)
    expect(plan.halls[0].warnings).toEqual(["15 CSE – Final Year (2022-2026) requested, 10 allocated."])
  })

  it("a category with fewer students than requested: all of them are allocated and the shortage reported", () => {
    const all = [...students("M", FINAL, 4), ...students("M", THIRD, 10, "IT")]
    const halls = [hall(1, 5, 2)]
    const cfg = config([cfgHall(1, "M", [["CSE", FINAL, 10], ["IT", THIRD, 10]])])
    expect(checkConfig(cfg, halls, studentCategories(all, AY).categories).warnings).toContain("Hall H1: 10 CSE – Final Year (2022-2026) boys requested, but only 4 are selected.")
    const plan = planSeating(all, halls, cfg, AY)
    expect(plan.halls[0].categories.map(c => c.actual)).toEqual([4, 10])
    expect(validateSeatingPlan(plan, all, halls, cfg, AY).warnings).toEqual(["Hall H1: 10 requested of one category, 4 allocated."])
  })
})

describe("Seating plan: validation and reproducibility", () => {
  const a = students("M", FINAL, 3, "CSE"), b = students("M", THIRD, 3, "IT"), g = students("F", THIRD, 1, "IT")
  const all = [...a, ...b, ...g]
  const halls = [hall(1, 1, 2), hall(2, 1, 1)] // 2 benches, 1 bench
  const cfg = config([cfgHall(1, "M", [["CSE", FINAL], ["IT", THIRD]], 2), cfgHall(2, "F", [["IT", THIRD]])])
  const seat = (studentId: number, hallId: number, benchNo: number, side: "L" | "R") => ({ studentId, hallId, row: 1, col: benchNo, benchNo, seat: side })
  const rest = (ids: number[]) => all.filter(s => !ids.includes(s.id)).map(s => ({ studentId: s.id, roll_no: s.roll_no, gender: s.gender, categoryKey: "", category: "", reason: "x" }))
  const errorsOf = (seats: any[]) => validateSeatingPlan({ seats, unallocated: rest(seats.map(x => x.studentId)) }, all, halls, cfg, AY).errors

  it("accepts a correct plan", () => {
    expect(errorsOf([seat(a[0].id, 1, 1, "L"), seat(b[0].id, 1, 1, "R"), seat(g[0].id, 2, 1, "L")])).toEqual([])
  })
  it("rejects two students of the same year on a bench", () => {
    expect(errorsOf([seat(a[0].id, 1, 1, "L"), seat(a[1].id, 1, 1, "R")]).join()).toMatch(/both Final Year students/)
  })
  it("rejects boys and girls in one hall", () => {
    expect(errorsOf([seat(a[0].id, 1, 1, "L"), seat(g[0].id, 1, 2, "L")]).join()).toMatch(/both boys and girls/)
  })
  it("rejects a student allocated twice, and a student left out of both lists", () => {
    expect(validateSeatingPlan({ seats: [seat(a[0].id, 1, 1, "L")], unallocated: rest([]) }, all, halls, cfg, AY).errors.join()).toMatch(/more than once/)
    expect(validateSeatingPlan({ seats: [], unallocated: rest([a[0].id]) }, all, halls, cfg, AY).errors.join()).toMatch(/neither seated nor listed/)
  })
  it("rejects more than two on a bench, more students than seats, and benches that do not exist", () => {
    const e = errorsOf([seat(b[0].id, 1, 1, "L"), seat(a[0].id, 1, 1, "R"), seat(b[1].id, 1, 1, "R"), seat(a[1].id, 1, 3, "L"), seat(b[2].id, 1, 2, "L")]).join()
    expect(e).toMatch(/3 students \(at most 2\)/)
    expect(e).toMatch(/5 students but only 4 seats/)
    expect(e).toMatch(/bench 3 does not exist/)
  })
  it("rejects categories not selected for the hall and more categories than its limit", () => {
    const c = students("M", SECOND, 1, "ECE")
    const e = validateSeatingPlan({ seats: [seat(a[0].id, 1, 1, "L"), seat(b[0].id, 1, 1, "R"), seat(c[0].id, 1, 2, "L")], unallocated: rest([a[0].id, b[0].id]) },
      [...all, ...c], halls, cfg, AY).errors.join()
    expect(e).toMatch(/category not selected for it \(ECE 2024-2028\)/)
    expect(e).toMatch(/3 categories, more than its limit of 2/)
  })
  it("rejects more than the requested quantity", () => {
    const capped = config([cfgHall(1, "M", [["CSE", FINAL, 1], ["IT", THIRD]]), cfgHall(2, "F", [["IT", THIRD]])])
    const seats = [seat(a[0].id, 1, 1, "L"), seat(a[1].id, 1, 2, "L")]
    expect(validateSeatingPlan({ seats, unallocated: rest(seats.map(x => x.studentId)) }, all, halls, capped, AY).errors.join()).toMatch(/2 students of a category requested at 1/)
  })

  it("is deterministic: the same input in any order gives the same plan", () => {
    const many = [...students("M", FINAL, 13), ...students("M", THIRD, 9, "IT"), ...students("M", SECOND, 11, "ECE")]
    const hs = [hall(1, 4, 3), hall(2, 3, 3)]
    const c = config([cfgHall(1, "M", [["CSE", FINAL], ["IT", THIRD], ["ECE", SECOND]]), cfgHall(2, "M", [["CSE", FINAL], ["ECE", SECOND]])])
    expect(planSeating(many, hs, c, AY)).toEqual(planSeating([...many].reverse(), hs, c, AY))
  })

  it("random rosters and configurations always give a valid plan that accounts for everyone", () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const batches = [FINAL, THIRD, SECOND, "2025-2029", "2023-2026", "2019-2023"]
    for (let run = 0; run < 250; run++) {
      const roster: SeatStudent[] = []
      const groups = 1 + rnd(6)
      for (let i = 0; i < groups; i++) roster.push(...students(rnd(2) ? "M" : "F", batches[rnd(batches.length)], rnd(25), Object.keys(DEPTS)[rnd(5)]))
      const hs = Array.from({ length: 1 + rnd(5) }, (_, i) => hall(i + 1, rnd(6), 1 + rnd(4), { default_max_categories: rnd(3) ? null : 1 + rnd(3) }))
      for (const h of hs) if (h.rows === 0) h.cols = 0
      const keys = studentCategories(roster, AY).categories.map(c => c.key)
      const c: SeatingConfig = {
        categoryOrder: [...keys].reverse(),
        halls: hs.map(h => ({
          hallId: h.id, gender: ([null, "M", "F"] as const)[rnd(3)], genderFixed: rnd(2) === 0, maxCategories: rnd(2) ? null : 1 + rnd(3),
          categories: keys.filter(() => rnd(3) > 0).map(k => ({ key: k, quantity: rnd(3) ? null : rnd(12) }))
        }))
      }
      const plan = planSeating(roster, hs, c, AY)
      expect(validateSeatingPlan(plan, roster, hs, c, AY).errors).toEqual([])
      expect(plan.seats.length + plan.unallocated.length).toBe(roster.length)
      const auto = autoConfigure(roster, hs, AY)
      expect(validateSeatingPlan(planSeating(roster, hs, auto, AY), roster, hs, auto, AY).errors).toEqual([])
    }
  })
})

describe("Automatic configuration and copying", () => {
  it("gives halls to boys and girls in hall order, seats everyone, and leaves unneeded halls unused", () => {
    const all = [...students("M", FINAL, 10), ...students("M", THIRD, 10), ...students("F", FINAL, 4), ...students("F", THIRD, 4)]
    const halls = [hall(1, 5, 2), hall(2, 3, 2), hall(3, 2, 2)] // 10, 6, 4 benches
    const cfg = autoConfigure(all, halls, AY)
    expect(cfg.halls.map(h => h.gender)).toEqual(["M", "F", null])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
  })

  it("a large college: 600 students in 12 halls are all seated", () => {
    const all = [
      ...students("M", FINAL, 120, "CSE"), ...students("M", THIRD, 140, "IT"), ...students("M", SECOND, 110, "ECE"),
      ...students("F", FINAL, 70, "CSE"), ...students("F", THIRD, 90, "IT"), ...students("F", SECOND, 70, "ECE")
    ]
    const halls = Array.from({ length: 12 }, (_, i) => hall(i + 1, 6, 5)) // 30 benches each
    const cfg = autoConfigure(all, halls, AY)
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
  })

  it("copies another session's hall settings for the halls both share", () => {
    const current = normalizeConfig(config([cfgHall(1, "M", [["CSE", FINAL]]), cfgHall(2, "F", [["CSE", FINAL]])]), [hall(1, 1, 1), hall(2, 1, 1)])
    const copied = config([cfgHall(9, "M", []), cfgHall(2, "M", [["CSE", FINAL, 4], ["IT", THIRD, 2]], 3)], [key("IT", THIRD), key("CSE", FINAL)])
    const merged = mergeConfig(current, copied, [key("CSE", FINAL)])
    expect(merged.halls.map(h => [h.hallId, h.gender, h.maxCategories, h.categories.length])).toEqual([[2, "M", 3, 1], [1, "M", null, 1]])
    expect(merged.categoryOrder).toEqual([key("CSE", FINAL)])
  })
})

describe("Seating plan: using spare seats across boys' and girls' halls", () => {
  // Hall 1: 12 benches (24 seats) set to boys; hall 2: 8 benches (16 seats) set to girls.
  // 10 boys would leave 14 seats empty in hall 1 while 4 of the 20 girls had no seat in hall 2.
  const boys = [...students("M", FINAL, 5), ...students("M", THIRD, 5)]
  const girls = [...students("F", FINAL, 10), ...students("F", THIRD, 10)]
  const all = [...boys, ...girls]
  const halls = [hall(1, 12, 1), hall(2, 8, 1)]
  const cats: [string, string][] = [["CSE", FINAL], ["CSE", THIRD]]

  it("fixed genders are kept: the shortage is reported, not fixed by mixing or moving halls", () => {
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "F", cats)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.hallGender).toEqual({ 1: "M", 2: "F" })
    expect(plan.reassigned).toEqual([])
    expect(plan.unallocated).toHaveLength(4)
    expect(plan.unallocated.every(u => u.gender === "F" && /Insufficient hall capacity/.test(u.reason))).toBe(true)
    expect(plan.groups).toEqual({ M: { students: 10, seated: 10, unallocated: 0, halls: 1, seats: 24 }, F: { students: 20, seated: 16, unallocated: 4, halls: 1, seats: 16 } })
  })

  it("halls whose gender is not fixed are swapped so everyone is seated, and the change is reported", () => {
    const cfg = config([cfgHall(1, "M", cats, null, false), cfgHall(2, "F", cats, null, false)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.hallGender).toEqual({ 1: "F", 2: "M" })
    expect(plan.unallocated).toEqual([])
    expect(plan.reassigned.map(r => [r.hall_code, r.from, r.to])).toEqual([["H1", "M", "F"], ["H2", "F", "M"]])
    expect(plan.warnings.join(" ")).toMatch(/Hall H1 was a boys' hall and is now a girls' hall/)
    expect(plan.halls.map(h => [h.configuredGender, h.gender])).toEqual([["M", "F"], ["F", "M"]])
  })

  it("one fixed hall blocks the swap: the other is not moved when that would not help", () => {
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "F", cats, null, false)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.hallGender).toEqual({ 1: "M", 2: "F" })
    expect(plan.unallocated).toHaveLength(4)
  })

  it("an unused hall whose gender is not fixed is brought into use for the group short of seats", () => {
    const three = [...halls, hall(3, 2, 1)]
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "F", cats), cfgHall(3, null, cats, null, false)])
    const plan = planSeating(all, three, cfg, AY)
    checkPlan(all, three, cfg, plan)
    expect(plan.hallGender[3]).toBe("F")
    expect(plan.unallocated).toEqual([])
    expect(plan.reassigned).toEqual([{ hallId: 3, hall_code: "H3", from: null, to: "F" }])
  })

  it("an unused hall that is fixed as Not used stays unused", () => {
    const three = [...halls, hall(3, 2, 1)]
    const cfg = config([cfgHall(1, "M", cats), cfgHall(2, "F", cats), cfgHall(3, null, cats)])
    expect(planSeating(all, three, cfg, AY).hallGender[3]).toBeNull()
  })

  it("when everyone already fits, non-fixed halls keep the configured gender", () => {
    const few = [...boys, ...girls.slice(0, 8), ...girls.slice(10, 18)] // 8 Final + 8 Third Year girls fill hall 2 exactly
    const cfg = config([cfgHall(1, "M", cats, null, false), cfgHall(2, "F", cats, null, false)])
    const plan = planSeating(few, halls, cfg, AY)
    expect(plan.reassigned).toEqual([])
    expect(plan.unallocated).toEqual([])
  })

  it("the validator refuses a plan that changes a fixed hall's gender", () => {
    const fixed = config([cfgHall(1, "M", cats), cfgHall(2, "F", cats)])
    const swapped = planSeating(all, halls, config([cfgHall(1, "M", cats, null, false), cfgHall(2, "F", cats, null, false)]), AY)
    expect(validateSeatingPlan(swapped, all, halls, fixed, AY).errors.join(" ")).toMatch(/H1: its gender is fixed \(boys\) but the plan changes it/)
  })

  it("auto-configure leaves genders free and its plan seats everyone the halls can hold", () => {
    const cfg = autoConfigure(all, halls, AY)
    expect(cfg.halls.every(h => h.genderFixed === false)).toBe(true)
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    expect(plan.reassigned).toEqual([]) // the settings already hold the split in use
  })
})

describe("Seating patterns", () => {
  const slot = (dept: string, year: string, gender: Gender): PatternSlot => ({ departmentId: DEPTS[dept], deptCode: dept, year, gender })
  /** Row 1: CSE Third Year | IT Second Year boys; row 2: the same departments' girls. One column, repeated to fit. */
  const mix: SeatingPattern = {
    id: 1, name: "CSE + IT, boys then girls", rows: 2, cols: 1,
    cells: {
      [benchKey(1, 1)]: { L: slot("CSE", "Third Year", "M"), R: slot("IT", "Second Year", "M") },
      [benchKey(2, 1)]: { L: slot("CSE", "Third Year", "F"), R: slot("IT", "Second Year", "F") }
    }
  }
  const patternHall = (hallId: number, pattern: SeatingPattern) => ({ ...cfgHall(hallId, null, []), pattern })

  it("seats every student in the seat the pattern gives their department, year and gender, boys and girls in one hall", () => {
    const all = [...students("M", THIRD, 2, "CSE"), ...students("M", SECOND, 2, "IT"), ...students("F", THIRD, 2, "CSE"), ...students("F", SECOND, 2, "IT")]
    const halls = [hall(1, 2, 2)]
    const cfg = config([patternHall(1, mix)])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    expect(plan.seats).toHaveLength(8)
    const byId = new Map(all.map(s => [s.id, s]))
    for (const seat of plan.seats) {
      const s = byId.get(seat.studentId)!
      const want = patternSlotAt(mix, seat.row, seat.col, seat.seat)!
      expect([s.department_id, yearOf(s), s.gender]).toEqual([want.departmentId, want.year, want.gender])
    }
    expect(plan.halls[0]).toMatchObject({ pattern: mix.name, gender: null, occupied: 8 })
    expect(plan.groups.M).toMatchObject({ seated: 4, unallocated: 0 })
  })

  it("repeats to fit a bigger hall and leaves a seat empty when its students run out; the rest go to the rule halls", () => {
    expect(patternSlotAt(mix, 3, 2, "L")).toEqual(mix.cells[benchKey(1, 1)].L)
    const all = students("M", THIRD, 5, "CSE")
    const halls = [hall(1, 1, 1), hall(2, 3, 1)]
    const cfg = config([patternHall(1, mix), cfgHall(2, "M", [["CSE", THIRD]])])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(seatedIn(plan, 1)).toEqual([all[0].id])
    expect(seatedIn(plan, 2)).toHaveLength(3) // one Third Year student per bench in a rule hall
    expect(plan.unallocated).toHaveLength(1)
    expect(plan.warnings.some(w => /1 pattern seat for IT – Second Year boys left empty/.test(w))).toBe(true)
  })

  it("never gives both seats of a bench the same academic year", () => {
    const bad: SeatingPattern = { name: "Same year", rows: 1, cols: 1, cells: { [benchKey(1, 1)]: { L: slot("CSE", "Third Year", "M"), R: slot("IT", "Third Year", "F") } } }
    expect(validatePattern(bad)).toMatch(/different academic years/)
    const all = students("M", THIRD, 1, "CSE")
    const halls = [hall(1, 1, 1)]
    expect(checkConfig(normalizeConfig(config([patternHall(1, bad)]), halls), halls, studentCategories(all, AY).categories).errors[0]).toMatch(/different academic years/)
    expect(validatePattern({ ...mix, name: " " })).toMatch(/name/)
    expect(validatePattern({ ...mix, cells: {} })).toMatch(/no seats/)
  })

  it("the validator refuses a student in a seat the pattern gives to someone else", () => {
    const all = [...students("M", THIRD, 1, "CSE"), ...students("M", SECOND, 1, "IT")]
    const halls = [hall(1, 1, 1)]
    const cfg = config([patternHall(1, mix)])
    const plan = planSeating(all, halls, cfg, AY)
    const swapped = { ...plan, seats: plan.seats.map(s => ({ ...s, seat: (s.seat === "L" ? "R" : "L") as "L" | "R" })) }
    expect(validateSeatingPlan(swapped, all, halls, cfg, AY).errors.join(" ")).toMatch(/pattern gives to/)
  })
})
