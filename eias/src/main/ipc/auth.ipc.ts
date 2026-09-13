import { ipcMain, dialog } from "electron"
import path from "path"
import fs from "fs"
import { app } from "electron"
import { login, changePassword } from "../services/auth.service"

function getDbPath(): string {
  const base = app.isPackaged ? app.getPath("userData") : process.cwd()
  return path.join(base, "eias.db")
}

export function registerAuthHandlers() {
  ipcMain.handle("auth:login", async (_, staffId, password) => login(staffId, password))
  ipcMain.handle("auth:logout", async () => ({ success: true }))
  ipcMain.handle("auth:changePassword", async (_, userId, oldPw, newPw) => changePassword(userId, oldPw, newPw))

  ipcMain.handle("dialog:openFile", async (_, filters) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: filters ?? [] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle("dialog:saveFile", async (_, filters, defaultName) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName ?? "eias-backup.db",
      filters: filters ?? [{ name: "Database", extensions: ["db"] }]
    })
    return result.canceled ? null : result.filePath
  })

  // Backup: copy eias.db to chosen destination
  ipcMain.handle("backup:database", async (_, destPath: string) => {
    try {
      const src = getDbPath()
      if (!fs.existsSync(src)) return { success: false, error: "Database file not found." }
      fs.copyFileSync(src, destPath)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // Restore: replace eias.db from chosen file
  ipcMain.handle("restore:database", async (_, srcPath: string) => {
    try {
      if (!fs.existsSync(srcPath)) return { success: false, error: "Backup file not found." }
      const dest = getDbPath()
      // Make a safety copy first
      if (fs.existsSync(dest)) fs.copyFileSync(dest, dest + ".bak")
      fs.copyFileSync(srcPath, dest)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })
}