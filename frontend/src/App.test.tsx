import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetClientForTests } from './api/client'
import { SessionProvider } from './auth/session.tsx'
import * as store from './auth/storage'

// The camera is not available under jsdom: stand in a button that "detects" a code.
vi.mock('./components/QrScanner', () => ({
  default: ({ onDetect }: { onDetect: (text: string) => void }) => (
    <button type="button" onClick={() => onDetect('tt_camera')}>simulate camera</button>
  ),
}))

type Reply = { status?: number; body: unknown; headers?: Record<string, string> }
type Server = Record<string, (init: RequestInit) => Reply>

const scanOk = (over: object = {}) => ({
  result: 'ENTRY', person: 'A. Rivera', person_type: 'TEACHER', message: 'Person currently on site',
  time: '2026-10-16T13:02:00Z', duration_seconds: null, ...over,
})

function stubServer(server: Server) {
  const calls: { path: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '')
    calls.push({ path, init })
    const handler = server[path]
    if (!handler) throw new Error(`unexpected request to ${path}`)
    const { status = 200, body, headers = {} } = handler(init)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  })
  return calls
}

const loginOk: Server['x'] = () => ({ body: { access_token: 'A1', refresh_token: 'R1', token_type: 'bearer' } })

function renderApp() {
  return render(<MemoryRouter initialEntries={['/']}><SessionProvider><App /></SessionProvider></MemoryRouter>)
}

beforeEach(() => resetClientForTests())
afterEach(() => vi.unstubAllGlobals())

describe('login', () => {
  it('asks for credentials when nobody is signed in', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: 'LTS TimeTrack' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it.each([
    [401, { detail: 'Invalid email or password' }, 'Wrong email or password.'],
    [403, { detail: 'Account temporarily locked' }, 'temporarily locked'],
    [429, { detail: 'Too many requests' }, 'Too many attempts'],
  ])('explains a %i response', async (status, body, text) => {
    stubServer({ '/auth/login': () => ({ status, body }) })
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText('Email'), 'vol@example.com')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })
})

