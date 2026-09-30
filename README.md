# HIAS â€“ Hall Invigilator Allocation System

<img src="app/resources/icon.png" alt="HIAS logo" width="96" align="right">

An offline Windows desktop application for St. Xavier's Catholic College of Engineering (SXCCE), Nagercoil, that assigns invigilators to examination halls for every exam session and rotates those assignments fairly. It remembers every confirmed duty, so nobody returns to a hall before they have been through the rest of the rotation.

- **Install:** `app/release/HIAS-Setup-1.0.0.exe` (built with `npm run package`; installs `HIAS.exe` for all users)
- **User guide:** [docs/HIAS-User-Guide.pdf](docs/HIAS-User-Guide.pdf)
- **Project report:** [docs/HIAS-Project-Report.pdf](docs/HIAS-Project-Report.pdf)

## Features

- **Master data:** departments, halls and staff, with bulk staff import from Excel and row-by-row error reporting.
- **Allocation batches:** a wizard turns calendar dates into FN/AN sessions with timings; Sundays and public holidays are flagged.
- **One-click allocation:** pick the staff and halls for a session (tick them, search by name or Staff ID, or upload an Excel duty list); the rotation engine assigns everyone a hall.
- **Validation (R1â€“R7):** no early hall repeats, no double-booked halls or staff, active staff and halls only, staff count equals hall count, rotation order.
- **Controlled edits:** manual changes offer only rule-safe halls and are recorded as "Admin Edited".
- **Reports:** session allocation sheet, staff-wise duties, date-wise hall sheet, complete timetable grid and rotation audit, all exportable to PDF with the college letterhead.
- **Offline and self-contained:** no server, no internet, no login; one-click backup and restore.

## Tech stack

Electron 32 Â· electron-vite (Vite 5) Â· TypeScript 5 (strict) Â· React 18 Â· React Router 6 Â· Tailwind CSS 3 Â· Zustand Â· SQLite via sql.js (WebAssembly) Â· jsPDF + jspdf-autotable Â· SheetJS xlsx Â· Vitest Â· electron-builder (NSIS installer)

## Project layout

```
README.md
docs/                        User guide and project report (HTML sources + PDFs, screenshots),
                             staff-import Excel template, original workflow spec (.docx)
start-hias-dev.bat           Double-click launcher for development mode
app/                         The application
  resources/logo-source.webp Logo artwork; icon.png / icon.ico are generated from it
  scripts/                   build-icons.cjs, build-docs.cjs, build-web.mjs
  seed.js                    Fills a development database with demo data
  src/main/                  Electron main process
    index.ts                 Window, data folder, startup error dialog, download handling
    db/                      sql.js database, schema and migrations
    ipc/                     IPC handlers (auth/backup, master data, batches, allocation, reports)
    services/                Rotation engine, validation engine, allocation and report services (+ tests)
  src/preload/index.ts       The window.api bridge exposed to the UI
  src/renderer/src/          React UI: pages/, components/, lib/, store/
  src/tests/                 Additional integration tests
```

## Architecture

The UI (renderer) never touches the database. Every operation goes through `window.api` (`src/preload/index.ts`) to an IPC handler in `src/main/ipc/`, which calls the services in `src/main/services/`. The database is a single SQLite file, `%APPDATA%\eias\eias.db`, loaded into memory with sql.js and written back to disk after every committed change. Multi-step operations run in transactions.

The desktop app has **no login**: on start it signs in as the local administrator (`auth:getLocalAdmin`). Destructive actions ask the user to type `DELETE` (or `RESTART` for a rotation restart).

### Web build (secondary)

The same UI can be built for a browser with `npm run build:web` (Firebase Hosting config included). In a browser there is no main process: `src/renderer/src/lib/api.ts` routes calls to `src/renderer/src/lib/web-api.ts`, which re-implements the services on top of an IndexedDB-persisted sql.js database, and the login screen and password confirmations are used. `src/renderer/src/lib/platform.ts` (`IS_DESKTOP`) is the switch. **Business-logic changes must be made in both `src/main/services` and `web-api.ts`.** Each browser has its own private data.

### Rotation rules to understand before changing the engine

- `rotation_history` is global (not per batch), so fairness carries across exam series. Only **confirmed** sessions write to it.
- Halls are assigned to all staff of a session together, as a minimum-cost matching (Hungarian algorithm) in `src/shared/assignment.ts`, shared by the desktop engine and the web build. R1 (no hall twice within a person's current rotation cycle over the session's hall pool; the cycle resets once they have had every hall) carries a dominating penalty, so R1 holds whenever possible; after that, least-visited halls are preferred and the person's previous hall is avoided, and the remaining choice is a random draw seeded by batch, session and the selected staff and halls (so regenerating the same draft gives the same result).
- When the staff on duty vary, R1 can be impossible to satisfy for everyone. The validator then accepts the allocation if its repeats do not exceed the proven minimum, and reports them as warnings (`minimumUnavoidableRepeats`).
- `allocation.fairness.test.ts` runs 29 multi-session scenarios (fixed teams, staff taking turns, random duty lists, varying hall sets, newcomers, leave, hall closures, edits, forced repeats, rule violations, long runs, a very large college) and prints a fairness table.
- R1 looks back `cycleLength - 1` entries, so a full cycle may restart (regression test T13).
- A batch's status is derived from its sessions (`refreshCycleStatus`): `draft` until every session is confirmed, then `confirmed`.

## Development

Requirements: Node.js 20+ on Windows.

```bash
cd app
npm install
npm run dev          # run the desktop app with hot reload (or double-click start-hias-dev.bat)
npm test             # 89 Vitest tests, including the fairness suite
npm run typecheck    # TypeScript, main + renderer
npm run package      # build the Windows installer app/release/HIAS-Setup-<version>.exe
npm run icons        # regenerate icon.png / icon.ico from resources/logo-source.webp
npm run docs         # re-render docs/*.html to PDF
```

Development mode keeps its database at `app/eias.db`; the installed app uses `%APPDATA%\eias\eias.db`. To run the packaged app against a throwaway data folder (for testing), start it with `--user-data-dir=<folder>`.

## Known limitations

- Data lives on one computer; use backup and restore to move it.
- No user accounts in the desktop app; install it on a computer only the examination cell uses.
- The installer is not code-signed, so Windows SmartScreen warns on first install.
- Halls cannot be reordered after creation.

## Team

Developed by Anushath S, Akhil Koska A and Harish S.

## License

MIT
