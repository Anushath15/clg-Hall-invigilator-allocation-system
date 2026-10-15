import { describe, it, expect } from "vitest"
import {
  planSeating, validateSeatingPlan, checkConfig, autoConfigure, normalizeConfig, studentCategory, unallocatedMessage, seatingShortfall, patternSeats, patternGroup, configureWithPattern, normalizeClassLimit, DEFAULT_CLASS_LIMIT,
  type SeatStudent, type SeatHall, type Gender, type SeatingConfig, type SeatingPlan, type BenchType
} from "./seating"
import { yearOfStudy, academicStartYear } from "./categories"
import { enabledBenches, benchKey, validateHallLayout, cleanDisabled, seatCount, type SeatKind } from "./hall-layout"
import { validateStudent, validateStudentBatch, parseGender } from "./validation"

/** Academic year of every plan below: batch 2022-2026 is Final Year, 2023-2027 Third, 2024-2028 Second. */
const AY = "2025-2026"
const FINAL = "2022-2026", THIRD = "2023-2027", SECOND = "2024-2028"
const DEPTS: Record<string, number> = { CSE: 1, IT: 2, ECE: 3 }

let nextId = 1
function students(gender: Gender, batch: string, count: number, dept = "CSE"): SeatStudent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId++, roll_no: `${batch.slice(2, 4)}${dept}${gender}${String(i + 1).padStart(3, "0")}`, gender, batch, department_id: DEPTS[dept], dept_code: dept
  }))
}
/** Students who are each in a class of their own (own department id), so the same-class rule never limits them. */
function solo(gender: Gender, batch: string, count: number, dept = "CSE"): SeatStudent[] {
  return students(gender, batch, count, dept).map(st => ({ ...st, department_id: 1000 + st.id }))
}
const hall = (id: number, rows: number, cols: number, extra: Partial<SeatHall> = {}): SeatHall => ({ id, hall_code: `H${id}`, rows, cols, disabled: [], ...extra })
/** Hall settings: boys' hall, girls' hall, not used (null), or a bench pattern. */
const config = (halls: [number, Gender | null | BenchType[]][]): SeatingConfig =>
  ({ halls: halls.map(([hallId, g]) => ({ hallId, pattern: Array.isArray(g) ? g : g === "M" ? ["MM"] : g === "F" ? ["FF"] : [] })) })

/** Checks a plan with the independent validator and returns its benches as student lists. */
function checkPlan(all: SeatStudent[], halls: SeatHall[], cfg: SeatingConfig, plan: SeatingPlan) {
  expect(validateSeatingPlan(plan, all, halls, cfg).errors).toEqual([])
  const byId = new Map(all.map(s => [s.id, s]))
  const benches = new Map<string, SeatStudent[]>()
  for (const s of plan.seats) benches.set(`${s.hallId}/${s.benchNo}`, [...(benches.get(`${s.hallId}/${s.benchNo}`) ?? []), byId.get(s.studentId)!])
  return [...benches.values()]
}
const seatedIn = (plan: SeatingPlan, hallId: number) => plan.seats.filter(s => s.hallId === hallId).map(s => s.studentId)

