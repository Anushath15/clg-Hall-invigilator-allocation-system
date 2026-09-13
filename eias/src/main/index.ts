import { app, BrowserWindow, shell, ipcMain } from "electron"
import { join } from "path"
// electron-toolkit inlined
import { initDatabase } from "./db/database"
import { ensureDefaultAdmin } from "./services/auth.service"
import { registerAuthHandlers } from "./ipc/auth.ipc"
import { registerAllocationHandlers } from "./ipc/allocation.ipc"
import { registerMasterHandlers } from "./ipc/master.ipc"
import { registerReportHandlers } from "./ipc/report.ipc"
import { registerCycleHandlers } from "./ipc/cycle.ipc"

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, '../../resources/icon.png'),
    title: "Exam Invigilator Allocation System — SXCCE",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on("ready-to-show", () => { mainWindow?.show() })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId("in.edu.sxcce.eias")
  

  // Init DB and seed defaults
  await initDatabase()
  await ensureDefaultAdmin()

  // Register all IPC handlers
  registerAuthHandlers()
  registerAllocationHandlers()
  registerMasterHandlers()
  registerReportHandlers()
  registerCycleHandlers()

  createWindow()
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })


