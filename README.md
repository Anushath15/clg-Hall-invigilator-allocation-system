# HIAS – Hall Invigilator Allocation System

<img src="app/resources/icon.png" alt="HIAS logo" width="96" align="right">

An offline Windows desktop application for St. Xavier's Catholic College of Engineering (SXCCE), Nagercoil, that assigns invigilators to examination halls for every exam session and rotates those assignments fairly. It remembers every confirmed duty, so nobody returns to a hall before they have been through the rest of the rotation.

- **Install:** `app/release/HIAS-Setup-1.1.0.exe` (built with `npm run package`; installs `HIAS.exe` for all users)
- **User guide:** [docs/HIAS-User-Guide.pdf](docs/HIAS-User-Guide.pdf)
- **Project report:** [docs/HIAS-Project-Report.pdf](docs/HIAS-Project-Report.pdf)

## Features

- **Master data:** departments, halls and staff, with bulk staff import from Excel and row-by-row error reporting.
- **Allocation batches:** a wizard turns calendar dates into FN/AN sessions with timings; Sundays are holidays in every year and past dates cannot be scheduled.
- **One-click allocation:** pick the staff and halls for a session (tick them, search staff by name or Staff ID and halls by code or block, upload an Excel duty list, or copy the selection of an earlier session); the rotation engine assigns everyone a hall afresh.
- **Validation (R1–R7):** no early hall repeats, no double-booked halls or staff, active staff and halls only, staff count equals hall count, rotation order.
- **Controlled edits:** a manual change swaps two invigilators' halls, is offered only when the rules hold for both, and is recorded as "Admin Edited".
- **Reports:** session allocation sheet, staff-wise duties, date-wise hall sheet, complete timetable grid and rotation audit, all exportable to PDF with the college letterhead.
- **Offline and self-contained:** no server, no internet, no login; one-click backup and restore.

## Tech stack

Electron 32 · electron-vite (Vite 5) · TypeScript 5 (strict) · React 18 · React Router 6 · Tailwind CSS 3 · Zustand · SQLite via sql.js (WebAssembly) · jsPDF + jspdf-autotable · SheetJS xlsx · Vitest · electron-builder (NSIS installer)

## Project layout

```
README.md
docs/                        User guide and project report (HTML sources + PDFs, screenshots),
                             staff-import Excel template, original workflow spec (.docx)
start-hias-dev.bat           Double-click launcher for development mode
app/                         The application
  resources/logo-source.webp Logo artwork; icon.png / icon.ico are generated from it
  scripts/                   build-icons.cjs, build-docs.cjs, build-web.mjs,
                             e2e-offline.mjs (end-to-end test of the packaged app, network blocked)
  seed.js                    Fills a development database with demo data
  src/main/                  Electron main process
    index.ts                 Window, data folder, startup error dialog, download handling
    db/                      sql.js database, schema and migrations
    ipc/                     IPC handlers (auth/backup, master data, batches, allocation, reports)
    services/                Rotation engine, validation engine, allocation, master-data, report and
                             backup services (+ tests)
  src/shared/                Logic shared by the desktop and web builds: hall assignment, staff import,
                             staff duty history
  src/preload/index.ts       The window.api bridge exposed to the UI
  src/renderer/src/          React UI: pages/, components/, lib/, store/
  src/tests/                 Additional integration tests
```

## Architecture

The UI (renderer) never touches the database. Every operation goes through `window.api` (`src/preload/index.ts`) to an IPC handler in `src/main/ipc/`, which calls the services in `src/main/services/`. The database is a single SQLite file, `%APPDATA%\eias\eias.db`, loaded into memory with sql.js and written back to disk after every committed change. Multi-step operations run in transactions.

### Offline desktop (the production application)

- **No internet.** The desktop app makes no network requests: no server, cloud service, update check or web font. `npm run test:e2e` drives the packaged app with every host name unresolvable and all traffic sent to a dead proxy, and fails on any request that is not a local file.
- **No login.** On start the app signs in as the built-in local administrator (`ADMIN001`, via `auth:getLocalAdmin`); there is no login screen, password prompt or logout, and every route leads to the admin screens (`/login` and unknown routes redirect to `/dashboard`). Destructive actions ask the user to type `DELETE` (or `RESTART` for a rotation restart). The `users` table still holds all staff records (and that one admin row, used as the internal identity).
- **Security model.** HIAS Desktop is a trusted local administrative application: whoever can use the Windows account can use HIAS. The security boundary is the Windows account and physical access to the PC, not an application login. The renderer runs with `contextIsolation: true` and `nodeIntegration: false` and reaches the main process only through the `window.api` bridge.
- **Data.** Startup opens (or, on a fresh install, creates) `%APPDATA%\eias\eias.db`, runs the pending migrations in `src/main/db/database.ts` (they only add tables or columns, so older databases keep all their data) and fills in missing default settings. No demo data is created. Backup copies that file; restore checks that the chosen file is a HIAS database, keeps a timestamped safety copy (`eias.db.before-restore-<date>-<time>.bak`), replaces the file and restarts the app.

### Web build (optional preview)

The same UI can be built for a browser with `npm run build:web` (Firebase Hosting config included); it is not needed by, and not part of, the desktop app. In a browser there is no main process: `src/renderer/src/lib/api.ts` routes calls to `src/renderer/src/lib/web-api.ts`, which re-implements the services on top of an IndexedDB-persisted sql.js database, and the login screen, password confirmations and the staff self-service page (`/staff/duty`) are used. `src/renderer/src/lib/platform.ts` (`IS_DESKTOP`) is the switch. **Business-logic changes must be made in both `src/main/services` and `web-api.ts`** (or in `src/shared/`, which both use). Each browser has its own private data.

### Rotation rules to understand before changing the engine

- `rotation_history` is global (not per batch), so fairness carries across exam series. Only **confirmed** sessions write to it.
- Halls are assigned to all staff of a session together, as a minimum-cost matching (Hungarian algorithm) in `src/shared/assignment.ts`, shared by the desktop engine and the web build. R1 (no hall twice within a person's current rotation cycle over the session's hall pool; the cycle resets once they have had every hall) carries a dominating penalty, so R1 holds whenever possible; after that, least-visited halls are preferred and the person's previous hall is avoided, and the remaining choice is a random draw seeded by batch, session and the selected staff and halls (so regenerating the same draft gives the same result).
- When the staff on duty vary, R1 can be impossible to satisfy for everyone. The validator then accepts the allocation if its repeats do not exceed the proven minimum, and reports them as warnings (`minimumUnavoidableRepeats`).
- `allocation.fairness.test.ts` runs 30 multi-session scenarios (fixed teams, staff taking turns, random duty lists, varying hall sets, newcomers, leave, hall closures, edits, forced repeats, rule violations, long runs, a very large college) and prints a fairness table.
- R1 is measured over the person's current cycle (`visitedThisCycle`), so a completed cycle restarts cleanly (regression test T13).
- A batch's status is derived from its sessions (`refreshCycleStatus`): `draft` until every session is confirmed, then `confirmed`.
- A manual edit is a swap (`src/shared/swap.ts`): R1 is checked for both people. A row counts as Admin Edited while it differs from its generated hall.
- R4: a session can be confirmed only when every earlier session (lower `rotation_step`) of its batch is confirmed. Unconfirmed sessions are renumbered into date order after the confirmed ones (`src/shared/session-order.ts`); confirmed sessions are never renumbered.
- Copying a session's selection (`src/shared/copy-selection.ts`) copies staff and hall IDs only; generation always runs the engine afresh.

## Development

Requirements: Node.js 20+ on Windows.

```bash
cd app
npm install
npm run dev          # run the desktop app with hot reload (or double-click start-hias-dev.bat)
npm test             # 159 Vitest tests: engine, fairness suite, swaps, session order, copy selection, offline workflow, backup/restore, migrations
npm run typecheck    # TypeScript, main + renderer
npm run package      # build the Windows installer app/release/HIAS-Setup-<version>.exe
npm run test:e2e     # drive the packaged app end to end with the network blocked (after npm run package)
npm run icons        # regenerate icon.png / icon.ico from resources/logo-source.webp
npm run docs         # re-render docs/*.html to PDF
```

Development mode keeps its database at `app/eias.db`; the installed app uses `%APPDATA%\eias\eias.db`. To run the packaged app against a throwaway data folder (for testing), start it with `--user-data-dir=<folder>`.

## Known limitations

- Data lives on one computer; use backup and restore to move it.
- No user accounts in the desktop app (by design, see the security model above); install it on a computer and Windows account that only the examination cell uses.
- The installer is not code-signed, so Windows SmartScreen warns on first install.
- Halls cannot be reordered after creation.

## Team

Developed by Anushath S, Akhil Koska A and Harish S.

## License

MIT
