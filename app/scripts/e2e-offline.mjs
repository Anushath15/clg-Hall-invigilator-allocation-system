// End-to-end test of the packaged desktop app with all network access blocked.
//
//   npm run package        (builds release/win-unpacked/HIAS.exe and the installer)
//   npm run test:e2e       (or: node scripts/e2e-offline.mjs [path\to\HIAS.exe])
//
// HIAS runs against a throwaway data folder (never %APPDATA%\eias), with every host name
// failing to resolve and all traffic sent to a dead proxy. The script drives the real UI
// over the Chrome DevTools Protocol like an administrator would, captures generated PDFs
// inside the page (so no Save dialog opens), and fails if the app requests anything that is
// not local. Only Node built-ins (and the project's xlsx package for the import file) are used.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as XLSX from "xlsx"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const exe = process.argv[2] ?? path.join(appDir, "release", "win-unpacked", "HIAS.exe")
if (!fs.existsSync(exe)) { console.error(`HIAS.exe not found at ${exe}. Run "npm run package" first.`); process.exit(2) }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hias-e2e-"))
const port = 9300 + Math.floor(Math.random() * 500)
const args = [`--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`, "--host-resolver-rules=MAP * ~NOTFOUND", "--proxy-server=http://127.0.0.1:9"]
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Chrome DevTools Protocol ─────────────────────────────────────────────────
const externalRequests = []
let cdp = null
async function connect() {
  let target
  for (let i = 0; i < 150 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page" && t.url.startsWith("file:")) } catch {}
    if (!target) await sleep(200)
  }
  if (!target) throw new Error("HIAS window did not appear")
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0; const pending = new Map()
  ws.onmessage = e => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params.request.url
      if (!/^(file|data|blob|devtools|about|chrome-extension):/i.test(url)) externalRequests.push(url)
    }
  }
  const send = (method, params = {}) => new Promise(res => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })) })
  cdp = { send, close: () => ws.close() }
  await send("Network.enable"); await send("Runtime.enable")
}