describe("Hall bench layout", () => {
  it("numbers benches column by column, front to back, skipping switched-off ones", () => {
    const b = enabledBenches({ rows: 3, cols: 2, disabled: [benchKey(2, 1)] })
    expect(b.map(({ row, col, benchNo }) => ({ row, col, benchNo }))).toEqual([
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
    const ok = { roll_no: "23CS001", register_no: "961223104001", name: "Anu S", gender: "F", section: "A", batch: "2023-2027" }
    expect(validateStudent(ok)).toBeNull()
    expect(validateStudent({ ...ok, roll_no: "" })).toBe("Roll Number is required.")
    expect(validateStudent({ ...ok, register_no: "96 12" })).toMatch(/Register Number can contain only/)
    expect(validateStudent({ ...ok, name: "" })).toBe("Name is required.")
    expect(validateStudent({ ...ok, gender: "X" })).toMatch(/Gender/)
    expect(validateStudent({ ...ok, section: " " })).toBe("Section is required.")
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
})

describe("Seating plan: two per bench", () => {
  it("fills column by column: the left-seat column front to back, then the right-seat column", () => {
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 3)]
    const halls = [hall(1, 2, 2)] // column 1: benches 1, 2; column 2: benches 3, 4
    const cfg = config([[1, "M"]])
    const plan = planSeating(all, halls, cfg, AY)
    expect(checkPlan(all, halls, cfg, plan).map(b => b.length)).toEqual([2, 2, 1, 1])
    expect(plan.seats.map(s => `${s.benchNo}${s.seat}`)).toEqual(["1L", "2L", "1R", "2R", "3L", "4L"])
    expect(plan.unallocated).toEqual([])
  })

  it("students of the same year and department share a bench (no other pairing rule)", () => {
    const all = solo("F", FINAL, 2)
    const plan = planSeating(all, [hall(1, 1, 1)], config([[1, "F"]]), AY)
    expect(plan.seats.map(s => s.studentId)).toEqual(all.map(s => s.id))
  })

  it("an odd count leaves only the last right seat of the column empty", () => {
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 2)]
    const plan = planSeating(all, [hall(1, 3, 1)], config([[1, "M"]]), AY)
    expect(plan.seats.map(s => `${s.benchNo}${s.seat}`)).toEqual(["1L", "2L", "3L", "1R", "2R"])
    expect(plan.halls[0]).toMatchObject({ capacity: 6, occupied: 5, empty: 1 })
  })

  it("seats in order of batch (oldest first), department, then roll number", () => {
    const it3 = solo("M", THIRD, 1, "IT"), cse3 = solo("M", THIRD, 1, "CSE"), fin = solo("M", FINAL, 2, "ECE")
    const plan = planSeating([...it3, ...cse3, ...fin], [hall(1, 2, 1)], config([[1, "M"]]), AY)
    expect(plan.seats.map(s => s.studentId)).toEqual([fin[0].id, fin[1].id, cse3[0].id, it3[0].id])
  })

  it("fills halls in hall order, continuing into the next hall", () => {
    const A = students("M", FINAL, 3), B = students("M", THIRD, 3)
    const plan = planSeating([...A, ...B], [hall(1, 1, 2), hall(2, 2, 2)], config([[1, "M"], [2, "M"]]), AY)
    // Hall 1 (two benches, one per column): A | B, A | B; hall 2 goes on with the rest of A and B.
    expect(seatedIn(plan, 1)).toEqual([A[0].id, B[0].id, A[1].id, B[1].id])
    expect(seatedIn(plan, 2).sort()).toEqual([A[2].id, B[2].id].sort())
  })

  it("switched-off benches are never used", () => {
    const all = solo("M", FINAL, 4)
    const halls = [hall(1, 2, 2, { disabled: [benchKey(1, 1)] })]
    const plan = planSeating(all, halls, config([[1, "M"]]), AY)
    checkPlan(all, halls, config([[1, "M"]]), plan)
    expect(plan.seats.some(s => s.row === 1 && s.col === 1)).toBe(false)
  })
})

describe("Seating plan: boys and girls in separate halls", () => {
  it("boys go only to boys' halls and girls only to girls' halls", () => {
    const boys = solo("M", FINAL, 3), girls = solo("F", SECOND, 3)
    const halls = [hall(1, 2, 1), hall(2, 2, 1), hall(3, 2, 1)]
    const cfg = config([[1, "F"], [2, "M"], [3, null]])
    const plan = planSeating([...boys, ...girls], halls, cfg, AY)
    checkPlan([...boys, ...girls], halls, cfg, plan)
    expect(seatedIn(plan, 1)).toEqual(girls.map(s => s.id))
    expect(seatedIn(plan, 2)).toEqual(boys.map(s => s.id))
    expect(seatedIn(plan, 3)).toEqual([])
    expect(plan.hallGender).toEqual({ 1: "F", 2: "M", 3: null })
  })

  it("a hall is never shared: a boys' hall with free seats stays part-empty while girls are unallocated", () => {
    const boys = solo("M", FINAL, 1), girls = solo("F", FINAL, 4)
    const plan = planSeating([...boys, ...girls], [hall(1, 2, 1), hall(2, 1, 1)], config([[1, "M"], [2, "F"]]), AY)
    expect(seatedIn(plan, 1)).toEqual([boys[0].id])
    expect(plan.unallocated.map(u => u.studentId)).toEqual(girls.slice(2).map(s => s.id))
    expect(plan.unallocated[0].reason).toMatch(/every seat for girls is taken/)
    expect(unallocatedMessage(plan)).toBe("2 girls could not be seated: not enough seats for them in the halls.")
  })

  it("a group with no hall is unallocated with the reason", () => {
    const girls = solo("F", FINAL, 2)
    const plan = planSeating(girls, [hall(1, 1, 1)], config([[1, "M"]]), AY)
    expect(plan.unallocated.map(u => u.reason)).toEqual(["No hall has seats for girls.", "No hall has seats for girls."])
    expect(plan.unallocated[0].category).toBe("CSE – Final Year")
  })

  it("halls without a bench layout get nobody and a warning; the config check refuses them", () => {
    const all = solo("M", FINAL, 2)
    const halls = [hall(1, 0, 0), hall(2, 1, 1)]
    const cfg = config([[1, "M"], [2, "M"]])
    const plan = planSeating(all, halls, cfg, AY)
    expect(seatedIn(plan, 2)).toHaveLength(2)
    expect(plan.warnings.join(" ")).toMatch(/H1 has no bench layout/)
    expect(checkConfig(cfg, halls, all).errors.join(" ")).toMatch(/H1 has no bench layout/)
  })

  it("the config check warns when a group has more students than its halls' seats", () => {
    const all = [...solo("M", FINAL, 5), ...solo("F", FINAL, 1)]
    expect(checkConfig(config([[1, "M"]]), [hall(1, 2, 1)], all).warnings).toEqual([
      "5 boys are selected, but the halls have only 4 seats for boys: 1 will be unallocated.",
      "1 girls are selected, but no hall has seats for girls."
    ])
  })

  it("summaries count each department + year in a hall", () => {
    const all = [...students("M", FINAL, 2, "CSE"), ...students("M", THIRD, 1, "IT")]
    const plan = planSeating(all, [hall(1, 2, 1)], config([[1, "M"]]), AY)
    expect(plan.halls[0].categories.map(c => [c.label, c.count])).toEqual([["CSE – Final Year", 2], ["IT – Third Year", 1]])
    expect(plan.groups.M).toEqual({ students: 3, seated: 3, unallocated: 0, halls: 1, seats: 4 })
  })
})

