import { useEffect, useState } from "react"
import { AlertTriangle, Trash2 } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { formatDate, getStatusColor } from "../lib/utils"
import ConfirmWithPasswordModal from "./ConfirmWithPasswordModal"

/**
 * Settings → Delete Batch. Deleting a whole allocation batch lives here, away from the batch
 * list where one wrong click could remove a year's allocations. It still needs the typed
 * DELETE confirmation (the password in the web build).
 */
export default function DeleteBatchesPanel() {
  const [cycles, setCycles] = useState<any[]>([])
  const [target, setTarget] = useState<any>(null)
  const load = () => api.getCycles().then(setCycles)
  useEffect(() => { load() }, [])

  return (
    <div className="card border border-red-200 bg-red-50/40">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-red-900 text-base">Delete Batch</h3>
          <p className="text-sm text-red-700 mt-1 leading-relaxed">
            Permanently delete an allocation batch with all its sessions, allocations and rotation records, including confirmed ones.
          </p>
          <div className="mt-3 p-3 bg-red-100/70 rounded-lg border border-red-200 text-xs text-red-800">
            <strong>Warning:</strong> This cannot be undone. You will be asked to type <strong>DELETE</strong> before anything is removed. Back up first (Backup &amp; Restore) if you may need the data again.
          </div>

          <div className="mt-4 space-y-2">
            {cycles.length === 0 && <p className="text-sm text-red-700">There are no allocation batches.</p>}
            {cycles.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 bg-white border border-red-100 rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-textmain truncate">{c.name}</p>
                  <p className="text-xs text-brand-textsec">{c.academic_year} · Created {formatDate(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={getStatusColor(c.status)}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
                  <button onClick={() => setTarget(c)} title={`Delete ${c.name}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors">
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ConfirmWithPasswordModal
        isOpen={!!target}
        title="Delete Allocation Batch"
        message={`Are you sure you want to permanently delete "${target?.name}" (${target?.academic_year})? This removes every session, allocation, and rotation record tied to this batch — including published ones. This cannot be undone.`}
        confirmButtonText="Delete Batch"
        onClose={() => setTarget(null)}
        onConfirmed={async () => {
          if (!target) return
          const res = await api.deleteCycle(target.id)
          if (res?.success) {
            toast.success(`"${target.name}" deleted`)
            load()
          } else {
            toast.error(res?.error || "Cannot delete this allocation batch.")
          }
        }}
      />
    </div>
  )
}
