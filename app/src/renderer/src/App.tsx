import { useEffect, useState } from "react"
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom"
import { Toaster } from "react-hot-toast"
import { useAuthStore } from "./store/auth.store"
import { api } from "./lib/api"
import { IS_DESKTOP } from "./lib/platform"
import LoginPage from "./pages/LoginPage"
import AdminLayout from "./components/AdminLayout"
import DashboardPage from "./pages/DashboardPage"
import MasterDataPage from "./pages/MasterDataPage"
import ExamCyclesPage from "./pages/ExamCyclesPage"
import AllocationWorkspacePage from "./pages/AllocationWorkspacePage"
import AllocationHistoryPage from "./pages/AllocationHistoryPage"
import ReportsPage from "./pages/ReportsPage"
import SettingsPage from "./pages/SettingsPage"
import StaffDutyPage from "./pages/StaffDutyPage"
import StaffLayout from "./components/StaffLayout"

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== "admin") return <Navigate to="/staff/duty" replace />
  return <>{children}</>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

// The packaged desktop app loads index.html over file://, where BrowserRouter's
// history paths turn into file:///D:/login and match no route (blank window).
// Hash routing works there; the web build and dev server keep clean URLs.
const Router = window.location.protocol === "file:" ? HashRouter : BrowserRouter

// Offline desktop app: no login screen. Sign in as the local admin on every start
// (this also replaces any user left in storage from older versions that had login).
function useDesktopAutoLogin() {
  const login = useAuthStore(s => s.login)
  const [state, setState] = useState<"loading" | "ready" | string>(IS_DESKTOP ? "loading" : "ready")
  useEffect(() => {
    if (!IS_DESKTOP) return
    api.getLocalAdmin()
      .then((r: any) => {
        if (r?.success) { login(r.user); setState("ready") }
        else setState(r?.error ?? "Could not start the application.")
      })
      .catch((e: any) => setState(e?.message ?? "Could not start the application."))
  }, [login])
  return state
}

export default function App() {
  const session = useDesktopAutoLogin()
  if (session === "loading") return null
  if (session !== "ready") {
    return <div className="min-h-screen flex items-center justify-center p-8 text-red-600">{session}</div>
  }

  // Desktop: the local admin is always signed in, so no route checks authentication or
  // leads to a login screen, and the staff self-service pages (with their own logout)
  // exist only in the web build.
  const adminLayout = IS_DESKTOP ? <AdminLayout /> : <RequireAdmin><AdminLayout /></RequireAdmin>
  return (
    <Router>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <Routes>
        {/* Kept on desktop only so old links and shortcuts land on the dashboard. */}
        <Route path="/login" element={IS_DESKTOP ? <Navigate to="/dashboard" replace /> : <LoginPage />} />

        {/* Admin routes */}
        <Route path="/" element={adminLayout}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="master" element={<MasterDataPage />} />
          <Route path="cycles" element={<ExamCyclesPage />} />
          <Route path="allocation/:cycleId/:sessionId?" element={<AllocationWorkspacePage />} />
          <Route path="history" element={<AllocationHistoryPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Staff self-service (web build only) */}
        {!IS_DESKTOP && (
          <Route path="/staff" element={<RequireAuth><StaffLayout /></RequireAuth>}>
            <Route index element={<Navigate to="/staff/duty" replace />} />
            <Route path="duty" element={<StaffDutyPage />} />
          </Route>
        )}

        <Route path="*" element={<Navigate to={IS_DESKTOP ? "/dashboard" : "/login"} replace />} />
      </Routes>
    </Router>
  )
}
