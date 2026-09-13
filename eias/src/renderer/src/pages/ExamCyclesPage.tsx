import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, ChevronRight, Calendar, Loader2 } from "lucide-react"
import { api } from "../lib/api"
import { formatDate, getStatusColor } from "../lib/utils"
import toast from "react-hot-toast"
import CreateCycleWizard from "../components/CreateCycleWizard"

export default function ExamCyclesPage() {
  const [cycles, setCycles] = useState<any[]>([])
  const [showWizard, setShowWizard] = useState(false)
  const navigate = useNavigate()

  const load = () => api.getCycles().then(setCycles)
  useEffect(() => { load() }, [])

  function handleCycleClick(cycle: any) {
    navigate(`/allocation/${cycle.id}`)
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-brand-textmain">Exam Cycles</h1>
          <p className="text-brand-textsec mt-1">Create and manage exam allocation cycles</p>
        </div>
        <button onClick={() => setShowWizard(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> Create Exam Allocation
        </button>
      </div>

      {showWizard && (
        <CreateCycleWizard
          onClose={() => setShowWizard(false)}
          onCreated={(cycle) => { setShowWizard(false); load(); navigate(`/allocation/${cycle.id}`) }}
        />
      )}

      <div className="space-y-3">
        {cycles.length === 0 && (
          <div className="card text-center py-16 text-brand-textsec">
            <Calendar className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="font-medium text-base">No exam cycles created yet</p>
            <p className="text-sm mt-1">Click "Create Exam Allocation" to begin.</p>
          </div>
        )}
        {cycles.map((c) => (
          <div key={c.id} onClick={() => handleCycleClick(c)}
            className="card flex items-center justify-between cursor-pointer hover:border-brand-primary hover:shadow-md transition-all group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-brand-verylight flex items-center justify-center">
                <Calendar className="w-5 h-5 text-brand-primary" />
              </div>
              <div>
                <p className="font-semibold text-brand-textmain">{c.name}</p>
                <p className="text-sm text-brand-textsec">{c.academic_year} · Created {formatDate(c.created_at)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={getStatusColor(c.status)}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-primary transition-colors" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
