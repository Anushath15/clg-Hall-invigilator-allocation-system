# Hall Invigilator Allocation System (HIAS)

A tool for St. Xavier's Catholic College of Engineering (SXCCE), Nagercoil, that generates fair, rotating exam-hall invigilator assignments across a series of exam sessions, and tracks that history so no invigilator gets an unfair repeat before everyone else has had a turn.

- **Live web build:** https://myapplication-2adb30a9.web.app
- **Repo:** https://github.com/Anushath15/clg-Hall-invigilator-allocation-system
- **Desktop build:** Windows installer built from the same source via Electron

## What this actually does

Given a pool of exam halls and a pool of active staff for an exam cycle, HIAS assigns each staff member to a hall for every exam session, then rotates who gets which hall session-to-session so the same person doesn't keep landing in the same hall (or repeat a hall before a full cycle has passed). It validates each generated allocation against a set of rules (R1–R7: no repeat within a cycle, no two staff in the same hall in the same session, etc.), lets an admin manually edit individual assignments before confirming, and keeps a running history (`rotation_history`) used to compute the next rotation. Once a session's allocation is confirmed, staff are notified and can view their assigned hall; admins can generate reports (PDF/Excel) and browse rotation history.

## Tech stack

- **Electron 32** (desktop shell) + **electron-vite** (build tooling) — one codebase, two build targets
- **React 18** + **React Router** + **Zustand** (UI and state)
- **Tailwind CSS** (styling)
- **sql.js** — SQLite compiled to WebAssembly, used identically on both platforms (no native database driver)
- **bcryptjs** for password hashing (real hashing, both platforms)
- **jsPDF / xlsx** for report export
- **Vitest** as the test runner (see "Known limitations" for why it can't be run in every environment)
- **Firebase Hosting** for the web build

## Architecture: two builds from one codebase — read this before changing shared logic

`electron-vite build` produces both:

1. **Desktop (Electron):** the renderer (React UI) talks to the main process over IPC (`src/preload/index.ts` → `src/main/ipc/*.ts` → `src/main/services/*.ts`). The database is a real `sql.js` SQLite file (`eias.db`) persisted to disk with Node's `fs`, on whatever machine runs the app.
2. **Web (Firebase Hosting):** there is **no server backend**. The same `sql.js` engine runs entirely in the browser, and the database is persisted to the browser's own **IndexedDB**. The business logic that would otherwise live in IPC handlers is reimplemented in one file, `src/renderer/src/lib/web-api.ts`.

Both platforms are wired to the same React UI through a small `Proxy`-based bridge (`src/renderer/src/lib/api.ts`) that routes each call to `window.api` (Electron IPC) when present, or to the web implementation otherwise — so UI components don't know or care which platform they're running on. **The actual risk of drift lives in the business-logic layer**, not the UI: any change to rotation, validation, or hall-ordering logic has to be made in *both* `src/main/services/*.ts` (desktop) *and* `src/renderer/src/lib/web-api.ts` (web), by hand, since nothing enforces they stay in sync. This has already caused at least one real bug (see below) and is a good candidate for future consolidation.

### Important architectural limitation: no shared backend, single-device model

The web build has **no server-side database**. Every browser that opens the live URL gets its own private, disconnected local database (via IndexedDB) — data entered by an admin in one browser is invisible to any other browser or device. This is by design for this project's scope, not a bug, but it means:

- The web build is only realistically usable as a **single-admin-device** tool (one person, one browser, doing the data entry), not a shared multi-user system.
- A genuinely shared, multi-user deployment would need a real backend and server-side database — a separate, larger project, not a small fix.
- The **desktop (Electron) build** is the one with a real, persistent, file-based database (`eias.db`), and is the more realistic option if the college wants one shared source of truth on one admin machine.

### Rotation and validation rules — do not change without understanding these first

- `rotation_history` is deliberately **global**, not scoped to any particular exam cycle. It represents the full chronological history of who's had which hall, across cycles.
- The rotation engine picks the next hall for a staff member by a circular offset over the **current session's hall pool**, in the pool's array order. That order is made deterministic by sorting on `sort_order, id` (id as an explicit tiebreak) — hall `sort_order` is never actually edited through the UI (it's always `0` or an auto-incremented default), so without the `id` tiebreak, ties resolve in undefined SQL order and rotation output becomes non-deterministic. A previous version of this code had exactly that bug.
- Rule R1 ("can't repeat a hall") looks back exactly `cycleLength - 1` history entries, not `cycleLength`. An earlier version used `cycleLength`, which incorrectly blocked a legitimate full-cycle restart (staff member N sessions into a cycle of size N should be allowed to return to their very first hall). This is verified by a dedicated regression test (T13 in `rotation.engine.test.ts`).

## Running it locally

```bash
git clone https://github.com/Anushath15/clg-Hall-invigilator-allocation-system.git
cd clg-Hall-invigilator-allocation-system/eias
npm install
npm run dev        # Electron desktop app, hot-reloading
```

Run tests:
```bash
npm run test       # vitest run
```

Build:
```bash
npm run build              # web/renderer build → out/
npm run package            # Windows installer (electron-builder) → release/
npm run deploy:firebase    # build + deploy the web target to Firebase Hosting
```

## Deployment

The web build is deployed to Firebase Hosting (`firebase.json`: publishes `out/renderer`, with a catch-all SPA rewrite to `index.html`). The desktop build is packaged as a Windows NSIS installer via `electron-builder` (`npm run package`, output in `release/`).

## Default accounts (development seed only)

`seed.js` creates a default admin (`ADMIN001`) and ten sample staff accounts (`SX001`–`SX010`) for local development/demo purposes. **Change these passwords before using this in front of real staff** — the seed script's password is plaintext in source control and should never be treated as a real credential.

## Known limitations

- **No shared backend for the web build** (see Architecture above) — each browser's data is private to that browser.
- **Test suite requires a Linux or macOS environment with network access to npm's registry** to install native `rollup`/`esbuild` bindings; it will not run out-of-the-box in a network-restricted sandbox.
- **Hall `sort_order` has no UI to edit it directly** — order is fixed at creation time (auto-incremented), which is a minor UX limitation, not a correctness bug (the `id` tiebreak keeps ordering deterministic regardless).

## What I built and why

This started as a manual, error-prone process: whoever organizes invigilation duty for an exam cycle at SXCCE had to keep track by hand of who'd been assigned to which hall, to avoid unfairly repeating someone while others hadn't had a turn yet. HIAS turns that into: define your halls and staff pool once, generate an allocation for each session with one click, review/edit it if needed, confirm it, and the system remembers the rotation state so the next session's allocation is generated fairly and automatically — with a validation layer that catches the mistakes a human reviewer would otherwise have to check for by hand (double-bookings, repeats, pool mismatches). It ships as both a web app (quick to demo, no install) and a desktop app (the more realistic option for actual day-to-day use by one admin), sharing one codebase and UI.

## License

MIT
