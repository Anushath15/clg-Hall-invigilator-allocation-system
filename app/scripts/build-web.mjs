// Builds the renderer for web deployment (Firebase Hosting).
//
// The only difference from `npm run build` is BUILD_TARGET=web, which makes
// electron.vite.config.ts use an absolute asset base ("/") instead of the
// relative one Electron needs for file://. Without it, deep links such as
// /allocation/1 request /allocation/assets/index-*.js, the SPA rewrite answers
// with index.html, and the page renders blank.
//
// This exists as a script rather than an inline env var because
// `BUILD_TARGET=web electron-vite build` is not valid in cmd.exe or PowerShell.
import { spawnSync } from "node:child_process"

const result = spawnSync("npx", ["electron-vite", "build"], {
  stdio: "inherit",
  env: { ...process.env, BUILD_TARGET: "web" },
  shell: process.platform === "win32"
})

process.exit(result.status ?? 1)