describe("Seating plan: bench patterns (boys and girls bench by bench)", () => {
  it("repeats the pattern bench by bench: Boy + Boy, Girl + Girl, ...", () => {
    const boys = [...students("M", FINAL, 2), ...students("M", THIRD, 2)], girls = [...students("F", FINAL, 2), ...students("F", THIRD, 2)]
    const halls = [hall(1, 4, 1)]
    const cfg = config([[1, ["MM", "FF"]]])
    const plan = planSeating([...boys, ...girls], halls, cfg, AY)
    checkPlan([...boys, ...girls], halls, cfg, plan)
    const byId = new Map([...boys, ...girls].map(s => [s.id, s.gender]))
    // Benches 1 and 3 seat boys, 2 and 4 girls; a boy and a girl never share a bench.
    expect(plan.seats.every(s => byId.get(s.studentId) === (s.benchNo % 2 ? "M" : "F"))).toBe(true)
    expect(plan.unallocated).toEqual([])
    expect(plan.hallGender).toEqual({ 1: "mixed" })
  })
  it("a seat whose group has run out stays empty; the other group keeps its own seats", () => {
    const boys = solo("M", FINAL, 1), girls = solo("F", FINAL, 3)
    const plan = planSeating([...boys, ...girls], [hall(1, 2, 1)], config([[1, ["MM", "FF"]]]), AY)
    expect(plan.seats.map(s => `${s.benchNo}${s.seat}`)).toEqual(["1L", "2L", "2R"])
    expect(plan.unallocated.map(u => u.studentId)).toEqual([girls[2].id])
  })
  it("counts the seats a pattern gives each group, and who the hall holds", () => {
    expect(patternSeats(["MM", "FF"], 5)).toEqual({ M: 6, F: 4 }) // MM FF MM FF MM
    expect(patternSeats(["FF"], 3)).toEqual({ M: 0, F: 6 })
    expect(patternSeats([], 3)).toEqual({ M: 0, F: 0 })
    expect([patternGroup(["MM"]), patternGroup(["FF"]), patternGroup(["MM", "FF"]), patternGroup([])]).toEqual(["M", "F", "mixed", null])
  })
  it("rejects a student in a seat the pattern gives to the other group", () => {
    const b = solo("M", FINAL, 1)[0], g = solo("F", FINAL, 1)[0]
    const halls = [hall(1, 1, 1)]
    const bad = { seats: [{ studentId: g.id, hallId: 1, row: 1, col: 1, benchNo: 1, seat: "L" as const }, { studentId: b.id, hallId: 1, row: 1, col: 1, benchNo: 1, seat: "R" as const }], unallocated: [] }
    expect(validateSeatingPlan(bad, [b, g], halls, config([[1, ["MM"]]])).errors).toHaveLength(1)
    expect(validateSeatingPlan(bad, [b, g], halls, config([[1, ["FF"]]])).errors).toHaveLength(1)
  })
  it("drops boy + girl benches saved by an older version: boys and girls never share a bench", () => {
    const halls = [hall(1, 1, 1), hall(2, 1, 1)]
    expect(normalizeConfig({ halls: [{ hallId: 1, pattern: ["MM", "MF", "FF", "FM"] }, { hallId: 2, pattern: ["MF"] }] } as any, halls).halls)
      .toEqual([{ hallId: 1, pattern: ["MM", "FF"] }, { hallId: 2, pattern: [] }])
  })
  it("reads settings saved as boys/girls halls by the previous version", () => {
    expect(normalizeConfig({ halls: [{ hallId: 1, gender: "M" }, { hallId: 2, gender: "F" }, { hallId: 3, gender: null }] } as any, [hall(1, 1, 1), hall(2, 1, 1), hall(3, 1, 1)]))
      .toEqual({ ...config([[1, "M"], [2, "F"], [3, null]]), classLimit: DEFAULT_CLASS_LIMIT })
  })
})

