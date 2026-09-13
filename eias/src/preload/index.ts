import { contextBridge, ipcRenderer } from "electron"

const api = {
  // Auth
  login: (staffId: string, password: string) => ipcRenderer.invoke("auth:login", staffId, password),
  logout: () => ipcRenderer.invoke("auth:logout"),
  changePassword: (userId: number, oldPw: string, newPw: string) => ipcRenderer.invoke("auth:changePassword", userId, oldPw, newPw),

  // Master data
  getDepartments: () => ipcRenderer.invoke("master:getDepartments"),
  saveDepartment: (data: any) => ipcRenderer.invoke("master:saveDepartment", data),
  deleteDepartment: (id: number) => ipcRenderer.invoke("master:deleteDepartment", id),
  getUsers: (filters?: any) => ipcRenderer.invoke("master:getUsers", filters),
  saveUser: (data: any) => ipcRenderer.invoke("master:saveUser", data),
  deleteUser: (id: number) => ipcRenderer.invoke("master:deleteUser", id),
  importUsersFromExcel: (filePath: string) => ipcRenderer.invoke("master:importUsersFromExcel", filePath),
  getHalls: () => ipcRenderer.invoke("master:getHalls"),
  saveHall: (data: any) => ipcRenderer.invoke("master:saveHall", data),
  deleteHall: (id: number) => ipcRenderer.invoke("master:deleteHall", id),
  reorderHalls: (hallIds: number[]) => ipcRenderer.invoke("master:reorderHalls", hallIds),
  getSettings: () => ipcRenderer.invoke("master:getSettings"),
  saveSetting: (key: string, value: string) => ipcRenderer.invoke("master:saveSetting", key, value),

  // Exam cycles
  getCycles: () => ipcRenderer.invoke("cycle:getCycles"),
  createCycle: (data: any) => ipcRenderer.invoke("cycle:createCycle", data),
  updateCycle: (id: number, data: any) => ipcRenderer.invoke("cycle:updateCycle", id, data),
  getSessions: (cycleId: number) => ipcRenderer.invoke("cycle:getSessions", cycleId),
  createSessions: (cycleId: number, sessions: any[]) => ipcRenderer.invoke("cycle:createSessions", cycleId, sessions),
  updateSession: (id: number, data: any) => ipcRenderer.invoke("cycle:updateSession", id, data),

  // Allocation
  generateAllocation: (sessionId: number, userIds: number[], hallIds: number[]) =>
    ipcRenderer.invoke("allocation:generate", sessionId, userIds, hallIds),
  getSessionAllocation: (sessionId: number) => ipcRenderer.invoke("allocation:getSession", sessionId),
  editAllocation: (sessionId: number, userId: number, hallId: number, reason?: string) =>
    ipcRenderer.invoke("allocation:edit", sessionId, userId, hallId, reason),
  getValidHalls: (userId: number, sessionId: number) => ipcRenderer.invoke("allocation:getValidHalls", userId, sessionId),
  confirmAllocation: (sessionId: number) => ipcRenderer.invoke("allocation:confirm", sessionId),
  publishAllocation: (sessionId: number) => ipcRenderer.invoke("allocation:publish", sessionId),
  getStaffDutyHistory: (userId: number) => ipcRenderer.invoke("allocation:staffDutyHistory", userId),
  getAllocationHistory: (filters: any) => ipcRenderer.invoke("allocation:history", filters),

  // Reports
  getStaffWiseReport: (userId?: number, fromYear?: string, toYear?: string) =>
    ipcRenderer.invoke("report:staffWise", userId, fromYear, toYear),
  getDateWiseReport: (sessionId: number) => ipcRenderer.invoke("report:dateWise", sessionId),
  getCompleteTimetable: (cycleId: number) => ipcRenderer.invoke("report:timetable", cycleId),
  getAuditReport: (cycleId: number) => ipcRenderer.invoke("report:audit", cycleId),
  getDashboardStats: () => ipcRenderer.invoke("master:dashboardStats"),

  // File dialog
  openFileDialog: (filters?: any[]) => ipcRenderer.invoke("dialog:openFile", filters)
}

contextBridge.exposeInMainWorld("api", api)
export type ElectronAPI = typeof api