// Page-side helpers, re-declared in every evaluation (the page reloads after a restore).
const HELPERS = String.raw`
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, what, ms = 10000) => { const t0 = Date.now(); for (;;) { try { const v = fn(); if (v) return v } catch {} if (Date.now() - t0 > ms) throw new Error("Timed out waiting for " + what + "\n      toast: " + toast() + "\n      screen: " + (document.querySelector(".fixed.inset-0") || document.querySelector("main") || document.body).innerText.replace(/\s+/g, " ").slice(0, 600)); await sleep(100) } };
  const visible = e => e && e.getClientRects().length > 0;
  const byText = (sel, t) => [...document.querySelectorAll(sel)].find(e => visible(e) && e.innerText.trim().includes(t));
  const click = async (t, sel = "button") => { const el = await until(() => byText(sel, t), sel + ' "' + t + '"'); el.click(); await sleep(300); return el };
  const setValue = (el, v) => { const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })) };
  const field = label => { const l = [...document.querySelectorAll("label")].find(l => visible(l) && l.innerText.trim().replace(/\s*\*$/, "") === label); return l && l.parentElement.querySelector("input, select, textarea") };
  const fill = async (label, v) => { setValue(await until(() => field(label), "field " + label), v); await sleep(80) };
  const go = async hash => { location.hash = hash; await sleep(700) };
  const body = () => document.body.innerText;
  const toast = () => [...document.querySelectorAll("[role=status]")].map(t => t.innerText).join(" | ");
  const noPasswordField = () => !document.querySelector("input[type=password]");
  const pdfs = () => window.__pdfs || [];
  const capturePdfs = () => { if (window.__pdfs) return; window.__pdfs = [];
    const grab = a => { if (a.download) { window.__pdfs.push({ name: a.download, href: a.href }); return true } };
    const click0 = HTMLAnchorElement.prototype.click, dispatch0 = HTMLAnchorElement.prototype.dispatchEvent;
    HTMLAnchorElement.prototype.click = function () { if (!grab(this)) click0.call(this) };
    HTMLAnchorElement.prototype.dispatchEvent = function (ev) { return (ev.type === "click" && grab(this)) || dispatch0.call(this, ev) } };
  const lastPdf = async (before) => { await until(() => pdfs().length > before, "PDF download"); const p = pdfs()[pdfs().length - 1]; const buf = new Uint8Array(await (await fetch(p.href)).arrayBuffer()); return { name: p.name, bytes: buf.length, header: String.fromCharCode(...buf.slice(0, 5)) } };
`
async function ev(code) {
  const r = await cdp.send("Runtime.evaluate", { expression: `(async () => { ${HELPERS}\n${code} })()`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails || r.exceptionDetails) {
    const d = r.result?.exceptionDetails ?? r.exceptionDetails
    throw new Error(d.exception?.description ?? d.text)
  }
  return r.result?.result?.value ?? r.result?.value
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const results = []
async function step(name, fn) {
  const t0 = Date.now()
  try { const detail = await fn(); results.push({ step: name, result: "PASS", detail: detail ?? "", ms: Date.now() - t0 }); console.log(`PASS  ${name}${detail ? "  — " + detail : ""}`) }
  catch (e) { results.push({ step: name, result: "FAIL", detail: e.message }); console.log(`FAIL  ${name}  — ${e.message}`); throw e }
}
function launch() { spawn(exe, args, { stdio: "ignore", detached: true }).unref() }
// Closing the only window quits HIAS (window-all-closed).
async function quitApp() { try { await Promise.race([cdp.send("Runtime.evaluate", { expression: "window.close()" }), sleep(1000)]) } catch {} cdp?.close(); await sleep(2500) }
// Safety net: stop only HIAS processes started with this test's data folder (never your own HIAS).
function killTestInstances() {
  try {
    spawnSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='HIAS.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(dataDir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" })
  } catch {}
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

const importFile = path.join(dataDir, "staff-import.xlsx")
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ["Staff ID", "Name", "Department", "Email", "Designation"],
  ["STF002", "Bala Subramanian", "CSE", "bala@example.edu", "Associate Professor"],
  ["STF003", "Chitra Muthukrishnan", "Cse", "", "Assistant Professor"],
  ["STF004", "Dinesh Kumar", "computer science and engineering", "", "Professor"],
  ["STF005", "Esther Jeyakumar", "cse", "", "Assistant Professor"],
  ["STF006", "Faizal Abdul Kareem", "CSE", "", "Assistant Professor"],
  ["STF007", "Unknown Department", "CIVIL", "", ""],
  ["STF002", "Duplicate Row", "CSE", "", ""],
]), "Staff")
XLSX.writeFile(wb, importFile)
const backupFile = path.join(dataDir, "hias-backup.db")
const notADb = path.join(dataDir, "notes.db"); fs.writeFileSync(notADb, "not a database")
const js = s => JSON.stringify(s)

