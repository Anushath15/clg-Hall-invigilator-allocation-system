import { useEffect, useState } from "react"
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import {
  LayoutDashboard, Calendar, Building2, Users, ClipboardList,
  BarChart3, Settings, LogOut, History, ArrowLeft
} from "lucide-react"
import HiasLogo from "./HiasLogo"
import { useAuthStore } from "../store/auth.store"
import { api } from "../lib/api"
import { IS_DESKTOP } from "../lib/platform"
import toast from "react-hot-toast"

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/cycles", icon: Calendar, label: "Allocation Batches" },
  { to: "/history", icon: History, label: "Allocation History" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
]

const masterItems = [
  { to: "/master?tab=staff", tab: "staff", icon: Users, label: "Staff / Invigilators" },
  { to: "/master?tab=halls", tab: "halls", icon: Building2, label: "Halls" },
  { to: "/master?tab=departments", tab: "departments", icon: ClipboardList, label: "Departments" },
]

export default function AdminLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const activeMasterTab = new URLSearchParams(location.search).get("tab") ?? "staff"
  const [collegeShortName, setCollegeShortName] = useState("")

  // Sidebar subtitle = Settings → College Profile → Short Name; refreshed when saved.
  useEffect(() => {
    const load = () => api.getSettings()
      .then((s: any) => setCollegeShortName(s?.["college.short_name"] ?? ""))
      .catch(() => {})
    load()
    window.addEventListener("hias:settings-changed", load)
    return () => window.removeEventListener("hias:settings-changed", load)
  }, [])

  async function handleLogout() {
    await api.logout()
    logout()
    navigate("/login")
    toast.success("Logged out successfully")
  }

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 font-sans antialiased">
      {/* SIDEBAR */}
      <aside className="w-64 bg-brand-sidebar text-white flex flex-col shadow-xl z-20 flex-shrink-0">
        {/* Logo */}
        <div className="h-20 flex items-center px-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <HiasLogo className="w-10 h-10" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold leading-tight tracking-wide">HIAS</h1>
              {collegeShortName && (
                <p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{collegeShortName}</p>
              )}
            </div>
          </div>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-3 px-2 tracking-wider">MAIN</p>
            <nav className="space-y-1">
              {navItems.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => isActive ? "sidebar-link-active" : "sidebar-link"}>
                  <Icon className="w-5 h-5 flex-shrink-0" /><span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-3 px-2 tracking-wider">MASTER DATA</p>
            <nav className="space-y-1">
              {masterItems.map(({ to, tab, icon: Icon, label }) => {
                const isActive = location.pathname === "/master" && activeMasterTab === tab
                return (
                  <NavLink key={to} to={to}
                    className={isActive ? "sidebar-link-active" : "sidebar-link"}>
                    <Icon className="w-5 h-5 flex-shrink-0" /><span>{label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-3 px-2 tracking-wider">SYSTEM</p>
            <nav className="space-y-1">
              <NavLink to="/settings"
                className={({ isActive }) => isActive ? "sidebar-link-active" : "sidebar-link"}>
                <Settings className="w-5 h-5 flex-shrink-0" /><span>Settings</span>
              </NavLink>
            </nav>
          </div>
        </div>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className={`flex items-center gap-3 px-2 ${IS_DESKTOP ? "" : "mb-3"}`}>
            <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.name?.charAt(0) ?? "A"}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 truncate">{user?.staff_id} · Admin</p>
            </div>
          </div>
          {!IS_DESKTOP && (
            <button onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:bg-red-500/20 hover:text-red-300 transition-colors text-sm">
              <LogOut className="w-4 h-4" /><span>Logout</span>
            </button>
          )}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto">
        {location.pathname !== "/dashboard" && (
          <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm px-8 pt-5">
            <button
              onClick={() => navigate(-1)}
              title="Go back"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-textsec hover:text-brand-primary transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
