/**
 * The college name on screens and PDFs comes from Settings → College Profile. Only the
 * defaults spell it out; everything else reads the setting (useCollegeName or
 * settings["college.name"] ?? default).
 */
import { it, expect } from "vitest"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULTS = new Set([
  "hooks/useCollegeName.ts", // DEFAULT_COLLEGE_NAME
  "lib/web-db.ts",           // the web build's initial settings
  "lib/holidays.ts",         // a comment
  "pages/LoginPage.tsx",     // the web sign-in screen
])

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

it("the college name is never hard-coded on a screen or PDF", () => {
  const hardCoded: string[] = []
  for (const file of sources(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/")
    if (DEFAULTS.has(rel)) continue
    fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (line.includes("Catholic College of Engineering") && !line.includes(`settings["college.name"] ??`)) hardCoded.push(`${rel}:${i + 1}`)
    })
  }
  expect(hardCoded).toEqual([])
})
