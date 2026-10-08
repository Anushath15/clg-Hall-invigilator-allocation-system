import { contextBridge, ipcRenderer } from "electron"

const api = {
  // No login in the desktop app: it always runs as the local administrator.
  getLocalAdmin:   () => ipcRenderer.invoke("auth:getLocalAdmin"),
  // Departments
  getDepartments:  () => ipcRenderer.invoke("master:getDepartments"),
  saveDepartment:  (data: any) => ipcRenderer.invoke("master:saveDepartment", data),
  deleteDepartment:(id: number) => ipcRenderer.invoke("master:deleteDepartment", id),
  // Users
  getUsers:        (filters?: any) => ipcRenderer.invoke("master:getUsers", filters),
  saveUser:        (data: any) => ipcRenderer.invoke("master:saveUser", data),
  deleteUser:      (id: number) => ipcRenderer.invoke("master:deleteUser", id),
  hardDeleteUser:  (id: number) => ipcRenderer.invoke("master:hardDeleteUser", id),
  importUsersFromExcel: (filePath: string) => ipcRenderer.invoke("master:importUsersFromExcel", filePath),
  // Halls
  getHalls:        () => ipcRenderer.invoke("master:getHalls"),
  saveHall:        (data: any) => ipcRenderer.invoke("master:saveHall", data),
  deleteHall:      (id: number) => ipcRenderer.invoke("master:deleteHall", id),
  // Settings
  getSettings:     () => ipcRenderer.invoke("master:getSettings"),
  saveSetting:     (key: string, value: string) => ipcRenderer.invoke("master:saveSetting", key, value),
  getDashboardStats: () => ipcRenderer.invoke("master:dashboardStats"),
  // Cycles
  getCycles:       () => ipcRenderer.invoke("cycle:getCycles"),
  createCycle:     (data: any) => ipcRenderer.invoke("cycle:createCycle", data),
  updateCycle:     (id: number, data: any) => ipcRenderer.invoke("cycle:updateCycle", id, data),
  getSessions:     (cycleId: number) => ipcRenderer.invoke("cycle:getSessions", cycleId),
  createSessions:  (cycleId: number, sessions: any[]) => ipcRenderer.invoke("cycle:createSessions", cycleId, sessions),
  updateSession:   (id: number, data: any) => ipcRenderer.invoke("cycle:updateSession", id, data),
  addSession:      (cycleId: number, data: any) => ipcRenderer.invoke("cycle:addSession", cycleId, data),
  deleteSession:   (id: number) => ipcRenderer.invoke("cycle:deleteSession", id),
  deleteCycle:     (id: number, confirm?: { typedBatchName: string; personName: string; staffId: string }) => ipcRenderer.invoke("cycle:deleteCycle", id, confirm),
  getDeletedBatches: () => ipcRenderer.invoke("cycle:getDeletedBatches"),
  // Allocation
  generateAllocation:   (sessionId: number, userIds: number[], hallIds: number[]) => ipcRenderer.invoke("allocation:generate", sessionId, userIds, hallIds),
  getSessionAllocation: (sessionId: number) => ipcRenderer.invoke("allocation:getSession", sessionId),
  editAllocation:       (sessionId: number, userId: number, hallId: number, reason?: string) => ipcRenderer.invoke("allocation:edit", sessionId, userId, hallId, reason),
  getValidHalls:        (userId: number, sessionId: number) => ipcRenderer.invoke("allocation:getValidHalls", userId, sessionId),
  getSessionSelections: () => ipcRenderer.invoke("allocation:sessionSelections"),
  confirmAllocation:    (sessionId: number) => ipcRenderer.invoke("allocation:confirm", sessionId),
  publishAllocation:    (sessionId: number) => ipcRenderer.invoke("allocation:publish", sessionId),
  getStaffDutyHistory:  (userId: number) => ipcRenderer.invoke("allocation:staffDutyHistory", userId),
  getAllocationHistory:  (filters: any) => ipcRenderer.invoke("allocation:history", filters),
  restartRotation:      () => ipcRenderer.invoke("allocation:restartRotation"),
  getNotifications:     (userId: number) => ipcRenderer.invoke("allocation:getNotifications", userId),
  getUnreadCount:       (userId: number) => ipcRenderer.invoke("allocation:getUnreadCount", userId),
  markNotificationRead: (id: number) => ipcRenderer.invoke("allocation:markNotificationRead", id),
  markAllRead:          (userId: number) => ipcRenderer.invoke("allocation:markAllRead", userId),
  // Reports
  getStaffWiseReport:   (userId?: number, fromYear?: string, toYear?: string) => ipcRenderer.invoke("report:staffWise", userId, fromYear, toYear),
  getDateWiseReport:    (sessionId: number) => ipcRenderer.invoke("report:dateWise", sessionId),
  getCompleteTimetable: (cycleId: number) => ipcRenderer.invoke("report:timetable", cycleId),
  getAuditReport:       (cycleId: number) => ipcRenderer.invoke("report:audit", cycleId),
  // After a native pop-up (confirm / alert): give the page its keyboard focus back
  refocusWindow:   () => ipcRenderer.invoke("app:refocus"),
  // File dialogs
  openFileDialog:(filters?: any[]) => ipcRenderer.invoke("dialog:openFile", filters),
  openSaveDialog:  (filters?: any[], defaultName?: string) => ipcRenderer.invoke("dialog:saveFile", filters, defaultName),
  // Backup & Restore
  backupDatabase:  (destPath: string) => ipcRenderer.invoke("backup:database", destPath),
  restoreDatabase: (srcPath: string) => ipcRenderer.invoke("restore:database", srcPath),
}

contextBridge.exposeInMainWorld("api", api)