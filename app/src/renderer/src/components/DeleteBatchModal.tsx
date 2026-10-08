import React, { useState } from "react"
import { Trash2, X, Loader2, AlertCircle } from "lucide-react"
import { validateBatchDeletion } from "../../../shared/validation"

interface Props {
  batch: { name: string; academic_year: string } | null
  /** Resolves to an error message, or null when the batch was deleted. */
  onDelete: (typedBatchName: string, personName: string, staffId: string) => Promise<string | null>
  onClose: () => void
}

/**
 * Deleting a whole batch needs the batch name typed as shown, plus the name and Staff ID of the
 * person deleting it; those go into the record of deleted batches.
 */
export default function DeleteBatchModal({ batch, onDelete, onClose }: Props) {
  const [typed, setTyped] = useState("")
  const [person, setPerson] = useState("")
  const [staffId, setStaffId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!batch) return null

  function close() { if (busy) return; setTyped(""); setPerson(""); setStaffId(""); setError(null); onClose() }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateBatchDeletion({ batchName: batch!.name, typedBatchName: typed, personName: person, staffId })
    if (problem) return setError(problem)
    setBusy(true); setError(null)
    try {
      const failed = await onDelete(typed.trim(), person.trim(), staffId.trim())
      if (failed) setError(failed)
      else { setTyped(""); setPerson(""); setStaffId(""); onClose() }
    } catch (err: any) {
      setError(err?.message || "The batch could not be deleted.")
    } finally { setBusy(false) }
  }

  const ready = typed.trim() && person.trim() && staffId.trim()
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, autoFocus = false) => (
    <div>
      <label className="label text-xs font-semibold text-brand-textmain mb-1.5 block">{label} *</label>
      <input className="input-field" value={value} placeholder={placeholder} autoFocus={autoFocus} disabled={busy}
        onChange={e => { set(e.target.value); if (error) setError(null) }} />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-gray-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center"><Trash2 className="w-4 h-4" /></div>
            <h2 className="text-base font-bold text-brand-textmain">Delete Allocation Batch</h2>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-200/60 text-gray-400 hover:text-gray-600 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <p className="text-sm text-brand-textsec">
            You are about to permanently delete <strong className="text-brand-textmain">"{batch.name}"</strong> ({batch.academic_year}). This removes every
            session and allocation of this batch, including published ones, and cannot be undone. The rotation history (which halls each person
            has already had) is kept, so later allocations still count the duties already done. A record of the deletion (batch, time and who
            deleted it) is also kept.
          </p>
          {field("Type the batch name to confirm", typed, setTyped, batch.name, true)}
          {field("Your name", person, setPerson, "Name of the person deleting")}
          {field("Your Staff ID", staffId, setStaffId, "e.g. STF001")}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" /><span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-brand-border">
            <button type="button" onClick={close} disabled={busy} className="btn-secondary text-xs px-3.5 py-2">Cancel</button>
            <button type="submit" disabled={busy || !ready}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 transition-colors">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Delete Batch
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
