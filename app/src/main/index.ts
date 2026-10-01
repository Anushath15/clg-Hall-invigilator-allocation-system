import { app, BrowserWindow, shell, dialog } from "electron"
import { join } from "path"
// electron-toolkit inlined
import { initDatabase } from "./db/database"
import { ensureDefaultAdmin } from "./services/auth.service"
import { registerAuthHandlers } from "./ipc/auth.ipc"
import { registerAllocationHandlers } from "./ipc/allocation.ipc"
import { registerMasterHandlers } from "./ipc/master.ipc"
import { registerReportHandlers } from "./ipc/report.ipc"
import { registerCycleHandlers } from "./ipc/cycle.ipc"

// Keep the data folder at %APPDATA%\eias regardless of the product name, so renaming
// the app (EIAS -> HIAS) never "loses" the existing eias.db on installed machines.
// An explicit --user-data-dir (used for testing against a throwaway folder) wins.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", join(app.getPath("appData"), "eias"))
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // Small enough to snap to half of a 1080p screen at 125% scaling (768px wide), and to
    // fit the ~672px of usable height on a 1080p laptop at 150%.
    minWidth: 760,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    title: "HIAS – Hall Invigilator Allocation System",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on("ready-to-show", () => {
    if (!mainWindow) return
    mainWindow.show()
    mainWindow.focus()
    // Windows foreground bypass: pulse always-on-top so it pops over Chrome
    mainWindow.setAlwaysOnTop(true)
    mainWindow.setAlwaysOnTop(false)
  })

  // Fallback: Ensure window shows even if ready-to-show is delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.setAlwaysOnTop(true)
      mainWindow.setAlwaysOnTop(false)
    }
  }, 1200)

  // No new windows inside the app; only ordinary web/mail links go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: "deny" }
  })

  // Exported PDFs/Excel files arrive as downloads: always ask where to save them,
  // starting in the user's Downloads folder with the report's file name.
  mainWindow.webContents.session.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Save report",
      defaultPath: join(app.getPath("downloads"), item.getFilename())
    })
  })

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(async () => {
  try {
    app.setAppUserModelId("in.edu.sxcce.eias")

    // Init DB and seed defaults
    await initDatabase({ appVersion: app.getVersion() })
    await ensureDefaultAdmin()

    // Register all IPC handlers
    registerAuthHandlers()
    registerAllocationHandlers()
    registerMasterHandlers()
    registerReportHandlers()
    registerCycleHandlers()

    createWindow()
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  } catch (err) {
    console.error("[HIAS Main Startup Error]:", err)
    // In the packaged app there is no console, so a failed start would otherwise
    // leave the user with no window and no explanation.
    dialog.showErrorBox("HIAS failed to start", String((err as Error)?.stack ?? err))
    app.quit()
  }
})

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })
