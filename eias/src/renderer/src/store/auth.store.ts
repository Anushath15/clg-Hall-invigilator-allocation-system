import { create } from "zustand"
import { persist } from "zustand/middleware"

interface AuthUser {
  id: number
  name: string
  staff_id: string
  role: "admin" | "staff"
  department_id?: number
}

interface AuthState {
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => void
  isAdmin: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      login: (user) => set({ user }),
      logout: () => set({ user: null }),
      isAdmin: () => get().user?.role === "admin"
    }),
    { name: "eias-auth" }
  )
)
