import React, { useState } from "react"
import { Lock, X, Loader2, AlertCircle } from "lucide-react"
import { api } from "../lib/api"
import { IS_DESKTOP } from "../lib/platform"
import { useAuthStore } from "../store/auth.store"

interface Props {
  isOpen: boolean
  title: string
  message: string
  confirmButtonText?: string
  /** Word the user must type to confirm in the desktop app (which has no passwords). */
  confirmWord?: string
  onClose: () => void
  onConfirmed: () => void | Promise<void>
}

// Web build: re-enter the admin password. Offline desktop app (no login): type a
// confirmation word instead, which still stops accidental destructive clicks.
export default function ConfirmWithPasswordModal({
  isOpen,
  title,
  message,
  confirmButtonText = "Confirm",
  confirmWord = "DELETE",
  onClose,
  onConfirmed
}: Props) {
  const { user } = useAuthStore()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  function handleCancel() {
    setPassword("")
    setError(null)
    onClose()
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    if (IS_DESKTOP) {
      if (password.trim().toUpperCase() !== confirmWord) {
        setError(`Please type ${confirmWord} to confirm.`)
        return
      }
    } else {
      if (!user) {
        setError("No active user session.")
        return
      }
      if (!password) {
        setError("Please enter your password.")
        return
      }
    }

    setLoading(true)
    setError(null)
    try {
      const isValid = IS_DESKTOP || await api.verifyPassword(user!.staff_id, password)
      if (!isValid) {
        setError("Incorrect password. Please try again.")
        setLoading(false)
        return
      }
      setPassword("")
      setError(null)
      await onConfirmed()
      onClose()
    } catch (err: any) {
      setError(err?.message || "Failed to verify password.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-border bg-gray-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <h2 className="text-base font-bold text-brand-textmain">{title}</h2>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-gray-200/60 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConfirm} className="p-6 space-y-4">
          <p className="text-sm text-brand-textsec">{message}</p>

          <div>
            <label className="label text-xs font-semibold text-brand-textmain mb-1.5 block">
              {IS_DESKTOP ? <>Type <span className="font-mono text-red-600">{confirmWord}</span> to confirm *</> : "Confirm with Password *"}
            </label>
            <input
              type={IS_DESKTOP ? "text" : "password"}
              value={password}
              onChange={e => {
                setPassword(e.target.value)
                if (error) setError(null)
              }}
              placeholder={IS_DESKTOP ? confirmWord : "Enter your current password"}
              className="input-field"
              autoFocus
              disabled={loading}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-medium">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-brand-border">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="btn-secondary text-xs px-3.5 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !password}
              className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmButtonText}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