describe("Seating plan: validation and reproducibility", () => {
  const boys = solo("M", FINAL, 2), girls = solo("F", FINAL, 2)
  const all = [...boys, ...girls]
  const halls = [hall(1, 1, 1), hall(2, 1, 1)]
  const cfg = config([[1, "M"], [2, "F"]])
  const good = planSeating(all, halls, cfg, AY)
  const seat = (s: SeatStudent, hallId: number, benchNo: number, side: "L" | "R") => ({ studentId: s.id, hallId, row: 1, col: 1, benchNo, seat: side })

  it("accepts a correct plan", () => { expect(validateSeatingPlan(good, all, halls, cfg).errors).toEqual([]) })
  it("rejects boys and girls in one hall", () => {
    const bad = { seats: [seat(boys[0], 1, 1, "L"), seat(girls[0], 1, 1, "R"), seat(boys[1], 2, 1, "L"), seat(girls[1], 2, 1, "R")], unallocated: [] }
    expect(validateSeatingPlan(bad, all, halls, cfg).errors.join(" ")).toMatch(/H1, bench 1: \S+ sits in the right seat, which the bench pattern gives to a boy/)
  })
  it("rejects a student allocated twice, and a student left out of both lists", () => {
    const bad = { seats: [seat(boys[0], 1, 1, "L"), seat(boys[0], 1, 1, "R")], unallocated: [] }
    const e = validateSeatingPlan(bad, all, halls, cfg).errors.join(" ")
    expect(e).toMatch(/more than once/)
    expect(e).toMatch(/neither seated/)
  })
  it("rejects two students in one seat and benches that do not exist", () => {
    const bad = { seats: [seat(boys[0], 1, 1, "L"), seat(boys[1], 1, 1, "L"), seat(girls[0], 2, 7, "L"), seat(girls[1], 2, 1, "L")], unallocated: [] }
    const e = validateSeatingPlan(bad, all, halls, cfg).errors.join(" ")
    expect(e).toMatch(/same seat/)
    expect(e).toMatch(/bench 7 does not exist/)
  })
  it("rejects students in a hall that is not used", () => {
    expect(validateSeatingPlan(good, all, halls, config([[1, "M"], [2, null]])).errors.join(" ")).toMatch(/H2 is not used/)
  })
  it("is deterministic: the same input in any order gives the same plan", () => {
    expect(planSeating([...all].reverse(), halls, cfg, AY).seats).toEqual(good.seats)
  })
  it("random rosters and hall settings always give a valid plan that accounts for everyone", () => {
    for (let t = 0; t < 50; t++) {
      const roster = [...solo("M", FINAL, t % 7), ...solo("F", THIRD, (t * 3) % 11), ...solo("M", SECOND, t % 5, "IT")]
      const hs = [hall(1, 1 + (t % 3), 2), hall(2, 2, 1 + (t % 2)), hall(3, 3, 1)]
      const c = config(hs.map((h, i) => [h.id, ([null, "M", "F"] as (Gender | null)[])[(t + i) % 3]]))
      const plan = planSeating(roster, hs, c, AY)
      expect(validateSeatingPlan(plan, roster, hs, c).errors).toEqual([])
      expect(plan.seats.length + plan.unallocated.length).toBe(roster.length)
    }
  })
  it("reads settings saved by older versions: one entry per session hall, other fields dropped", () => {
    const old = { categoryOrder: ["x"], halls: [{ hallId: 2, gender: "F", genderFixed: false, maxCategories: 3, categories: [] }, { hallId: 9, gender: "M" }] } as any
    expect(normalizeConfig(old, halls)).toEqual({ ...config([[1, null], [2, "F"]]), classLimit: DEFAULT_CLASS_LIMIT })
  })
})

