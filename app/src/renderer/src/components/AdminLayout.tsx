import { useEffect, useState } from "react"
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom"
import {
  LayoutDashboard, Calendar, Building2, Users, ClipboardList,
  BarChart3, Settings, LogOut, History, ArrowLeft, PanelLeftClose, PanelLeftOpen, HardDrive
} from "lucide-react"
import HiasLogo from "./HiasLogo"
import { useAuthStore } from "../store/auth.store"
import { api } from "../lib/api"
import { IS_DESKTOP } from "../lib/platform"
import { cn } from "../lib/utils"
import toast from "react-hot-toast"

// Collapsed/expanded sidebar, remembered on this computer (localStorage survives restarts).
const SIDEBAR_KEY = "hias-sidebar-collapsed"
function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === "1" } catch { return false }
}

// Below 1024px the sidebar is icon-only automatically; the saved preference applies again when wider.
// The exact opposite of Tailwind's lg (min-width: 1024px): with display scaling the width can be
// fractional (1023.2px at 125%), which "(max-width: 1023px)" would miss.
const NARROW_QUERY = "not all and (min-width: 1024px)"
function useNarrowWindow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return narrow
}

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
  const [collapsed, setCollapsed] = useState(readCollapsed) // the saved preference
  const narrow = useNarrowWindow()
  // In a narrow window the toggle expands the sidebar just for now; that is never saved.
  const [expandedWhileNarrow, setExpandedWhileNarrow] = useState(false)
  useEffect(() => { setExpandedWhileNarrow(false) }, [narrow])
  const isCollapsed = narrow ? !expandedWhileNarrow : collapsed
  const toggleSidebar = () => narrow ? setExpandedWhileNarrow(e => !e) : setCollapsed(c => !c)

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0") } catch { /* not persisted; still works this session */ }
  }, [collapsed])

  // Icon-only when collapsed: labels move to hover tooltips, section titles become dividers.
  const linkClass = (active: boolean) => cn(active ? "sidebar-link-active" : "sidebar-link", isCollapsed && "justify-center px-0")
  const sectionTitle = (title: string) => isCollapsed
    ? <div className="mx-2 mb-3 h-px bg-white/10" />
    : <p className="text-xs font-semibold text-gray-400 mb-3 px-2 tracking-wider">{title}</p>

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
      <aside className={cn("bg-brand-sidebar text-white flex flex-col shadow-xl z-20 flex-shrink-0", isCollapsed ? "w-16" : "w-64")}>
        {/* Logo (hidden when collapsed) and collapse toggle */}
        <div className={cn("h-20 flex items-center border-b border-white/10", isCollapsed ? "justify-center" : "justify-between gap-2 px-6")}>
          {!isCollapsed && (
            <div className="flex items-center gap-3 min-w-0">
              <HiasLogo className="w-10 h-10 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-sm font-bold leading-tight tracking-wide">HIAS</h1>
                {collegeShortName && (
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{collegeShortName}</p>
                )}
              </div>
            </div>
          )}
          <button onClick={toggleSidebar}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors flex-shrink-0">
            {isCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>

        {/* Nav */}
        <div className={cn("flex-1 overflow-y-auto py-6 space-y-6", isCollapsed ? "px-2" : "px-4")}>
          <div>
            {sectionTitle("MAIN")}
            <nav className="space-y-1">
              {navItems.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} title={isCollapsed ? label : undefined}
                  className={({ isActive }) => linkClass(isActive)}>
                  <Icon className="w-5 h-5 flex-shrink-0" />{!isCollapsed && <span>{label}</span>}
                </NavLink>
              ))}
            </nav>
          </div>
          <div>
            {sectionTitle("MASTER DATA")}
            <nav className="space-y-1">
              {masterItems.map(({ to, tab, icon: Icon, label }) => {
                const isActive = location.pathname === "/master" && activeMasterTab === tab
                return (
                  <NavLink key={to} to={to} title={isCollapsed ? label : undefined}
                    className={linkClass(isActive)}>
                    <Icon className="w-5 h-5 flex-shrink-0" />{!isCollapsed && <span>{label}</span>}
                  </NavLink>
                )
              })}
            </nav>
          </div>
          <div>
            {sectionTitle("SYSTEM")}
            <nav className="space-y-1">
              <NavLink to="/settings" title={isCollapsed ? "Settings" : undefined}
                className={({ isActive }) => linkClass(isActive)}>
                <Settings className="w-5 h-5 flex-shrink-0" />{!isCollapsed && <span>Settings</span>}
              </NavLink>
            </nav>
          </div>
        </div>

        {/* Desktop footer: where the data lives (no accounts, no logout, no network) */}
        {IS_DESKTOP && (
          <div className={cn("py-4 border-t border-white/10", isCollapsed ? "px-2" : "px-4")}>
            <div title="Offline mode: all data is stored in the local database on this computer"
              className={cn("flex items-center gap-2 text-xs text-gray-400", isCollapsed ? "justify-center" : "px-2")}>
              <HardDrive className="w-4 h-4 flex-shrink-0 text-brand-light" />
              {!isCollapsed && <span>Offline · Local database</span>}
            </div>
          </div>
        )}

        {/* User footer: web build only (the offline desktop app has no accounts or logout) */}
        {!IS_DESKTOP && (
          <div className={cn("py-4 border-t border-white/10", isCollapsed ? "px-2" : "px-4")}>
            {!isCollapsed && (
              <div className="flex items-center gap-3 px-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-brand-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {user?.name?.charAt(0) ?? "A"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.staff_id} · Admin</p>
                </div>
              </div>
            )}
            <button onClick={handleLogout} title={isCollapsed ? "Logout" : undefined}
              className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-300 hover:bg-red-500/20 hover:text-red-300 transition-colors text-sm", isCollapsed && "justify-center px-0")}>
              <LogOut className="w-4 h-4" />{!isCollapsed && <span>Logout</span>}
            </button>
          </div>
        )}
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
