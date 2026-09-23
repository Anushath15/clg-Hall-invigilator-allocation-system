import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Users, Building2, Calendar, CheckCircle, Clock, Plus, ArrowRight, Activity } from "lucide-react"
import { api } from "../lib/api"
import { formatDate } from "../lib/utils"
import { useAuthStore } from "../store/auth.store"

interface Stats {
  totalStaff: number
  totalHalls: number
  totalCycles: number
  confirmedSessions: number
  upcomingSessions: number
  allocatedHalls: number
  totalExamDays: number
}

function StatCard({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="card flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-brand-textmain">{value}</p>
        <p className="text-sm text-brand-textsec">{label}</p>
        {sub && <p className="text-xs text-brand-textsec mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [cycles, setCycles] = useState<any[]>([])
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const navigate = useNavigate()
  const { user } = useAuthStore()

  useEffect(() => {
    api.getDashboardStats().then(setStats)
    api.getCycles().then(c => {
      setCycles(c)
      // Build activity feed from recent cycles and sessions
      buildActivityFeed(c)
    })
  }, [])

  async function buildActivityFeed(cycles: any[]) {
    const activities: any[] = []
    for (const c of cycles.slice(0, 3)) {
      const sessions = await api.getSessions(c.id)
      for (const s of sessions.slice(0, 5)) {
        if (s.status === "published") {
          activities.push({ type: "published", label: `Allocation published`, sub: `${c.name} · ${formatDate(s.exam_date)} ${s.session_type}`, color: "text-green-600 bg-green-50", date: s.updated_at ?? s.created_at })
        } else if (s.status === "confirmed") {
          activities.push({ type: "confirmed", label: `Allocation confirmed`, sub: `${c.name} · ${formatDate(s.exam_date)} ${s.session_type}`, color: "text-blue-600 bg-blue-50", date: s.updated_at ?? s.created_at })
        } else if (s.status === "draft") {
          activities.push({ type: "draft", label: `Draft allocation created`, sub: `${c.name} · ${formatDate(s.exam_date)} ${s.session_type}`, color: "text-yellow-600 bg-yellow-50", date: s.updated_at ?? s.created_at })
        }
      }
    }
    activities.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    setRecentActivity(activities.slice(0, 8))
  }

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-textmain">Dashboard</h1>
          <p className="text-brand-textsec mt-1">
            Welcome back, <span className="font-medium text-brand-primary">{user?.name}</span> · {today}
          </p>
          <p className="text-brand-textsec text-sm mt-0.5">
            St. Xavier's Catholic College of Engineering (Autonomous), Nagercoil
          </p>
        </div>
        <button onClick={() => navigate("/cycles")} className="btn-primary flex items-center gap-2 shadow-sm">
          <Plus className="w-4 h-4" /> Create Exam Allocation
        </button>
      </div>

      {/* Stats grid — 5 cards as per approved spec */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <StatCard icon={Users}       label="Total Invigilators" value={stats?.totalStaff ?? 0}       color="bg-blue-50 text-blue-600" />
        <StatCard icon={Calendar}    label="Total Exam Days"     value={stats?.totalExamDays ?? 0}    color="bg-green-50 text-green-600" />
        <StatCard icon={Building2}   label="Total Halls"         value={stats?.totalHalls ?? 0}       color="bg-purple-50 text-purple-600" />
        <StatCard icon={CheckCircle} label="Allocated Halls"     value={stats?.allocatedHalls ?? 0}   color="bg-teal-50 text-teal-600" sub="Confirmed sessions" />
        <StatCard icon={Clock}       label="Upcoming Exams"      value={stats?.upcomingSessions ?? 0} color="bg-yellow-50 text-yellow-600" sub="Pending sessions" />
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Recent cycles */}
        <div className="col-span-3 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-brand-textmain">Recent Exam Cycles</h2>
            <button onClick={() => navigate("/cycles")} className="text-xs text-brand-primary flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {cycles.length === 0 ? (
            <div className="text-center py-10 text-brand-textsec">
              <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No exam cycles yet</p>
              <p className="text-xs mt-1">Create your first allocation to begin.</p>
              <button onClick={() => navigate("/cycles")} className="btn-primary mt-4 text-xs">+ Create</button>
            </div>
          ) : (
            <div className="space-y-2">
              {cycles.slice(0, 5).map((c: any) => (
                <div key={c.id} onClick={() => navigate(`/allocation/${c.id}`)}
                  className="flex items-center justify-between p-3 rounded-lg border border-transparent hover:border-brand-primary hover:bg-brand-verylight cursor-pointer transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-verylight flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-4 h-4 text-brand-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-brand-textmain">{c.name}</p>
                      <p className="text-xs text-brand-textsec">{c.academic_year}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`status-badge-${c.status}`}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-brand-primary transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div className="col-span-2 card">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-brand-primary" />
            <h2 className="text-sm font-semibold text-brand-textmain">Recent Activity</h2>
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-brand-textsec">
              <Activity className="w-7 h-7 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No activity yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentActivity.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${a.color}`}>
                    {a.type === "published" ? "P" : a.type === "confirmed" ? "C" : "D"}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-brand-textmain">{a.label}</p>
                    <p className="text-[11px] text-brand-textsec mt-0.5">{a.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid grid-cols-4 gap-3">
        {[
          { label: "Add Staff", icon: Users, to: "/master?tab=staff", color: "text-blue-600 bg-blue-50 hover:bg-blue-100" },
          { label: "Add Hall", icon: Building2, to: "/master?tab=halls", color: "text-purple-600 bg-purple-50 hover:bg-purple-100" },
          { label: "View History", icon: Clock, to: "/history", color: "text-orange-600 bg-orange-50 hover:bg-orange-100" },
          { label: "Reports", icon: CheckCircle, to: "/reports", color: "text-green-600 bg-green-50 hover:bg-green-100" }
        ].map(({ label, icon: Icon, to, color }) => (
          <button key={label} onClick={() => navigate(to)}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-colors ${color}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
    </div>
  )
}