describe("Automatic configuration", () => {
  it("gives halls to boys and girls in hall order, seats everyone, and leaves unneeded halls unused", () => {
    const all = [...solo("M", FINAL, 5), ...solo("F", FINAL, 3)]
    const halls = [hall(1, 2, 1), hall(2, 2, 1), hall(3, 2, 1), hall(4, 2, 1)]
    const cfg = autoConfigure(all, halls)
    expect(cfg).toEqual(config([[1, "M"], [2, "M"], [3, "F"], [4, null]]))
    expect(planSeating(all, halls, cfg, AY).unallocated).toEqual([])
  })
  it("tries girls first when that seats more students", () => {
    const all = [...solo("M", FINAL, 3), ...solo("F", FINAL, 2)]
    // Boys first would take both halls (2 + 4 seats) and leave the girls without a hall.
    expect(autoConfigure(all, [hall(1, 1, 1), hall(2, 2, 1)])).toEqual(config([[1, "F"], [2, "M"]]))
  })
  it("a large college: 600 students in 12 halls are all seated", () => {
    const all = [...students("M", FINAL, 180), ...students("F", FINAL, 120), ...students("M", THIRD, 150, "IT"), ...students("F", SECOND, 150, "ECE")]
    const halls = Array.from({ length: 12 }, (_, i) => hall(i + 1, 6, 5))
    const cfg = autoConfigure(all, halls)
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
  })
  it("finds a split that hall order misses: any combination of halls, not just the first ones", () => {
    // Halls of 10, 6 and 4 seats for 6 boys and 14 girls. Taking halls in order leaves students out
    // (boys {10} + girls {6, 4} = 10 seats for 14 girls); only boys {6} + girls {10, 4} seats everyone.
    const all = [...students("M", FINAL, 3), ...students("M", THIRD, 3), ...students("F", FINAL, 7), ...students("F", THIRD, 7)]
    const halls = [hall(1, 5, 1), hall(2, 3, 1), hall(3, 2, 1)]
    const cfg = autoConfigure(all, halls)
    expect(cfg).toEqual(config([[1, "F"], [2, "M"], [3, "F"]]))
    expect(planSeating(all, halls, cfg, AY).unallocated).toEqual([])
    expect(seatingShortfall(all, halls)).toBeNull()
  })
  it("seats everyone whenever any assignment of halls can: checked against every assignment (brute force)", () => {
    let seed = 7
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let t = 0; t < 300; t++) {
      const hs = Array.from({ length: 1 + rand(6) }, (_, i) => hall(i + 1, 1 + rand(4), 1 + rand(2)))
      const roster = [...solo("M", FINAL, rand(25)), ...solo("F", THIRD, rand(25))]
      // Best possible: try all 3^n ways of making each hall boys, girls or not used.
      let bestSeparate = 0
      for (let code = 0; code < 3 ** hs.length; code++) {
        let c = code
        const cfg = config(hs.map(h => { const g = ([null, "M", "F"] as (Gender | null)[])[c % 3]; c = Math.floor(c / 3); return [h.id, g] }))
        bestSeparate = Math.max(bestSeparate, planSeating(roster, hs, cfg, AY).seats.length)
      }
      const cfg = autoConfigure(roster, hs)
      const plan = planSeating(roster, hs, cfg, AY)
      expect(validateSeatingPlan(plan, roster, hs, cfg).errors).toEqual([])
      // Boys and girls never share a bench: the most any split of the benches between them can seat.
      const benches = hs.reduce((n, h) => n + enabledBenches(h).length, 0)
      const boys = roster.filter(s => s.gender === "M").length, girls = roster.length - boys
      const most = Math.max(...Array.from({ length: benches + 1 }, (_, b) => Math.min(boys, 2 * b) + Math.min(girls, 2 * (benches - b))))
      expect(plan.seats.length).toBe(most)
      // A hall shared by boys and girls only when whole halls cannot seat as many.
      const mixed = cfg.halls.filter(h => patternGroup(h.pattern) === "mixed").length
      expect(mixed).toBe(bestSeparate === plan.seats.length ? 0 : 1)
      expect(seatingShortfall(roster, hs) === null).toBe(plan.unallocated.length === 0)
    }
  })
  it("explains a shortfall: too few seats in total", () => {
    expect(seatingShortfall(solo("M", FINAL, 10), [hall(1, 2, 2)])).toMatch(/10 students are selected \(10 boys, 0 girls\), but this session's halls have only 8 seats. Add halls with at least 2 more seats/)
    expect(seatingShortfall([...students("M", FINAL, 4), ...students("M", THIRD, 4)], [hall(1, 2, 2)])).toBeNull()
  })
  it("when no whole-hall split fits, one hall is shared bench by bench so that everyone is seated", () => {
    // 3 boys and 3 girls (four classes); halls of 6 and 2 seats: whole halls leave one out.
    const all = [...students("M", FINAL, 2), ...students("M", THIRD, 1), ...students("F", SECOND, 2, "IT"), ...students("F", FINAL, 1, "IT")]
    const halls = [hall(1, 3, 1), hall(2, 1, 1)]
    const cfg = autoConfigure(all, halls)
    // Everyone would fit in the first hall with 4 classes; to keep to 3, the second hall is used too.
    expect(cfg).toEqual(config([[1, ["MM", "MM", "FF"]], [2, "F"]]))
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    expect(plan.hallGender).toEqual({ 1: "mixed", 2: "F" })
    expect(seatingShortfall(all, halls)).toBeNull()
  })
  it("separate halls only: never shares a hall, even if that leaves someone out", () => {
    const all = [...solo("M", FINAL, 3), ...solo("F", FINAL, 3)]
    const halls = [hall(1, 3, 1), hall(2, 1, 1)]
    const cfg = autoConfigure(all, halls, { separateOnly: true })
    expect(cfg.halls.every(h => patternGroup(h.pattern) !== "mixed")).toBe(true)
    expect(planSeating(all, halls, cfg, AY).unallocated).toHaveLength(1)
  })
  it("one pattern for the session: halls take it in order until both groups have enough seats", () => {
    const halls = [hall(1, 3, 1), hall(2, 3, 1), hall(3, 3, 1)] // 3 benches each: MM FF MM = 4 boy and 2 girl seats
    expect(configureWithPattern({ M: 5, F: 2 }, halls, ["MM", "FF"])).toEqual(config([[1, ["MM", "FF"]], [2, ["MM", "FF"]], [3, null]]))
    expect(configureWithPattern({ M: 4, F: 2 }, halls, ["MM", "FF"])).toEqual(config([[1, ["MM", "FF"]], [2, null], [3, null]]))
    // Not enough seats even in every hall: every hall is used.
    expect(configureWithPattern({ M: 20, F: 0 }, halls, ["MM"]).halls.every(h => h.pattern.length === 1)).toBe(true)
  })
  it("labels a student's department and year", () => {
    expect(studentCategory(students("M", THIRD, 1, "IT")[0], AY).label).toBe("IT – Third Year")
  })
})

