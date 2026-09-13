import { ipcMain, dialog } from "electron"
import { login, changePassword } from "../services/auth.service"

export function registerAuthHandlers() {
  ipcMain.handle("auth:login", async (_, staffId, password) => login(staffId, password))
  ipcMain.handle("auth:logout", async () => ({ success: true }))
  ipcMain.handle("auth:changePassword", async (_, userId, oldPw, newPw) => changePassword(userId, oldPw, newPw))
  ipcMain.handle("dialog:openFile", async (_, filters) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile"], filters: filters ?? [] })
    return result.canceled ? null : result.filePaths[0]
  })
}
