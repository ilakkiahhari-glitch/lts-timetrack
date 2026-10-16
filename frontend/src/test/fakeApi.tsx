import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App'
import { SessionProvider } from '../auth/session'
import type { Role } from '../auth/jwt'
import * as store from '../auth/storage'

export interface FakeRequest {
  url: URL
  init: RequestInit
  /** The parsed JSON body (null when there is none). */
  json: Record<string, unknown> | null
}
export interface FakeReply {
  status?: number
  body?: unknown
  blob?: Blob
  headers?: Record<string, string>
}
type Handler = (req: FakeRequest) => FakeReply
export interface Call extends FakeRequest {
  method: string
  path: string
}

/**
 * Stubs fetch with routes like 'GET /people' or 'PATCH /people/abc' (method + path, no query string).
 * Returns the recorded calls so a test can check what was sent.
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://localhost')
    const path = url.pathname.replace('/api/v1', '')
    const method = (init.method ?? 'GET').toUpperCase()
    const json = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url, init, json, method, path })
    const handler = routes[`${method} ${path}`]
    if (!handler) throw new Error(`unexpected request: ${method} ${path}`)
    const { status = 200, body, blob, headers = {} } = handler({ url, init, json })
    if (blob) return new Response(blob, { status, headers })
    return new Response(JSON.stringify(body ?? null), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  })
  const to = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path)
  return { calls, to }
}

/** A token with the given role claim (the signature is not checked in the browser). */
export function fakeJwt(role: Role): string {
  const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', role, type: 'access' })}.signature`
}

/** Renders the whole app at a path, already signed in with the given role. */
export function renderSignedIn(path: string, role: Role = 'ADMIN', ui?: ReactElement) {
  store.saveSession('R1', role === 'ADMIN' ? 'admin@example.com' : 'vol@example.com', role)
  return renderApp(path, ui)
}

export function renderApp(path = '/', ui?: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>{ui ?? <App />}</SessionProvider>
    </MemoryRouter>,
  )
}

export const person = (over: Record<string, unknown> = {}) => ({
  id: 'p1', person_type: 'TEACHER', external_code: 'T001', first_name: 'Anna', last_name: 'Rivera',
  email: 'anna@school.org', group_name: 'Math', attributes: { room: 'B12' }, qr_version: 1,
  qr_issued_at: '2026-10-16T12:00:00Z', is_active: true, created_at: '2026-10-01T12:00:00Z', ...over,
})

export const PNG = 'data:image/png;base64,iVBORw0KGgo='

export const types = [
  { code: 'STAFF', display_name: 'Staff', is_active: true },
  { code: 'TEACHER', display_name: 'Teacher', is_active: true },
]