describe("Seating plan: two students of the same class never share a bench", () => {
  it("a Third Year CSE student sits with a Final Year student or a CSE student of another year, never another Third Year CSE", () => {
    const cse3 = students("M", THIRD, 2, "CSE"), cse4 = students("M", FINAL, 1, "CSE"), it4 = students("M", FINAL, 1, "IT")
    const all = [...cse3, ...cse4, ...it4]
    const halls = [hall(1, 2, 1)]
    const cfg = config([[1, "M"]])
    const benches = checkPlan(all, halls, cfg, planSeating(all, halls, cfg, AY))
    expect(benches).toHaveLength(2)
    for (const b of benches) expect(new Set(b.map(x => `${x.department_id}|${x.batch}`)).size).toBe(2)
  })
  it("one large class: its students sit alone, paired with every other class first; the rest are unallocated with the reason", () => {
    const big = students("F", THIRD, 6, "CSE"), others = [...students("F", FINAL, 1, "IT"), ...students("F", SECOND, 1, "ECE")]
    const all = [...big, ...others]
    const halls = [hall(1, 3, 1)] // 3 benches
    const cfg = config([[1, "F"]])
    const plan = planSeating(all, halls, cfg, AY)
    const benches = checkPlan(all, halls, cfg, plan)
    // CSE + IT, CSE + ECE, CSE alone: 5 seated, 3 CSE left out.
    expect(benches.map(b => b.length)).toEqual([2, 2, 1])
    expect(plan.unallocated).toHaveLength(3)
    expect(plan.unallocated.every(u => u.category === "CSE – Third Year")).toBe(true)
    expect(plan.unallocated[0].reason).toMatch(/two students of the same class never share a bench/)
  })
  it("unequal classes: a leftover student swaps in so that everyone is seated", () => {
    const all = [...students("M", FINAL, 4, "CSE"), ...students("M", FINAL, 3, "IT"), ...students("M", THIRD, 3, "ECE")]
    const halls = [hall(1, 5, 1)]
    const cfg = config([[1, "M"]])
    const benches = checkPlan(all, halls, cfg, planSeating(all, halls, cfg, AY))
    expect(benches.map(b => b.length)).toEqual([2, 2, 2, 2, 2])
  })
  it("the validator rejects two students of one class on a bench", () => {
    const two = students("M", THIRD, 2, "CSE")
    const halls = [hall(1, 1, 1)]
    const bad = { seats: two.map((x, i) => ({ studentId: x.id, hallId: 1, row: 1, col: 1, benchNo: 1, seat: (i ? "R" : "L") as "L" | "R" })), unallocated: [] }
    expect(validateSeatingPlan(bad, two, halls, config([[1, "M"]])).errors.join(" ")).toMatch(/are from the same class/)
  })
  it("auto-assign brings in another hall when the class rule needs more benches", () => {
    const all = students("M", FINAL, 4, "CSE") // one class: one per bench
    const halls = [hall(1, 2, 1), hall(2, 2, 1)]
    const cfg = autoConfigure(all, halls)
    expect(cfg).toEqual(config([[1, "M"], [2, "M"]]))
    expect(planSeating(all, halls, cfg, AY).unallocated).toEqual([])
    expect(seatingShortfall(all, [hall(1, 2, 1)])).toMatch(/two students of the same class never share a bench.*2 cannot be seated/)
  })
})

describe("Seating plan: one class per seat column, classes in turn (the administrator's drawing)", () => {
  it("4 columns x 4 rows: A | B, C | A, B | C, A | B, each class continuing its roll numbers; the next hall goes on with C", () => {
    const A = students("M", FINAL, 12, "CSE"), B = students("M", THIRD, 12, "CSE"), C = students("M", SECOND, 9, "CSE")
    const all = [...C, ...A, ...B]
    const halls = [hall(1, 4, 4), hall(2, 1, 1)]
    const cfg = config([[1, "M"], [2, "M"]])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    const at = (hallId: number, col: number, side: "L" | "R") => plan.seats.filter(x => x.hallId === hallId && x.col === col && x.seat === side).sort((a, b) => a.row - b.row).map(x => x.studentId)
    const ids = (list: SeatStudent[], from: number, n: number) => list.slice(from, from + n).map(x => x.id)
    expect([at(1, 1, "L"), at(1, 1, "R")]).toEqual([ids(A, 0, 4), ids(B, 0, 4)])
    expect([at(1, 2, "L"), at(1, 2, "R")]).toEqual([ids(C, 0, 4), ids(A, 4, 4)])
    expect([at(1, 3, "L"), at(1, 3, "R")]).toEqual([ids(B, 4, 4), ids(C, 4, 4)])
    expect([at(1, 4, "L"), at(1, 4, "R")]).toEqual([ids(A, 8, 4), ids(B, 8, 4)])
    // "Next class starts with 102557 if available": the next hall begins with C's ninth student.
    expect(at(2, 1, "L")).toEqual(ids(C, 8, 1))
  })
  it("girls and boys each keep their own seat columns in a hall that mixes them", () => {
    const boys = [...students("M", FINAL, 2), ...students("M", THIRD, 2)], girls = [...students("F", FINAL, 2), ...students("F", THIRD, 2)]
    const all = [...boys, ...girls]
    const halls = [hall(1, 4, 1)]
    const cfg = config([[1, ["MM", "FF"]]])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
  })
})

