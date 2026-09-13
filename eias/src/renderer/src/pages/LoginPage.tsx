import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { GraduationCap, Eye, EyeOff, Loader2 } from "lucide-react"
import { api } from "../lib/api"
import { useAuthStore } from "../store/auth.store"
import toast from "react-hot-toast"
import { cn } from "../lib/utils"

export default function LoginPage() {
  const [staffId, setStaffId] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuthStore()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!staffId.trim() || !password) return toast.error("Please enter Staff ID and password.")
    setLoading(true)
    try {
      const result = await api.login(staffId.trim(), password)
      if (result.success) {
        login(result.user)
        toast.success(`Welcome, ${result.user.name}!`)
        navigate(result.user.role === "admin" ? "/dashboard" : "/staff/duty", { replace: true })
      } else {
        toast.error(result.error ?? "Login failed.")
      }
    } catch {
      toast.error("An unexpected error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-sidebar via-[#1a4d35] to-[#0f2d1f] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* College branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-primary mb-4 shadow-lg">
            <GraduationCap className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">EIAS</h1>
          <p className="text-brand-light text-sm mt-1 font-medium">Exam Invigilator Allocation System</p>
          <p className="text-gray-400 text-xs mt-1">St. Xavier&apos;s Catholic College of Engineering (Autonomous)</p>
          <p className="text-gray-500 text-xs">Nagercoil</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-brand-textmain mb-6">Sign in to your account</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="label">Staff ID</label>
              <input type="text" value={staffId} onChange={e => setStaffId(e.target.value)}
                className="input-field" placeholder="e.g. CSE001 or ADMIN001"
                autoFocus autoComplete="username" />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                  className="input-field pr-10" placeholder="Enter your password"
                  autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Default admin: ADMIN001 / admin123</p>
            </div>
            <button type="submit" disabled={loading}
              className={cn("btn-primary w-full justify-center flex items-center gap-2 py-2.5 mt-2")}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-500 text-xs mt-6">
          © {new Date().getFullYear()} SXCCE · Exam Invigilator Allocation System v1.0
        </p>
      </div>
    </div>
  )
}
