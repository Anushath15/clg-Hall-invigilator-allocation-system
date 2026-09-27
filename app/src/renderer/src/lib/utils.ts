import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string): string {
  try { return format(parseISO(date), "dd MMM yyyy") } catch { return date }
}

export function formatDateWithDay(date: string): string {
  try { return format(parseISO(date), "EEE, dd MMM yyyy") } catch { return date }
}

export function formatFullDate(date: string): string {
  try { return format(parseISO(date), "EEEE, dd MMMM yyyy") } catch { return date }
}

export function formatTime12h(time24: string): string {
  if (!time24) return ""
  const parts = time24.split(":")
  if (parts.length < 2) return time24
  let hours = parseInt(parts[0], 10)
  const minutes = parts[1]
  const ampm = hours >= 12 ? "PM" : "AM"
  hours = hours % 12
  hours = hours ? hours : 12
  const paddedHours = hours < 10 ? `0${hours}` : `${hours}`
  return `${paddedHours}:${minutes} ${ampm}`
}

export function formatSession(sessionType: "FN" | "AN"): string {
  return sessionType === "FN" ? "Forenoon" : "Afternoon"
}

export function getSessionLabel(date: string, sessionType: string): string {
  return `${formatDateWithDay(date)} (${sessionType})`
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "status-badge-pending",
    draft: "status-badge-draft",
    confirmed: "status-badge-confirmed",
    published: "status-badge-published"
  }
  return map[status] ?? "status-badge-pending"
}