describe("Seating plan: at most a few different classes (papers) per hall", () => {
  // Six classes of 6 boys each; halls of 12 benches (24 seats) in 4 columns of 3.
  const sixClasses = () => [
    ...students("M", FINAL, 6, "CSE"), ...students("M", FINAL, 6, "IT"), ...students("M", THIRD, 6, "CSE"),
    ...students("M", THIRD, 6, "IT"), ...students("M", SECOND, 6, "CSE"), ...students("M", SECOND, 6, "IT")
  ]
  const classesIn = (plan: SeatingPlan, all: SeatStudent[], hallId: number) => {
    const byId = new Map(all.map(x => [x.id, x]))
    return new Set(plan.seats.filter(x => x.hallId === hallId).map(x => `${byId.get(x.studentId)!.department_id}|${byId.get(x.studentId)!.batch}`)).size
  }
  it("a hall holds the preferred number of classes when that fills it", () => {
    const all = sixClasses()
    const halls = [hall(1, 3, 4), hall(2, 3, 4), hall(3, 3, 4)]
    for (const preferred of [2, 3, 4]) {
      const cfg = { ...config([[1, "M"], [2, "M"], [3, "M"]]), classLimit: { preferred, max: 4 } }
      const plan = planSeating(all, halls, cfg, AY)
      checkPlan(all, halls, cfg, plan)
      expect(plan.unallocated).toEqual([])
      for (const h of halls) expect(classesIn(plan, all, h.id)).toBeLessThanOrEqual(preferred)
    }
  })
  it("a hall the preferred number cannot fill takes more classes, up to the maximum", () => {
    // 2 students each of 5 classes and one hall of 10 seats: two or three classes leave seats empty while students wait.
    const all = [...students("M", FINAL, 2, "CSE"), ...students("M", FINAL, 2, "IT"), ...students("M", THIRD, 2, "CSE"), ...students("M", THIRD, 2, "IT"), ...students("M", SECOND, 2, "CSE")]
    const halls = [hall(1, 5, 1)]
    const strict = { ...config([[1, "M"]]), classLimit: { preferred: 3, max: 3 } }
    const relaxed = { ...config([[1, "M"]]), classLimit: { preferred: 3, max: 4 } }
    const a = planSeating(all, halls, strict, AY), b = planSeating(all, halls, relaxed, AY)
    checkPlan(all, halls, strict, a); checkPlan(all, halls, relaxed, b)
    expect(classesIn(a, all, 1)).toBe(3)
    expect(a.seats).toHaveLength(6)
    expect(classesIn(b, all, 1)).toBe(4)
    expect(b.seats).toHaveLength(8)
  })
  it("the validator refuses a hall with more classes than the maximum", () => {
    const all = sixClasses().filter((_, i) => i % 6 === 0) // one student of each of the six classes
    const halls = [hall(1, 3, 1)]
    const bad = { seats: all.map((x, i) => ({ studentId: x.id, hallId: 1, row: Math.floor(i / 2) + 1, col: 1, benchNo: Math.floor(i / 2) + 1, seat: (i % 2 ? "R" : "L") as "L" | "R" })), unallocated: [] }
    expect(validateSeatingPlan(bad, all, halls, { ...config([[1, "M"]]), classLimit: { preferred: 3, max: 4 } }).errors.join(" ")).toMatch(/6 different classes, more than the limit of 4/)
  })
  it("the limit is kept between 2 and 4, and the maximum never below the preferred number", () => {
    expect(normalizeClassLimit(undefined)).toEqual({ preferred: 3, max: 4 })
    expect(normalizeClassLimit({ preferred: 1, max: 9 })).toEqual({ preferred: 2, max: 4 })
    expect(normalizeClassLimit({ preferred: 4, max: 2 })).toEqual({ preferred: 4, max: 4 })
    expect(normalizeClassLimit({ preferred: 2, max: 2 })).toEqual({ preferred: 2, max: 2 })
  })
})

