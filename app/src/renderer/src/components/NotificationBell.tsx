import { useState, useEffect, useRef } from "react"
import { Bell, Check, CheckCheck } from "lucide-react"
import { api } from "../lib/api"
import { useAuthStore } from "../store/auth.store"

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return ""
  try {
    const isoStr = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T") + (dateStr.endsWith("Z") ? "" : "Z")
    const past = new Date(isoStr).getTime()
    if (isNaN(past)) return dateStr
    const diff = Math.max(0, Date.now() - past)
    const secs = Math.floor(diff / 1000)
    const mins = Math.floor(secs / 60)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)
    if (secs < 60) return "Just now"
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(isoStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

export default function NotificationBell() {
  const { user } = useAuthStore()
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [notifications, setNotifications] = useState<any[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadUnreadCount = async () => {
    if (!user?.id) return
    try {
      const count = await api.getUnreadCount(user.id)
      setUnreadCount(count || 0)
    } catch {}
  }

  const loadNotifications = async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const list = await api.getNotifications(user.id)
      setNotifications(list || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUnreadCount()
  }, [user?.id])

  useEffect(() => {
    if (isOpen) {
      loadNotifications()
      loadUnreadCount()
    }
  }, [isOpen])

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  async function handleMarkRead(id: number) {
    try {
      await api.markNotificationRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n))
      setUnreadCount(c => Math.max(0, c - 1))
    } catch {}
  }

  async function handleMarkAllRead() {
    if (!user?.id) return
    try {
      await api.markAllRead(user.id)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
      setUnreadCount(0)
    } catch {}
  }

  if (!user || user.role !== "staff") return null

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-white/10 text-gray-300 hover:text-white transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-red-600 rounded-full min-w-[18px] h-[18px]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 overflow-hidden text-brand-textmain animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-brand-primary hover:text-brand-primary/80 font-medium flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {loading && notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">No notifications yet.</div>
            ) : (
              notifications.map((n: any) => (
                <div
                  key={n.id}
                  className={`p-3.5 transition-colors flex gap-3 items-start ${
                    !n.is_read ? "bg-blue-50/40 hover:bg-blue-50/70" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h4 className={`text-xs font-semibold truncate ${!n.is_read ? "text-blue-950 font-bold" : "text-gray-800"}`}>
                        {n.title}
                      </h4>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">
                        {formatRelativeTime(n.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed break-words">
                      {n.message}
                    </p>
                  </div>
                  {!n.is_read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      title="Mark as read"
                      className="p-1 rounded-md text-gray-400 hover:text-brand-primary hover:bg-gray-100 transition-colors flex-shrink-0"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
