import { resolve } from "path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        external: ["sql.js", "bcryptjs", "xlsx"]
      }
    },
    resolve: {
      alias: { "@main": resolve("src/main") }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: []
      }
    }
  },
  renderer: {
    // Electron loads index.html over file:// (src/main/index.ts, loadFile), which
    // only works with relative asset paths. The Firebase web deployment needs
    // absolute ones: with a relative base, a nested route like /allocation/1
    // resolves its assets to /allocation/assets/..., the SPA rewrite serves
    // index.html for those, and the page dies on "MIME type text/html".
    // BUILD_TARGET is set by scripts/build-web.mjs (npm run build:web).
    base: process.env.BUILD_TARGET === "web" ? "/" : "./",
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [react()]
  }
})