describe("Seating plan: roll number order, boys and girls together", () => {
  /** One class with boys and girls mixed in roll order: 102349 a boy, 102350 a girl, … */
  const mixedClass = (dept: string, start: number, count: number): SeatStudent[] => Array.from({ length: count }, (_, i) => ({
    id: nextId++, roll_no: String(start + i), gender: (i % 2 ? "F" : "M") as Gender, batch: THIRD, department_id: DEPTS[dept], dept_code: dept
  }))
  const rollCfg = (halls: [number, boolean][]): SeatingConfig => ({ halls: halls.map(([hallId, used]) => ({ hallId, pattern: used ? ["MM"] : [] })), mixGenders: true })

  it("each seat column follows roll numbers whatever the gender", () => {
    const A = mixedClass("CSE", 102349, 4), B = mixedClass("IT", 502349, 4)
    const all = [...B, ...A], halls = [hall(1, 4, 1)], cfg = rollCfg([[1, true]])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    const roll = new Map(all.map(s => [s.id, s.roll_no]))
    const column = (side: "L" | "R") => plan.seats.filter(x => x.seat === side).sort((a, b) => a.row - b.row).map(x => roll.get(x.studentId))
    const cols = [column("L"), column("R")].sort()
    expect(cols).toEqual([["102349", "102350", "102351", "102352"], ["502349", "502350", "502351", "502352"]])
    expect(plan.unallocated).toEqual([])
    expect(plan.hallGender).toEqual({ 1: "mixed" })
    expect(plan.groups.F).toMatchObject({ students: 4, seated: 4, unallocated: 0 })
  })
  it("auto-assign uses as few halls as seat everyone, and the setting is kept", () => {
    const all = [...mixedClass("CSE", 102301, 6), ...mixedClass("IT", 502301, 6)]
    const halls = [hall(1, 3, 2), hall(2, 3, 2)]
    const cfg = autoConfigure(all, halls, { mixGenders: true })
    expect(cfg).toMatchObject({ mixGenders: true, halls: [{ hallId: 1, pattern: ["MM"] }, { hallId: 2, pattern: [] }] })
    expect(normalizeConfig(cfg, halls).mixGenders).toBe(true)
    expect(planSeating(all, halls, cfg, AY).seats).toHaveLength(12)
  })
  it("too few seats: the rest are unallocated, each with their own gender", () => {
    const all = mixedClass("CSE", 102301, 3), halls = [hall(1, 1, 1)]
    const plan = planSeating(all, halls, rollCfg([[1, true]]), AY)
    expect(plan.seats).toHaveLength(1) // one class: one per bench
    expect(plan.unallocated.map(u => u.gender)).toEqual(["F", "M"])
    expect(checkConfig(rollCfg([[1, true]]), halls, [...all, ...mixedClass("IT", 502301, 1)]).warnings.join(" ")).toMatch(/4 students are selected, but the halls used have only 2 seats/)
  })
})

describe("Chairs", () => {
  /** A hall whose every position is `kind`. */
  const chairs = (id: number, rows: number, cols: number, kind: SeatKind = "chair"): SeatHall => {
    const kinds: Record<string, SeatKind> = {}
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) kinds[benchKey(r, c)] = kind
    return hall(id, rows, cols, { kinds })
  }

  it("a chair seats one student, a bench two", () => {
    expect(seatCount(chairs(1, 3, 4))).toBe(12)
    expect(seatCount(hall(2, 2, 2, { kinds: { [benchKey(1, 1)]: "chair" } }))).toBe(7)
    expect(enabledBenches(chairs(1, 1, 2)).map(b => [b.kind, b.seats])).toEqual([["chair", 1], ["chair", 1]])
  })

  it("seats one student per chair, only in the left seat, and fills every chair", () => {
    const all = [...students("M", FINAL, 6), ...students("M", THIRD, 6, "IT")]
    const halls = [chairs(1, 3, 4)]
    const cfg = config([[1, "M"]])
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.seats).toHaveLength(12)
    expect(plan.seats.every(s => s.seat === "L")).toBe(true)
    expect(plan.halls[0]).toMatchObject({ capacity: 12, occupied: 12, empty: 0 })
  })

  it("students of one class may sit on neighbouring chairs (no bench mate)", () => {
    const all = students("F", FINAL, 5)
    const halls = [chairs(1, 5, 1)]
    const plan = planSeating(all, halls, config([[1, "F"]]), AY)
    expect(plan.unallocated).toEqual([])
    expect(plan.seats).toHaveLength(5)
  })

  it("a hall mixing benches and chairs uses both", () => {
    const all = [...students("M", FINAL, 4), ...students("M", THIRD, 4, "IT")]
    const halls = [hall(1, 2, 3, { kinds: { [benchKey(1, 3)]: "chair", [benchKey(2, 3)]: "chair" } })] // 4 benches + 2 chairs = 10 seats
    const cfg = autoConfigure(all, halls)
    const plan = planSeating(all, halls, cfg, AY)
    checkPlan(all, halls, cfg, plan)
    expect(plan.unallocated).toEqual([])
    expect(plan.seats.filter(s => s.col === 3).every(s => s.seat === "L")).toBe(true)
  })

  it("the validator refuses a right seat on a chair", () => {
    const all = students("M", FINAL, 1)
    const halls = [chairs(1, 1, 1)]
    const errors = validateSeatingPlan({ seats: [{ studentId: all[0].id, hallId: 1, row: 1, col: 1, benchNo: 1, seat: "R" }], unallocated: [] }, all, halls, config([[1, "M"]])).errors
    expect(errors.join(" ")).toMatch(/single chair/)
  })

  it("patternSeats counts one seat per chair", () => {
    expect(patternSeats(["MM", "FF"], enabledBenches(hall(1, 1, 3, { kinds: { [benchKey(1, 2)]: "chair" } })))).toEqual({ M: 4, F: 1 })
  })
})
