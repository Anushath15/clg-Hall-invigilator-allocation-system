// Typed bridge to the Electron preload API
declare global {
  interface Window { api: any }
}

export const api = window.api as {
  // Auth
  login: (staffId: string, password: string) => Promise<any>
  logout: () => Promise<any>
  changePassword: (userId: number, oldPw: string, newPw: string) => Promise<any>
  // Departments
  getDepartments: () => Promise<any[]>
  saveDepartment: (data: any) => Promise<any>
  deleteDepartment: (id: number) => Promise<any>
  // Users
  getUsers: (filters?: any) => Promise<any[]>
  saveUser: (data: any) => Promise<any>
  deleteUser: (id: number) => Promise<any>
  importUsersFromExcel: (filePath: string) => Promise<any>
  // Halls
  getHalls: () => Promise<any[]>
  saveHall: (data: any) => Promise<any>
  deleteHall: (id: number) => Promise<any>
  reorderHalls: (hallIds: number[]) => Promise<any>
  // Settings
  getSettings: () => Promise<Record<string, string>>
  saveSetting: (key: string, value: string) => Promise<any>
  // Cycles & Sessions
  getCycles: () => Promise<any[]>
  createCycle: (data: any) => Promise<any>
  updateCycle: (id: number, data: any) => Promise<any>
  getSessions: (cycleId: number) => Promise<any[]>
  createSessions: (cycleId: number, sessions: any[]) => Promise<any[]>
  updateSession: (id: number, data: any) => Promise<any>
  // Allocation
  generateAllocation: (sessionId: number, userIds: number[], hallIds: number[]) => Promise<any>
  getSessionAllocation: (sessionId: number) => Promise<any[]>
  editAllocation: (sessionId: number, userId: number, hallId: number, reason?: string) => Promise<any>
  getValidHalls: (userId: number, sessionId: number) => Promise<any[]>
  confirmAllocation: (sessionId: number) => Promise<any>
  publishAllocation: (sessionId: number) => Promise<any>
  getStaffDutyHistory: (userId: number) => Promise<any[]>
  getAllocationHistory: (filters: any) => Promise<any[]>
  // Reports
  getStaffWiseReport: (userId?: number, fromYear?: string, toYear?: string) => Promise<any[]>
  getDateWiseReport: (sessionId: number) => Promise<any[]>
  getCompleteTimetable: (cycleId: number) => Promise<any>
  getAuditReport: (cycleId: number) => Promise<any[]>
  // Dashboard
  getDashboardStats: () => Promise<any>
  // File dialogs
  openFileDialog: (filters?: any[]) => Promise<string | null>
  openSaveDialog: (filters?: any[], defaultName?: string) => Promise<string | null>
  // Backup & Restore
  backupDatabase: (destPath: string) => Promise<{ success: boolean; error?: string }>
  restoreDatabase: (srcPath: string) => Promise<{ success: boolean; error?: string }>
}