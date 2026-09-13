import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string): string {
  try { return format(parseISO(date), "dd MMM yyyy") } catch { return date }
}

export function formatSession(sessionType: "FN" | "AN"): string {
  return sessionType === "FN" ? "Forenoon" : "Afternoon"
}

export function getSessionLabel(date: string, sessionType: string): string {
  return `${formatDate(date)} ${sessionType}`
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
