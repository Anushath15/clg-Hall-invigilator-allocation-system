import { create } from "zustand"
import type { ExamCycle, ExamSession, Hall, Department, User } from "../types"

interface AppState {
  cycles: ExamCycle[]
  selectedCycle: ExamCycle | null
  selectedSession: ExamSession | null
  halls: Hall[]
  departments: Department[]
  users: User[]
  sidebarCollapsed: boolean
  setCycles: (c: ExamCycle[]) => void
  setSelectedCycle: (c: ExamCycle | null) => void
  setSelectedSession: (s: ExamSession | null) => void
  setHalls: (h: Hall[]) => void
  setDepartments: (d: Department[]) => void
  setUsers: (u: User[]) => void
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  cycles: [],
  selectedCycle: null,
  selectedSession: null,
  halls: [],
  departments: [],
  users: [],
  sidebarCollapsed: false,
  setCycles: (cycles) => set({ cycles }),
  setSelectedCycle: (selectedCycle) => set({ selectedCycle }),
  setSelectedSession: (selectedSession) => set({ selectedSession }),
  setHalls: (halls) => set({ halls }),
  setDepartments: (departments) => set({ departments }),
  setUsers: (users) => set({ users }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
}))
