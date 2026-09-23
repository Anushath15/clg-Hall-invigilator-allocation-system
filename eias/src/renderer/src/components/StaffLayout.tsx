import { Outlet, useNavigate } from "react-router-dom"
import { LogOut, GraduationCap } from "lucide-react"
import { useAuthStore } from "../store/auth.store"
import { api } from "../lib/api"
import toast from "react-hot-toast"
import NotificationBell from "./NotificationBell"

export default function StaffLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  async function handleLogout() {
    await api.logout(); logout(); navigate("/login"); toast.success("Logged out")
  }
  return (
    <div className="min-h-screen bg-brand-verylight">
      <header className="bg-brand-sidebar text-white px-6 py-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-primary flex items-center justify-center">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold">Exam Invigilator Allocation System</h1>
            <p className="text-xs text-gray-400">St. Xavier&apos;s Catholic College of Engineering, Nagercoil</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {user?.id && <NotificationBell userId={user.id} />}
          <div className="text-right">
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-gray-400">{user?.staff_id}</p>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-300 transition-colors text-sm text-gray-300">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
