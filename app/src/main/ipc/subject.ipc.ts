import { ipcMain } from "electron"
import { db } from "../db/database"
import { listSubjects, saveSubject, deleteSubject, importSubjects, getSubjectConflicts, setSubjectStudents, importStudentSubjects } from "../../shared/subjects"

// Subjects and the staff who handle them: the rules live in shared/subjects.ts (the web build calls the same functions).
export function registerSubjectHandlers() {
  ipcMain.handle("subject:list", async () => listSubjects(db))
  ipcMain.handle("subject:save", async (_, data) => saveSubject(db, data))
  ipcMain.handle("subject:delete", async (_, id) => deleteSubject(db, id))
  ipcMain.handle("subject:import", async (_, rows) => importSubjects(db, rows))
  ipcMain.handle("subject:conflicts", async (_, sessionId) => getSubjectConflicts(db, sessionId))
  ipcMain.handle("subject:set-students", async (_, subjectId, studentIds) => setSubjectStudents(db, subjectId, studentIds))
  ipcMain.handle("subject:import-students", async (_, rows) => importStudentSubjects(db, rows))
}
