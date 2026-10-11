import { ipcMain } from "electron"
import { db } from "../db/database"
import {
  listStudents, listStudentBatches, saveStudent, deleteStudent, importStudents,
  generateSeating, getSessionSeating, clearSeating, getSeatingSelections,
  getSeatingConfig, autoConfigureSeating, previewSeating, confirmSeating
} from "../../shared/students"

// Students and seating: the rules live in shared/students.ts (the web build calls the same functions).
export function registerStudentHandlers() {
  ipcMain.handle("student:list", async (_, filters) => listStudents(db, filters ?? {}))
  ipcMain.handle("student:batches", async () => listStudentBatches(db))
  ipcMain.handle("student:save", async (_, data) => saveStudent(db, data))
  ipcMain.handle("student:delete", async (_, id) => deleteStudent(db, id))
  ipcMain.handle("student:import", async (_, rows) => importStudents(db, rows))
  ipcMain.handle("seating:generate", async (_, sessionId, studentIds) => generateSeating(db, sessionId, studentIds))
  ipcMain.handle("seating:config", async (_, sessionId) => getSeatingConfig(db, sessionId))
  ipcMain.handle("seating:auto-config", async (_, sessionId, studentIds) => autoConfigureSeating(db, sessionId, studentIds))
  ipcMain.handle("seating:preview", async (_, sessionId, studentIds, config) => previewSeating(db, sessionId, studentIds, config))
  ipcMain.handle("seating:confirm", async (_, sessionId, studentIds, config, options) => confirmSeating(db, sessionId, studentIds, config, options ?? {}))
  ipcMain.handle("seating:get", async (_, sessionId) => getSessionSeating(db, sessionId))
  ipcMain.handle("seating:clear", async (_, sessionId) => clearSeating(db, sessionId))
  ipcMain.handle("seating:selections", async () => getSeatingSelections(db))
}
