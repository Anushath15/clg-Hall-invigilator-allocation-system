export interface Department {
  id: number
  code: string
  name: string
  is_active: boolean
}

export interface User {
  id: number
  staff_id: string
  name: string
  email?: string
  designation?: string
  role: "admin" | "staff"
  department_id?: number
  department?: Department
  is_active: boolean
}

export interface Hall {
  id: number
  hall_code: string
  name: string
  capacity: number
  block?: string
  sort_order: number
  is_active: boolean
}

export interface ExamCycle {
  id: number
  name: string
  academic_year: string
  status: "draft" | "active" | "closed"
  created_at: string
}

export interface ExamSession {
  id: number
  cycle_id: number
  exam_date: string
  session_type: "FN" | "AN"
  rotation_step: number
  reporting_time?: string
  exam_start?: string
  exam_end?: string
  status: "pending" | "draft" | "confirmed" | "published"
}

export interface Allocation {
  id: number
  session_id: number
  user_id: number
  hall_id: number
  is_manually_edited: boolean
  edit_reason?: string
  generated_hall_id?: number
  user?: User
  hall?: Hall
  session?: ExamSession
}

export interface RotationHistory {
  id: number
  user_id: number
  session_id: number
  hall_id: number
  rotation_step: number
  recorded_at: string
  hall?: Hall
  session?: ExamSession
}

export interface ValidationError {
  rule: string
  message: string
  userId?: number
  hallId?: number
  sessionId?: number
}

export interface ValidationResult {
  isValid: boolean
  blockingErrors: ValidationError[]
  warnings: string[]
}

export interface AllocationDraft {
  sessionId: number
  entries: Array<{ userId: number; hallId: number; isEdited: boolean; editReason?: string }>
}

export interface AppSettings {
  "college.name": string
  "college.short_name": string
  "session.fn_reporting_time": string
  "session.fn_start_time": string
  "session.fn_end_time": string
  "session.an_reporting_time": string
  "session.an_start_time": string
  "session.an_end_time": string
  [key: string]: string
}
