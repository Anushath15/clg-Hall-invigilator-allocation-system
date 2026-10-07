import { ipcMain, dialog } from "electron"
import { app } from "electron"
import { getLocalAdmin } from "../services/auth.service"
import { backupDatabase, restoreDatabase } from "../services/backup.service"
import { restoreKeyboardFocus } from "../focus"

export function registerAuthHandlers() {
  // The only "auth" call: which local administrator the app runs as (no login, no passwords).
  ipcMain.handle("auth:getLocalAdmin", async () => getLocalAdmin())

  ipcMain.handle("dialog:openFile", async (_, filters) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: filters ?? [] })
    restoreKeyboardFocus()
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle("dialog:saveFile", async (_, filters, defaultName) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName ?? "hias-backup.db",
      filters: filters ?? [{ name: "Database", extensions: ["db"] }]
    })
    restoreKeyboardFocus()
    return result.canceled ? null : result.filePath
  })

  // Backup: copy eias.db to chosen destination
  ipcMain.handle("backup:database", async (_, destPath: string) => backupDatabase(destPath))

  // Restore: check the chosen file, keep a safety copy of the current data, replace eias.db
  ipcMain.handle("restore:database", async (_, srcPath: string) => {
    const result = await restoreDatabase(srcPath)
    // The open database lives in memory and is written back to disk after every
    // change, so any action before a manual restart would overwrite the restored
    // file. Restart right away (after the UI has shown its message) to load it.
    if (result.success) setTimeout(() => { app.relaunch(); app.exit(0) }, 1500)
    return result
  })
}