let failed = false
try {
  console.log(`HIAS: ${exe}\nData folder: ${dataDir}\nNetwork: all host names unresolvable, proxy http://127.0.0.1:9 (dead)\n`)
  launch(); await connect()

  await step("Opens straight to the Dashboard, no login", () => ev(`
    await until(() => location.hash === "#/dashboard" && body().includes("Dashboard"), "dashboard");
    if (!noPasswordField()) throw new Error("password field on screen");
    if (/sign in|log ?in|log ?out/i.test(body())) throw new Error("login wording on screen");
    if (!body().includes("Offline · Local database")) throw new Error("offline indicator missing");
    const authCalls = ["login", "logout", "verifyPassword", "changePassword"].filter(m => m in window.api);
    if (authCalls.length) throw new Error("desktop bridge still exposes " + authCalls.join(", "));
    return "hash " + location.hash + "; bridge has no login/password calls"`))

  await step("Fresh install: database created with defaults and no demo data", async () => {
    assert(fs.existsSync(path.join(dataDir, "eias.db")), "eias.db not created in the data folder")
    return ev(`
      const [d, h, s, c, st] = await Promise.all([api.getDepartments(), api.getHalls(), api.getUsers({ role: "staff" }), api.getCycles(), api.getSettings()]);
      if (d.length || h.length || s.length || c.length) throw new Error("demo data present");
      if (st["app.version"] !== "1.1.0") throw new Error("app.version " + st["app.version"]);
      return "0 departments/halls/staff/batches, version " + st["app.version"]`)
  })

  await step("Login, staff and unknown URLs all land on the Dashboard", () => ev(`
    for (const h of ["#/login", "#/staff/duty", "#/no-such-page"]) {
      await go(h); await until(() => location.hash === "#/dashboard", h + " -> dashboard");
      if (!noPasswordField()) throw new Error("password field after " + h);
    }
    return "3 redirects"`))

  await step("Add a department (form); a different-case duplicate is refused", () => ev(`
    await go("#/master?tab=departments");
    await click("Add Department"); await fill("Code", "cse"); await fill("Name", "Computer Science and Engineering"); await click("Save");
    await until(() => body().includes("Computer Science and Engineering"), "department row");
    await click("Add Department"); await fill("Code", "CSE"); await fill("Name", "Duplicate"); await click("Save");
    await until(() => toast().includes("already exists"), "duplicate refused");
    await click("Cancel");
    const d = await api.getDepartments(); if (d.length !== 1 || d[0].code !== "cse") throw new Error(JSON.stringify(d));
    return "saved as 'cse'; 'CSE' refused"`))

  await step("Add a hall (form)", () => ev(`
    await go("#/master?tab=halls");
    await click("Add Hall"); await fill("Hall Code", "H001"); await fill("Block / Building", "Main Block"); await fill("Floor", "1st"); await click("Save");
    await until(() => body().includes("H001"), "hall row");
    for (let i = 2; i <= 6; i++) await api.saveHall({ hall_code: "H00" + i, block: i === 6 ? "Annexe" : "Main Block", floor: "2nd", capacity: 30, is_active: true });
    return (await api.getHalls()).length + " halls"`))

  await step("Add a staff member (form)", () => ev(`
    await go("#/master?tab=staff");
    await click("Add Staff"); await fill("Staff ID", "STF001"); await fill("Full Name", "Anitha Rajendran"); await fill("Designation", "Assistant Professor");
    await fill("Department", String((await api.getDepartments())[0].id)); await click("Save");
    await until(() => body().includes("Anitha Rajendran"), "staff row");
    return "STF001 added"`))

  await step("Import staff from an Excel file (local)", () => ev(`
    const r = await api.importUsersFromExcel(${js(importFile)});
    if (!r.success || r.inserted !== 5 || r.issues.length !== 2) throw new Error(JSON.stringify(r));
    await go("#/dashboard"); await go("#/master?tab=staff"); await until(() => body().includes("6 staff members"), "6 staff");
    return "5 imported (any-case department), 2 rows rejected: " + r.issues.map(i => "row " + i.row).join(", ")`))

  await step("Create an allocation batch with sessions (wizard)", () => ev(`
    await go("#/cycles"); await click("New Allocation Batch");
    await fill("Batch Name", "November 2026 End Semester Examinations"); await fill("Number of Exam Days", "3");
    await click("Continue"); await click("Auto-Select"); await click("Continue"); await click("Create Batch");
    await until(() => location.hash.startsWith("#/allocation/"), "workspace");
    const cycles = await api.getCycles(); const sessions = await api.getSessions(cycles[0].id);
    if (sessions.length !== 6) throw new Error(sessions.length + " sessions");
    return "batch with " + sessions.length + " sessions"`))

  await step("Select staff and halls (hall search by code and block), generate the allocation", () => ev(`
    await click("Select Staff & Generate");
    await until(() => byText(".fixed.inset-0 button", "Select all halls"), "staff/hall selector");
    // Hall search: by hall code, by block (any case), no match, then cleared.
    const hallSearch = await until(() => [...document.querySelectorAll(".fixed.inset-0 input")].find(i => (i.placeholder || "").startsWith("Search halls")), "hall search box");
    const shownHalls = () => [...document.querySelectorAll(".fixed.inset-0 label")].map(l => l.innerText.trim()).filter(t => /^H00[0-9]/.test(t)).map(t => t.slice(0, 4));
    setValue(hallSearch, "h003"); await sleep(150); if (shownHalls().join() !== "H003") throw new Error("hall code search: " + shownHalls());
    setValue(hallSearch, "ANNEXE"); await sleep(150); if (shownHalls().join() !== "H006") throw new Error("block search: " + shownHalls());
    setValue(hallSearch, "zzz"); await sleep(150); if (shownHalls().length || !body().includes('No halls match "zzz"')) throw new Error("no-match state");
    setValue(hallSearch, ""); await sleep(150); if (shownHalls().length !== 6) throw new Error("cleared search: " + shownHalls());
    for (const b of [...document.querySelectorAll(".fixed.inset-0 button")].filter(b => visible(b) && b.innerText.trim() === "Select all")) { b.click(); await sleep(100) } // every department
    await click("Select all halls"); await click("Generate Allocation");
    await until(() => body().includes("All 7 validation rules passed"), "validation passed");
    return "hall search: code, block and no-match ok; " + document.querySelectorAll("main tbody tr").length + " assignments, all 7 rules passed"`))

  await step("A manual edit swaps two invigilators' halls (R1 checked for both); the dialog offers the swaps", () => ev(`
    const cycle = (await api.getCycles())[0]; const s = (await api.getSessions(cycle.id))[0];
    const a = await api.getSessionAllocation(s.id);
    const hallOf = async () => Object.fromEntries((await api.getSessionAllocation(s.id)).map(r => [r.userId, r.hallId]));
    const before = await hallOf();
    const r = await api.editAllocation(s.id, a[0].userId, a[1].hallId, "e2e");
    if (!r.success || r.swappedWithUserId !== a[1].userId) throw new Error(JSON.stringify(r));
    const swapped = await hallOf();
    if (swapped[a[0].userId] !== a[1].hallId || swapped[a[1].userId] !== a[0].hallId) throw new Error("not swapped: " + JSON.stringify(swapped));
    if (!(await api.editAllocation(s.id, a[0].userId, a[0].hallId)).success) throw new Error("swap back failed");
    if (JSON.stringify(await hallOf()) !== JSON.stringify(before)) throw new Error("swap back did not restore the halls");
    // The dialog: the person's own hall is marked Current; every other hall is a swap with its holder.
    document.querySelector("main button[title='Edit hall assignment']").click();
    await until(() => body().includes("Edit Hall Assignment") && document.querySelectorAll(".fixed.inset-0 .grid button").length > 1, "edit dialog");
    const opts = [...document.querySelectorAll(".fixed.inset-0 .grid button")];
    const current = opts.filter(b => b.disabled && b.innerText.includes("Current")).length;
    const swaps = opts.filter(b => !b.disabled && b.innerText.includes("\u2194")).length;
    if (current !== 1 || swaps !== opts.length - 1) throw new Error("dialog: " + opts.map(b => b.innerText.split("\\n").join(" ")).join(" | "));
    // Swap from the dialog, then undo it the same way.
    opts.find(b => !b.disabled).click();
    await until(() => toast().includes("Swapped"), "swap toast");
    const afterUi = await hallOf(); const moved = Object.keys(before).filter(u => before[u] !== afterUi[u]).length;
    if (moved !== 2) throw new Error("the dialog swap changed " + moved + " rows");
    const [u1, u2] = Object.keys(before).filter(u => before[u] !== afterUi[u]).map(Number);
    if (!(await api.editAllocation(s.id, u1, before[u1])).success || JSON.stringify(await hallOf()) !== JSON.stringify(before)) throw new Error("undo failed");
    const hash = location.hash; await go("#/cycles"); await go(hash); await until(() => document.querySelector("main tbody tr"), "workspace");
    return "API swap and swap back ok; dialog shows 1 current + " + swaps + " swaps; dialog swap moved 2 rows and was undone"`))

  await step("Confirm the allocation and export the session PDF", () => ev(`
    await click("Confirm Allocation"); await until(() => byText("button", "Export PDF"), "confirmed");
    capturePdfs(); const n = pdfs().length; await click("Export PDF"); const p = await lastPdf(n);
    if (p.header !== "%PDF-" || p.bytes < 2000) throw new Error(JSON.stringify(p));
    return p.name + " (" + p.bytes + " bytes)"`))

  await step("Copy the previous session's selection into the next session (ticks only; nothing is generated)", () => ev(`
    const cycle = (await api.getCycles())[0]; const [s1, s2] = await api.getSessions(cycle.id);
    await go("#/cycles"); await go("#/allocation/" + cycle.id + "/" + s2.id); await click("Select Staff & Generate");
    await until(() => byText(".fixed.inset-0 button", "Copy previous session"), "copy button");
    await click("Copy previous session", ".fixed.inset-0 button");
    await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes("Copied from"), "copy summary");
    const m = document.querySelector(".fixed.inset-0"); const ticked = m.querySelectorAll("input[type=checkbox]:checked").length;
    const source = (await api.getSessionAllocation(s1.id)).length;
    if (ticked !== source * 2) throw new Error("ticked " + ticked + ", expected " + source + " staff + " + source + " halls");
    if ((await api.getSessionAllocation(s2.id)).length !== 0) throw new Error("copying must not create an allocation");
    [...m.querySelectorAll("button")].find(b => b.innerText.trim() === "Cancel").click(); await sleep(300);
    return source + " staff and " + source + " halls ticked from the previous session; nothing generated or saved"`))

  await step("Allocation history lists the confirmed session", () => ev(`
    await go("#/history"); await click("Search Records");
    await until(() => document.querySelectorAll("main tbody tr").length >= 6, "history rows");
    return document.querySelectorAll("main tbody tr").length + " rows"`))

  await step("All four reports generate and export as PDF", () => ev(`
    capturePdfs(); const out = []; const cycle = (await api.getCycles())[0]; const s = (await api.getSessions(cycle.id))[0];
    for (const [card, filters] of [["Staff-Wise Duty Report", []], ["Date-Wise Allocation Sheet", [["Allocation Batch", cycle.id], ["Session", s.id]]], ["Complete Timetable Grid", [["Allocation Batch", cycle.id]]], ["Rotation Audit Report", [["Allocation Batch", cycle.id]]]]) {
      await go("#/reports"); await click(card);
      for (const [label, v] of filters) {
        await until(() => { const f = field(label); return f && [...f.options].some(o => o.value === String(v)) }, label + " option " + v);
        await fill(label, String(v)); await sleep(300);
      }
      await click("Generate"); await until(() => byText("button", "Export PDF"), card + " generated");
      const n = pdfs().length; await click("Export PDF"); const p = await lastPdf(n);
      if (p.header !== "%PDF-") throw new Error(card + " PDF " + JSON.stringify(p));
      out.push(card.split(" ")[0] + " " + p.bytes + "B");
    }
    return out.join(", ")`))

  await step("Staff duty history carries date, session, hall, status and times; the edit dialog timeline shows them", () => ev(`
    const staff = (await api.getUsers({ role: "staff" })).find(u => u.staff_id === "STF001");
    const d = (await api.getStaffDutyHistory(staff.id))[0];
    for (const k of ["exam_date", "session_type", "status", "reporting_time", "exam_start", "exam_end", "hall_code", "cycleName"]) if (d[k] == null || d[k] === "") throw new Error("missing " + k + ": " + JSON.stringify(d));
    if (d.status !== "confirmed") throw new Error("status " + d.status);
    const cycle = (await api.getCycles())[0]; await go("#/allocation/" + cycle.id);
    const row = await until(() => [...document.querySelectorAll("main tbody tr")].find(tr => tr.innerText.includes("STF001")), "STF001 row");
    row.querySelector("button[title='Edit hall assignment']").click();
    const timeline = await until(() => { const t = document.querySelector(".fixed.inset-0")?.innerText; return t && /last 1 assignments/i.test(t) && t }, "timeline"); // heading is styled uppercase
    const [y, m, dd] = d.exam_date.split("-");
    if (!timeline.includes(d.hall_code) || !timeline.includes(d.session_type) || !timeline.includes(dd)) throw new Error("timeline: " + timeline);
    [...document.querySelectorAll(".fixed.inset-0 button")].find(b => !b.innerText.trim() && b.querySelector("svg")).click(); await sleep(300);
    return d.exam_date + " " + d.session_type + " " + d.hall_code + " " + d.status + " report " + d.reporting_time + " exam " + d.exam_start + "-" + d.exam_end`))

  await step("Settings save locally", () => ev(`
    await go("#/settings"); await fill("Short Name / Abbreviation", "E2E-TEST"); await click("Save Profile");
    await until(() => document.querySelector("aside")?.innerText.includes("E2E-TEST"), "sidebar short name");
    return "college short name saved and shown in the sidebar"`))

  await step("The college name from Settings appears on the Dashboard, the batch wizard and the History PDF", () => ev(`
    const name = "E2E Test College of Engineering";
    await go("#/settings"); await fill("College Full Name", name); await click("Save Profile");
    await go("#/dashboard"); await until(() => document.querySelector("main")?.innerText.includes(name), "college name on the Dashboard");
    await go("#/cycles"); await click("New Allocation Batch");
    await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes(name), "college name in the batch wizard");
    [...document.querySelectorAll(".fixed.inset-0 button")].find(b => b.innerText.trim() === "Cancel").click(); await sleep(300);
    capturePdfs(); await go("#/history"); await click("Search Records"); await until(() => document.querySelectorAll("main tbody tr").length > 0, "history rows");
    const n = pdfs().length; await click("Export PDF"); await until(() => pdfs().length > n, "History PDF");
    const text = new TextDecoder("latin1").decode(await (await fetch(pdfs()[pdfs().length - 1].href)).arrayBuffer());
    if (!text.includes(name)) throw new Error("the History PDF does not carry the college name from Settings");
    return "shown on the Dashboard and in the wizard; printed on the History PDF"`))

  await step("Every PDF prints the college name saved in Settings, even when it is changed after the page was opened", () => ev(`
    const cycle = (await api.getCycles())[0]; const s = (await api.getSessions(cycle.id))[0];
    capturePdfs(); const done = [];
    const rename = async name => { const r = await api.saveSetting("college.name", name); if (r?.success === false) throw new Error(JSON.stringify(r)) };
    const check = async (what, name, before) => {
      await until(() => pdfs().length > before, what + " PDF");
      const t = new TextDecoder("latin1").decode(await (await fetch(pdfs()[pdfs().length - 1].href)).arrayBuffer());
      if (!t.includes(name)) throw new Error(what + " PDF does not carry the name saved in Settings (" + name + ")");
      if (t.includes("Xavier") || t.includes("E2E Test College")) throw new Error(what + " PDF still carries an older college name");
      done.push(what);
    };
    // The session sheet: the workspace is already open when the name changes.
    await go("#/allocation/" + cycle.id + "/" + s.id); await until(() => byText("button", "Export PDF"), "workspace");
    await rename("Renamed College One"); let n = pdfs().length; await click("Export PDF"); await check("Session sheet", "Renamed College One", n);
    // The history report and the four reports, each opened before the rename.
    await go("#/history"); await click("Search Records"); await until(() => document.querySelectorAll("main tbody tr").length > 0, "history rows");
    await rename("Renamed College Two"); n = pdfs().length; await click("Export PDF"); await check("History", "Renamed College Two", n);
    let i = 2;
    for (const [card, filters] of [["Staff-Wise Duty Report", []], ["Date-Wise Allocation Sheet", [["Allocation Batch", cycle.id], ["Session", s.id]]], ["Complete Timetable Grid", [["Allocation Batch", cycle.id]]], ["Rotation Audit Report", [["Allocation Batch", cycle.id]]]]) {
      await go("#/reports"); await click(card);
      for (const [label, v] of filters) {
        await until(() => { const f = field(label); return f && [...f.options].some(o => o.value === String(v)) }, label + " option " + v);
        await fill(label, String(v)); await sleep(300);
      }
      await click("Generate"); await until(() => byText("button", "Export PDF"), card + " generated");
      const name = "Renamed College " + (++i); await rename(name);
      n = pdfs().length; await click("Export PDF"); await check(card.split(" ")[0], name, n);
    }
    await rename("E2E Test College of Engineering");
    return done.join(", ") + " all carried the newest name"`))

  await step("The sidebar turns icon-only exactly where the page layouts switch to narrow (1024px)", async () => {
    // With display scaling the width can be fractional (1023.2px at 125%); both must agree there too.
    const seen = []
    for (const w of [1366, 1024, 1023, 1022, 960, 1366]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false })
      const r = await ev(`const read = () => ({ w: visualViewport.width, lg: matchMedia("(min-width: 1024px)").matches, sidebar: Math.round(document.querySelector("aside").getBoundingClientRect().width) }); await sleep(400); let r = read(); for (let i = 0; i < 25 && (r.sidebar === 64) === r.lg; i++) { await sleep(100); r = read() } return r`) // the media-query event can arrive late in a background window
      seen.push(`${Math.round(r.w * 10) / 10}px ${r.sidebar === 64 ? "icons" : "full"}`)
      if ((r.sidebar === 64) === r.lg) throw new Error(`at ${r.w}px the sidebar is ${r.sidebar}px but the page layout is ${r.lg ? "wide" : "narrow"}`)
    }
    await cdp.send("Emulation.clearDeviceMetricsOverride")
    return seen.join(", ")
  })

  await step("Back up the database to a local file", async () => {
    const r = await ev(`return await api.backupDatabase(${js(backupFile)})`)
    assert(r.success, JSON.stringify(r))
    assert(fs.readFileSync(backupFile).subarray(0, 15).toString() === "SQLite format 3", "backup is not a SQLite file")
    return `${fs.statSync(backupFile).size} bytes`
  })

  await step("Restart HIAS: all data persisted", async () => {
    await quitApp(); launch(); await connect()
    return ev(`
      await until(() => location.hash === "#/dashboard", "dashboard after restart");
      const cycle = (await api.getCycles())[0]; const s = await api.getSessions(cycle.id);
      const counts = { departments: (await api.getDepartments()).length, staff: (await api.getUsers({ role: "staff" })).length, halls: (await api.getHalls()).length, sessions: s.length, confirmed: s.filter(x => x.status === "confirmed").length };
      if (JSON.stringify(counts) !== JSON.stringify({ departments: 1, staff: 6, halls: 6, sessions: 6, confirmed: 1 })) throw new Error(JSON.stringify(counts));
      return JSON.stringify(counts)`)
  })

  await step("Restore refuses a file that is not a HIAS backup", () => ev(`
    const r = await api.restoreDatabase(${js(notADb)}); if (r.success || !/not a HIAS database/.test(r.error)) throw new Error(JSON.stringify(r));
    return r.error`))

  await step("Restore the backup: safety copy kept, HIAS restarts with the backed-up data", async () => {
    await ev(`const r = await api.saveDepartment({ code: "EEE", name: "Made after the backup" }); if (!r.success) throw new Error(JSON.stringify(r))`)
    const r = await ev(`return await api.restoreDatabase(${js(backupFile)})`)
    assert(r.success && r.safetyCopy && fs.existsSync(r.safetyCopy), JSON.stringify(r))
    cdp.close(); await sleep(4000); await connect() // HIAS relaunches itself
    return ev(`
      await until(() => location.hash === "#/dashboard", "dashboard after restore");
      const codes = (await api.getDepartments()).map(d => d.code);
      if (JSON.stringify(codes) !== JSON.stringify(["cse"])) throw new Error("departments " + JSON.stringify(codes));
      return "restored; department added after the backup is gone; safety copy ${path.basename(r.safetyCopy)}"`)
  })

  await step("Delete a batch from Settings: batch name plus a registered person (Staff ID and name matching the Staff list) are required, and the deletion is recorded; the Batches list has no delete button", () => ev(`
    const temp = await api.createCycle({ name: "E2E batch to delete", academic_year: "2026-27" });
    const keep = (await api.getCycles()).length - 1;
    await go("#/cycles"); await until(() => byText("main", "E2E batch to delete"), "batch list");
    const found = [...document.querySelectorAll("main button[title*=Delete], main button svg.lucide-trash-2, main button svg.lucide-trash2")]; if (found.length) throw new Error("the Batches list still has a delete button: " + found.map(e => e.outerHTML.slice(0, 200)).join(" | "));
    await go("#/settings"); await click("Delete Batch", "nav button");
    const row = await until(() => [...document.querySelectorAll("main div")].filter(d => visible(d) && d.innerText.includes("E2E batch to delete") && d.querySelector("button") && d.innerText.length < 160).pop(), "batch row in Settings");
    [...row.querySelectorAll("button")].find(b => b.innerText.includes("Delete")).click(); await sleep(400);
    const input = ph => document.querySelector(".fixed.inset-0 input[placeholder=" + JSON.stringify(ph) + "]");
    const submit = () => [...document.querySelectorAll(".fixed.inset-0 button")].find(b => b.innerText.trim() === "Delete Batch");
    await until(() => input("E2E batch to delete"), "batch name field");
    // The button stays disabled until all three are filled; a wrong batch name is refused with a message.
    if (!submit().disabled) throw new Error("the Delete Batch button should be disabled while the form is empty");
    setValue(input("E2E batch to delete"), "NOPE"); setValue(input("Name of the person deleting"), "Anitha Rajendran"); setValue(input("e.g. STF001"), "STF001"); await sleep(150);
    submit().click(); await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes("does not match"), "wrong batch name refused");
    if (!(await api.getCycles()).some(c => c.id === temp.id)) throw new Error("a wrong batch name must not delete the batch");
    // The right batch name but a person who is not in the Staff list, or the wrong name for a real Staff ID, is refused by the database check.
    const who = (name, id) => { setValue(input("E2E batch to delete"), "E2E batch to delete"); setValue(input("Name of the person deleting"), name); setValue(input("e.g. STF001"), id) };
    who("Random Person", "ZZZ999"); await sleep(150); submit().click(); await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes("is registered"), "unknown Staff ID refused");
    who("Random Person", "STF001"); await sleep(150); submit().click(); await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes("does not match the registered name"), "wrong name for a real Staff ID refused");
    if (!(await api.getCycles()).some(c => c.id === temp.id)) throw new Error("a person who is not registered must not be able to delete the batch");
    who("Anitha Rajendran", "STF001");
    // The right batch name but a badly formed Staff ID is refused too.
    setValue(input("e.g. STF001"), "ST F1"); await sleep(150);
    submit().click(); await until(() => document.querySelector(".fixed.inset-0")?.innerText.includes("no spaces"), "bad Staff ID refused");
    if (!(await api.getCycles()).some(c => c.id === temp.id)) throw new Error("a bad Staff ID must not delete the batch");
    setValue(input("e.g. STF001"), "STF001"); await sleep(150); submit().click();
    await until(() => toast().includes("deleted"), "deleted toast");
    const left = await api.getCycles();
    if (left.some(c => c.id === temp.id) || left.length !== keep) throw new Error("batches left: " + left.map(c => c.name).join(", "));
    const rec = (await api.getDeletedBatches())[0];
    if (!rec || rec.batch_name !== "E2E batch to delete" || rec.deleted_by_name !== "Anitha Rajendran" || rec.deleted_by_staff_id !== "STF001" || !rec.deleted_at) throw new Error("record: " + JSON.stringify(rec));
    await until(() => byText("main", "Anitha Rajendran · STF001"), "record shown in Settings");
    return "wrong batch name, unknown person, wrong name for a real Staff ID and bad Staff ID all refused; deleted only the chosen batch; recorded as deleted by Anitha Rajendran (STF001) at " + rec.deleted_at`))

  await step("Restart the rotation (typed confirmation, no password)", () => ev(`
    await go("#/settings"); await click("Restart Rotation"); // the section in the menu
    const buttons = await until(() => { const b = [...document.querySelectorAll("button")].filter(b => visible(b) && b.innerText.trim() === "Restart Rotation"); return b.length > 1 && b }, "restart button");
    buttons[buttons.length - 1].click(); await sleep(300); // the button in the panel
    const input = await until(() => document.querySelector("input[placeholder=RESTART]"), "RESTART field"); setValue(input, "RESTART"); await sleep(100);
    await click("Confirm"); await until(() => toast().toLowerCase().includes("restart"), "restart toast");
    const staff = (await api.getUsers({ role: "staff" }))[0];
    if ((await api.getStaffDutyHistory(staff.id)).length === 0) throw new Error("allocations should stay");
    return toast()`))

  await step("No network request was made", () => {
    assert(externalRequests.length === 0, "requests: " + externalRequests.join(", "))
    return "0 external requests"
  })
} catch {
  failed = true
} finally {
  if (cdp) await quitApp()
  killTestInstances()
  console.log(`\n${results.filter(r => r.result === "PASS").length}/${results.length} steps passed${failed ? " (stopped at the first failure)" : ""}`)
  if (!failed) fs.rmSync(dataDir, { recursive: true, force: true })
  else console.log(`Data folder kept for inspection: ${dataDir}`)
  process.exit(failed ? 1 : 0)
}
