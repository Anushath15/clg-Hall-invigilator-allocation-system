import { useState, useEffect, useRef } from "react"
import { Bell, Check, CheckCheck, X } from "lucide-react"
import { api } from "../lib/api"
import { formatDate } from "../lib/utils"

interface NotificationItem {
  id: number
  user_id: number
  title: string
  message: string
  session_id: number | null
  is_read: number
  created_at: string
  exam_date?: string
  session_type?: string
  hall_code?: string
}

export default function NotificationBell({ userId }: { userId: number }) {
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const loadNotifications = async () => {
    try {
      const count = await api.getUnreadNotificationCount(userId)
      setUnreadCount(count)
      const list = await api.getNotifications(userId)
      setNotifications(list)
    } catch (err) {
      console.error("[NotificationBell] Failed to load notifications:", err)
    }
  }

  useEffect(() => {
    if (userId) {
      loadNotifications()
      // Refresh notifications every 30 seconds
      const interval = setInterval(loadNotifications, 30000)
      return () => clearInterval(interval)
    }
  }, [userId])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleMarkRead = async (id: number) => {
    try {
      await api.markNotificationRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (e) {
      console.error("Failed to mark read:", e)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      await api.markAllNotificationsRead(userId)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
      setUnreadCount(0)
    } catch (e) {
      console.error("Failed to mark all read:", e)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) loadNotifications()
        }}
        className="relative p-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none"
        title="Notifications"
        aria-label="View notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full animate-pulse shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-100 z-50 text-gray-800 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-brand-primary" />
              <h3 className="text-sm font-semibold text-gray-800">Duty Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-xs bg-brand-primary/10 text-brand-primary font-medium px-2 py-0.5 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-brand-primary hover:underline flex items-center gap-1 font-medium"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-gray-400">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs mt-0.5">Published exam duties will appear here.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-3.5 transition-colors hover:bg-gray-50 ${
                    n.is_read ? "opacity-75" : "bg-blue-50/40 border-l-4 border-l-brand-primary"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                        {!n.is_read && (
                          <span className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />
                        )}
                        {n.title}
                      </p>
                      <p className="text-xs text-gray-700 mt-1 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-1.5">
                        {n.created_at ? new Date(n.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }) : ""}
                      </p>
                    </div>
                    {!n.is_read && (
                      <button
                        onClick={() => handleMarkRead(n.id)}
                        className="p-1 text-gray-400 hover:text-brand-primary hover:bg-gray-100 rounded transition-colors"
                        title="Mark as read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
