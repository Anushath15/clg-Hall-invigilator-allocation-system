import { useEffect, useState } from "react"
import { AlertTriangle, Trash2 } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "../lib/api"
import { formatDate, getStatusColor } from "../lib/utils"
import DeleteBatchModal from "./DeleteBatchModal"

/**
 * Settings → Delete Batch. Deleting a whole allocation batch lives here, away from the batch
 * list where one wrong click could remove a year's allocations. It needs the
 * batch name typed again plus the name and Staff ID of the person deleting it; those are kept with
 * the batch's details in the record of deleted batches shown below the list.
 */
export default function DeleteBatchesPanel() {
  const [cycles, setCycles] = useState<any[]>([])
  const [target, setTarget] = useState<any>(null)
  const [deleted, setDeleted] = useState<any[]>([])
  const load = () => { api.getCycles().then(setCycles); api.getDeletedBatches().then(setDeleted).catch(() => setDeleted([])) }
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
            Permanently delete an allocation batch with all its sessions and allocations, including confirmed ones. The rotation history stays, so later allocations still count the duties already done.
          </p>
          <div className="mt-3 p-3 bg-red-100/70 rounded-lg border border-red-200 text-xs text-red-800">
            <strong>Warning:</strong> This cannot be undone. You will be asked to type the batch name and enter your name and Staff ID before anything is removed; these are kept in the record of deleted batches. Back up first (Backup &amp; Restore) if you may need the data again.
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

          <h4 className="mt-6 text-sm font-semibold text-red-900">Deleted batches</h4>
          {deleted.length === 0
            ? <p className="mt-1 text-xs text-red-700">No batch has been deleted yet.</p>
            : (
              <div className="mt-2 overflow-x-auto bg-white border border-red-100 rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-red-50 text-red-900">
                    <tr><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Year</th><th className="px-3 py-2">Sessions</th><th className="px-3 py-2">Deleted on</th><th className="px-3 py-2">Deleted by</th></tr>
                  </thead>
                  <tbody>
                    {deleted.map(d => (
                      <tr key={d.id} className="border-t border-red-50 text-brand-textmain">
                        <td className="px-3 py-2 font-medium">{d.batch_name}</td>
                        <td className="px-3 py-2">{d.academic_year}</td>
                        <td className="px-3 py-2">{d.session_count} ({d.confirmed_session_count} confirmed)</td>
                        <td className="px-3 py-2 whitespace-nowrap">{new Date(d.deleted_at).toLocaleString()}</td>
                        <td className="px-3 py-2">{d.deleted_by_name} · {d.deleted_by_staff_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>

      <DeleteBatchModal
        batch={target}
        onClose={() => setTarget(null)}
        onDelete={async (typedBatchName, personName, staffId) => {
          const res = await api.deleteCycle(target.id, { typedBatchName, personName, staffId })
          if (!res?.success) return res?.error || "Cannot delete this allocation batch."
          toast.success(`"${target.name}" deleted`)
          load()
          return null
        }}
      />
    </div>
  )
}
