import { ipcMain } from "electron"
import { getStaffWiseReport, getDateWiseReport, getCompleteTimetable, getRotationAuditReport } from "../services/report.service"

export function registerReportHandlers() {
  ipcMain.handle("report:staffWise", async (_, userId, fromYear, toYear) => getStaffWiseReport(userId, fromYear, toYear))
  ipcMain.handle("report:dateWise", async (_, sessionId) => getDateWiseReport(sessionId))
  ipcMain.handle("report:timetable", async (_, cycleId) => getCompleteTimetable(cycleId))
  ipcMain.handle("report:audit", async (_, cycleId) => getRotationAuditReport(cycleId))
}
