import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as store from '../auth/storage'
import { ApiError, isDeviceKeyError, login, onSite, resetClientForTests, scan, setSessionLostHandler } from './client'

type Handler = (init: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const SCAN_OK = { result: 'ENTRY', person: 'A. Rivera', person_type: 'TEACHER', message: 'ok', time: null, duration_seconds: null }

/** Routes the stubbed fetch by path; records every call. */
function stubServer(routes: Record<string, Handler>) {
  const calls: { path: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    calls.push({ path, init })
    const handler = routes[path]
    if (!handler) throw new Error(`unexpected request to ${path}`)
    return handler(init)
  })
  return calls
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name]

beforeEach(() => resetClientForTests())
afterEach(() => vi.unstubAllGlobals())

describe('login', () => {
  it('stores the refresh token and email, and sends no Authorization header', async () => {
    const calls = stubServer({ '/auth/login': () => json({ access_token: 'A1', refresh_token: 'R1', token_type: 'bearer' }) })
    await login('vol@example.com', 'secret')
    expect(store.getRefreshToken()).toBe('R1')
    expect(store.getOperatorEmail()).toBe('vol@example.com')
    expect(header(calls[0].init, 'Authorization')).toBeUndefined()
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ email: 'vol@example.com', password: 'secret' })
  })

  it('surfaces the server message and keeps nothing on a bad password', async () => {
    stubServer({ '/auth/login': () => json({ detail: 'Invalid email or password' }, 401) })
    await expect(login('vol@example.com', 'bad')).rejects.toMatchObject({ status: 401, detail: 'Invalid email or password' })
    expect(store.getRefreshToken()).toBeNull()
  })
})

describe('scan', () => {
  it('sends the bearer token, the device key and the QR token', async () => {
    const calls = stubServer({
      '/auth/login': () => json({ access_token: 'A1', refresh_token: 'R1', token_type: 'bearer' }),
      '/kiosk/scan': () => json(SCAN_OK),
    })
    await login('vol@example.com', 'pw')
    const result = await scan('tt_abc', 'dk_key')
    expect(result.person).toBe('A. Rivera')
    const sent = calls[1].init
    expect(header(sent, 'Authorization')).toBe('Bearer A1')
    expect(header(sent, 'X-Device-Key')).toBe('dk_key')
    expect(JSON.parse(sent.body as string)).toEqual({ qr_token: 'tt_abc' })
  })

  it('renews an expired access token once and repeats the request', async () => {
    let scans = 0
    const calls = stubServer({
      '/kiosk/scan': (init) => {
        scans += 1
        return header(init, 'Authorization') === 'Bearer A2' ? json(SCAN_OK) : json({ detail: 'Not authenticated' }, 401)
      },
      '/auth/refresh': () => json({ access_token: 'A2', refresh_token: null, token_type: 'bearer' }),
    })
    store.saveSession('R1', 'vol@example.com') // e.g. after a page reload: refresh token only
    expect((await scan('tt_abc', 'dk')).result).toBe('ENTRY')
    expect(scans).toBe(2)
    expect(JSON.parse(calls.find((c) => c.path === '/auth/refresh')!.init.body as string)).toEqual({ refresh_token: 'R1' })
  })

  it('refreshes only once when several requests expire together', async () => {
    let refreshes = 0
    stubServer({
      '/kiosk/scan': (init) => (header(init, 'Authorization') === 'Bearer A2' ? json(SCAN_OK) : json({ detail: 'Not authenticated' }, 401)),
      '/kiosk/status': (init) => (header(init, 'Authorization') === 'Bearer A2' ? json([]) : json({ detail: 'Not authenticated' }, 401)),
      '/auth/refresh': async () => {
        refreshes += 1
        await new Promise((r) => setTimeout(r, 10))
        return json({ access_token: 'A2', refresh_token: null, token_type: 'bearer' })
      },
    })
    store.saveSession('R1', 'vol@example.com')
    await Promise.all([scan('tt_a', 'dk'), onSite('dk'), scan('tt_b', 'dk')])
    expect(refreshes).toBe(1)
  })

  it('signs out when the refresh token is rejected', async () => {
    const lost = vi.fn()
    setSessionLostHandler(lost)
    stubServer({
      '/kiosk/scan': () => json({ detail: 'Not authenticated' }, 401),
      '/auth/refresh': () => json({ detail: 'Invalid refresh token' }, 401),
    })
    store.saveSession('R1', 'vol@example.com')
    await expect(scan('tt_abc', 'dk')).rejects.toMatchObject({ status: 401 })
    expect(lost).toHaveBeenCalledOnce()
    expect(store.getRefreshToken()).toBeNull()
  })

  it('stays signed in when the server cannot be reached during a refresh', async () => {
    const lost = vi.fn()
    setSessionLostHandler(lost)
    stubServer({
      '/kiosk/scan': () => json({ detail: 'Not authenticated' }, 401),
      '/auth/refresh': () => {
        throw new TypeError('network down')
      },
    })
    store.saveSession('R1', 'vol@example.com')
    await expect(scan('tt_abc', 'dk')).rejects.toMatchObject({ status: 0 })
    expect(lost).not.toHaveBeenCalled()
    expect(store.getRefreshToken()).toBe('R1')
  })

  it('does not refresh when the device key is the problem', async () => {
    const calls = stubServer({ '/kiosk/scan': () => json({ detail: 'Invalid device key' }, 401) })
    store.saveSession('R1', 'vol@example.com')
    const error = await scan('tt_abc', 'dk_bad').catch((e: unknown) => e)
    expect(isDeviceKeyError(error)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(store.getRefreshToken()).toBe('R1')
  })
})

describe('errors', () => {
  it('reads Retry-After on 429', async () => {
    stubServer({ '/kiosk/scan': () => json({ detail: 'Too many requests' }, 429, { 'Retry-After': '17' }) })
    await expect(scan('tt_abc', 'dk')).rejects.toMatchObject({ status: 429, retryAfter: 17 })
  })

  it('reports an invalid QR code', async () => {
    stubServer({ '/kiosk/scan': () => json({ detail: 'Invalid QR code' }, 422) })
    await expect(scan('tt_nope', 'dk')).rejects.toMatchObject({ status: 422, detail: 'Invalid QR code' })
  })

  it('joins FastAPI validation messages', async () => {
    stubServer({ '/kiosk/scan': () => json({ detail: [{ msg: 'String should have at least 1 character' }] }, 422) })
    await expect(scan('', 'dk')).rejects.toMatchObject({ detail: 'String should have at least 1 character' })
  })

  it('maps a network failure to status 0', async () => {
    stubServer({
      '/kiosk/scan': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const error = await scan('tt_abc', 'dk').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, detail: 'Cannot reach the server' })
  })

  it('tolerates a non-JSON error body', async () => {
    stubServer({ '/kiosk/scan': () => new Response('<html>Bad gateway</html>', { status: 502 }) })
    await expect(scan('tt_abc', 'dk')).rejects.toMatchObject({ status: 502, detail: 'Request failed (502)' })
  })
})
