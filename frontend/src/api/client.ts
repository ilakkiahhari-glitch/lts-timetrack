import * as store from '../auth/storage'
import type { OnSiteEntry, ScanResponse, TokenResponse } from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number // 0 = the server could not be reached
  detail: string
  retryAfter: number | null

  constructor(status: number, detail: string, retryAfter: number | null = null) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.retryAfter = retryAfter
  }
}

/** True when the server rejected the kiosk's device key (as opposed to an expired login). */
export const isDeviceKeyError = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 401 && /device key/i.test(e.detail)

let accessToken: string | null = null
let refreshInFlight: Promise<RefreshOutcome> | null = null
let onSessionLost: (() => void) | null = null

type RefreshOutcome = 'ok' | 'rejected' | 'unreachable'

/** Called when the refresh token is rejected, so the UI can return to the login screen. */
export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler
}

export const hasSession = (): boolean => store.getRefreshToken() !== null

function detailOf(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    // FastAPI validation errors: [{ loc, msg, ... }]
    return detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join('; ') || fallback
  }
  return fallback
}

async function send(path: string, init: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the server')
  }
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { res, body }
}

// One refresh at a time, even when several requests hit an expired token together.
function refreshAccessToken(): Promise<RefreshOutcome> {
  const refreshToken = store.getRefreshToken()
  if (!refreshToken) return Promise.resolve('rejected')
  refreshInFlight ??= (async (): Promise<RefreshOutcome> => {
    try {
      const { res, body } = await send('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return 'rejected'
      accessToken = (body as TokenResponse).access_token
      return 'ok'
    } catch {
      return 'unreachable'
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  deviceKey?: string
  anonymous?: boolean // do not send the access token (login)
  retried?: boolean
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken && !opts.anonymous) headers.Authorization = `Bearer ${accessToken}`
  if (opts.deviceKey) headers['X-Device-Key'] = opts.deviceKey

  const { res, body } = await send(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  if (res.ok) return body as T

  const detail = detailOf(body, `Request failed (${res.status})`)

  // Expired or missing access token: renew it once, then repeat the request.
  if (res.status === 401 && detail === 'Not authenticated' && !opts.retried && !opts.anonymous) {
    const outcome = await refreshAccessToken()
    if (outcome === 'ok') return request<T>(path, { ...opts, retried: true })
    if (outcome === 'unreachable') throw new ApiError(0, 'Cannot reach the server')
    logout()
    onSessionLost?.()
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }

  const retryAfter = Number(res.headers.get('Retry-After'))
  throw new ApiError(res.status, detail, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null)
}

export async function login(email: string, password: string): Promise<void> {
  const tokens = await request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  })
  accessToken = tokens.access_token
  store.saveSession(tokens.refresh_token, email)
}

export function logout(): void {
  accessToken = null
  store.clearSession()
}

export const scan = (qrToken: string, deviceKey: string) =>
  request<ScanResponse>('/kiosk/scan', { method: 'POST', body: { qr_token: qrToken }, deviceKey })

export const onSite = (deviceKey: string) => request<OnSiteEntry[]>('/kiosk/status', { deviceKey })

/** Test helper: forget in-memory state. */
export function resetClientForTests(): void {
  accessToken = null
  refreshInFlight = null
  onSessionLost = null
}