describe('device setup', () => {
  it('moves from login to device setup to the kiosk, storing the device key', async () => {
    const calls = stubServer({ '/auth/login': loginOk, '/kiosk/status': () => ({ body: [] }) })
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByLabelText('Email'), 'vol@example.com')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Set up this kiosk' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Device key'), ' dk_secret ')
    await user.click(screen.getByRole('button', { name: 'Save and start' }))

    expect(await screen.findByText('Ready to scan')).toBeInTheDocument()
    expect(store.getDeviceKey()).toBe('dk_secret')
    const check = calls.find((c) => c.path === '/kiosk/status')!
    expect((check.init.headers as Record<string, string>)['X-Device-Key']).toBe('dk_secret')
  })

  it('rejects a key the server does not accept', async () => {
    store.saveSession('R1', 'vol@example.com')
    stubServer({
      '/kiosk/status': () => ({ status: 401, body: { detail: 'Invalid device key' } }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.type(screen.getByLabelText('Device key'), 'dk_wrong')
    await user.click(screen.getByRole('button', { name: 'Save and start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not accepted')
    expect(store.getDeviceKey()).toBeNull()
  })
})

describe('kiosk', () => {
  beforeEach(() => {
    store.saveSession('R1', 'vol@example.com')
    store.saveDeviceKey('dk_key')
  })

  it('lists who is on site', async () => {
    stubServer({
      '/kiosk/status': () => ({
        body: [
          { person: 'A. Rivera', person_type: 'TEACHER', entry_time: '2026-10-16T12:00:00Z' },
          { person: 'B. Chen', person_type: 'VOLUNTEER_HELPER', entry_time: '2026-10-16T12:30:00Z' },
        ],
      }),
    })
    renderApp()
    const list = await screen.findByRole('region', { name: /on site now/i })
    expect(await within(list).findByText('A. Rivera')).toBeInTheDocument()
    expect(within(list).getByText('Volunteer helper')).toBeInTheDocument()
    expect(within(list).getByText('2')).toBeInTheDocument()
  })

  it('checks a person in from the manual box and refreshes the list', async () => {
    let scanned = 0
    const calls = stubServer({
      '/kiosk/status': () => ({ body: scanned ? [{ person: 'A. Rivera', person_type: 'TEACHER', entry_time: '2026-10-16T13:02:00Z' }] : [] }),
      '/kiosk/scan': () => { scanned += 1; return { body: scanOk() } },
    })
    const user = userEvent.setup()
    renderApp()
    await screen.findByText('Nobody is checked in.')

    await user.type(screen.getByLabelText('USB scanner or manual entry'), 'tt_abc{Enter}')

    expect(await screen.findByRole('heading', { name: 'Checked in' })).toBeInTheDocument()
    expect(screen.getAllByText('A. Rivera').length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByText('Nobody is checked in.')).not.toBeInTheDocument())
    const sent = calls.find((c) => c.path === '/kiosk/scan')!
    expect(JSON.parse(sent.init.body as string)).toEqual({ qr_token: 'tt_abc' })
    expect(screen.getByLabelText('USB scanner or manual entry')).toHaveValue('')
  })

  it('checks a person in from the camera', async () => {
    stubServer({ '/kiosk/status': () => ({ body: [] }), '/kiosk/scan': () => ({ body: scanOk() }) })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    expect(await screen.findByRole('heading', { name: 'Checked in' })).toBeInTheDocument()
  })

  it('shows time on site when someone checks out', async () => {
    stubServer({
      '/kiosk/status': () => ({ body: [] }),
      '/kiosk/scan': () => ({ body: scanOk({ result: 'EXIT', message: 'Person checked out', duration_seconds: 27329 }) }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    expect(await screen.findByRole('heading', { name: 'Checked out' })).toBeInTheDocument()
    expect(screen.getByText('Time on site: 7 h 35 min')).toBeInTheDocument()
  })

  it('says so when the scan was a duplicate', async () => {
    stubServer({
      '/kiosk/status': () => ({ body: [] }),
      '/kiosk/scan': () => ({ body: scanOk({ result: 'DUPLICATE', message: 'Already recorded', time: null }) }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    expect(await screen.findByRole('heading', { name: 'Already scanned' })).toBeInTheDocument()
  })

  it('warns when a previous exit was missed', async () => {
    stubServer({
      '/kiosk/status': () => ({ body: [] }),
      '/kiosk/scan': () => ({ body: scanOk({ message: 'Previous exit was missed; person currently on site' }) }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    expect(await screen.findByText(/previous exit was not scanned/i)).toBeInTheDocument()
  })

  it('shows an error for an unknown QR code', async () => {
    stubServer({
      '/kiosk/status': () => ({ body: [] }),
      '/kiosk/scan': () => ({ status: 422, body: { detail: 'Invalid QR code' } }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('QR code not recognised')
  })

  it('sends the operator back to setup when the device key is rejected', async () => {
    stubServer({
      '/kiosk/status': () => ({ body: [] }),
      '/kiosk/scan': () => ({ status: 401, body: { detail: 'Invalid device key' } }),
    })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'simulate camera' }))
    await user.click(await screen.findByRole('button', { name: 'Enter a new device key' }))
    expect(await screen.findByRole('heading', { name: 'Set up this kiosk' })).toBeInTheDocument()
    expect(store.getDeviceKey()).toBeNull()
  })

  it('returns to the login screen when the session expires', async () => {
    stubServer({
      '/kiosk/status': () => ({ status: 401, body: { detail: 'Not authenticated' } }),
      '/auth/refresh': () => ({ status: 401, body: { detail: 'Invalid refresh token' } }),
    })
    renderApp()
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(store.getRefreshToken()).toBeNull()
  })

  it('signs out from the menu', async () => {
    stubServer({ '/kiosk/status': () => ({ body: [] }) })
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByText('vol@example.com'))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(store.getRefreshToken()).toBeNull()
    expect(store.getDeviceKey()).toBe('dk_key') // the kiosk keeps its own key for the next operator
  })
})
