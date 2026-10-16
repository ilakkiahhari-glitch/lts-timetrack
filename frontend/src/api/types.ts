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
