import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { Toaster } from "react-hot-toast"
import { useAuthStore } from "./store/auth.store"
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

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* Admin routes */}
        <Route path="/" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="master" element={<MasterDataPage />} />
          <Route path="cycles" element={<ExamCyclesPage />} />
          <Route path="allocation/:cycleId/:sessionId?" element={<AllocationWorkspacePage />} />
          <Route path="history" element={<AllocationHistoryPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Staff routes */}
        <Route path="/staff" element={<RequireAuth><StaffLayout /></RequireAuth>}>
          <Route index element={<Navigate to="/staff/duty" replace />} />
          <Route path="duty" element={<StaffDutyPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
