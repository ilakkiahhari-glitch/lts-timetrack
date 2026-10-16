// Mirrors the backend schemas (app/schemas/auth.py and app/schemas/kiosk.py).

export interface TokenResponse {
  access_token: string
  refresh_token: string | null
  token_type: string
}

export type ScanOutcome = 'ENTRY' | 'EXIT' | 'DUPLICATE'

export interface ScanResponse {
  result: ScanOutcome
  person: string // short name such as "A. Rivera"
  person_type: string
  message: string
  time: string | null // ISO-8601 UTC
  duration_seconds: number | null
}

export interface OnSiteEntry {
  person: string
  person_type: string
  entry_time: string
}

// ---- admin (app/schemas/people.py, attendance.py) ----

export interface Person {
  id: string
  person_type: string
  external_code: string
  first_name: string
  last_name: string
  email: string | null
  group_name: string | null
  attributes: Record<string, unknown>
  qr_version: number
  qr_issued_at: string
  is_active: boolean
  created_at: string
}

/** Returned only when a QR is issued (create or rotate). The raw token cannot be fetched again. */
export interface PersonWithQr extends Person {
  qr_token: string
  qr_image: string // PNG data: URI
}

export interface PersonCreate {
  person_type: string
  external_code: string
  first_name: string
  last_name: string
  email: string | null
  group_name: string | null
  attributes: Record<string, unknown>
}

export type PersonUpdate = Partial<Pick<Person, 'first_name' | 'last_name' | 'email' | 'group_name' | 'attributes' | 'is_active'>>

export interface PersonType {
  code: string
  display_name: string
  is_active: boolean
}

/** Why an admin must look at a session: still open past its cutoff, or voided because of a missed exit. */
export type ReviewReason = 'LEFT_OPEN' | 'MISSED_EXIT'

export interface SessionSummary {
  id: string
  person_id: string
  external_code: string
  person_name: string
  person_type: string
  entry_time: string
  exit_time: string | null
  status: 'OPEN' | 'CLOSED' | 'VOIDED'
  duration_seconds: number | null
  work_date: string
  notes: string | null
  review: ReviewReason | null
}

export interface SessionEvent {
  id: number
  event_type: 'ENTRY' | 'EXIT'
  event_time: string
  source: 'KIOSK' | 'ADMIN_CORRECTION' | 'SYSTEM'
}

export interface SessionDetail extends SessionSummary {
  events: SessionEvent[]
}

export interface CorrectionRequest {
  entry_time: string // ISO-8601 with an offset
  exit_time: string
  reason: string
}

export interface AuditEntry {
  id: number
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string
  reason: string | null
  created_at: string
}
