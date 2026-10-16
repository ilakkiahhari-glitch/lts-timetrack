import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from './api/client'
import * as store from './auth/storage'
import { fakeApi, fakeJwt, renderApp, renderSignedIn, types } from './test/fakeApi'

const noOneOnSite = { 'GET /attendance/sessions': () => ({ body: [] }) }
const people = { 'GET /people': () => ({ body: [] }), 'GET /person-types': () => ({ body: types }) }

beforeEach(() => resetClientForTests())
afterEach(() => vi.unstubAllGlobals())

async function signIn(role: 'ADMIN' | 'VOLUNTEER') {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), 'someone@example.com')
  await user.type(screen.getByLabelText('Password'), 'pw')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return { user, role }
}

const login = (role: 'ADMIN' | 'VOLUNTEER') => ({
  'POST /auth/login': () => ({ body: { access_token: fakeJwt(role), refresh_token: 'R1', token_type: 'bearer' } }),
})

describe('who sees what', () => {
  it('sends a signed-out visitor from an admin page to the login screen', async () => {
    renderApp('/admin/people')
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })

  it('opens the dashboard for an admin', async () => {
    fakeApi(noOneOnSite)
    renderSignedIn('/', 'ADMIN')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('opens the kiosk for a volunteer, and keeps them out of admin pages', async () => {
    store.saveDeviceKey('dk_key')
    const { calls } = fakeApi({ 'GET /kiosk/status': () => ({ body: [] }) })
    renderSignedIn('/admin/people', 'VOLUNTEER')
    expect(await screen.findByText('Ready to scan')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/people')).toBe(false)
  })

  it('treats a signed-in account with no stored role as a volunteer', async () => {
    store.saveSession('R1', 'old@example.com') // saved by an older version, without a role
    store.saveDeviceKey('dk_key')
    fakeApi({ 'GET /kiosk/status': () => ({ body: [] }) })
    renderApp('/admin')
    expect(await screen.findByText('Ready to scan')).toBeInTheDocument()
  })

  it('unknown addresses go to the right home screen', async () => {
    fakeApi(noOneOnSite)
    renderSignedIn('/no/such/page', 'ADMIN')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('signing in', () => {
  it('takes an admin to the dashboard', async () => {
    fakeApi({ ...login('ADMIN'), ...noOneOnSite })
    renderApp('/')
    await signIn('ADMIN')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(store.getRole()).toBe('ADMIN')
  })

  it('takes a volunteer to the kiosk', async () => {
    fakeApi(login('VOLUNTEER'))
    renderApp('/')
    await signIn('VOLUNTEER')
    expect(await screen.findByRole('heading', { name: 'Set up this kiosk' })).toBeInTheDocument()
    expect(store.getRole()).toBe('VOLUNTEER')
  })

  it('returns to the page that needed the sign-in', async () => {
    fakeApi({ ...login('ADMIN'), ...people })
    renderApp('/admin/people')
    await signIn('ADMIN')
    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
  })
})

describe('admin header', () => {
  it('signs out, and links to the kiosk', async () => {
    fakeApi(noOneOnSite)
    const user = userEvent.setup()
    renderSignedIn('/admin', 'ADMIN')
    await screen.findByRole('heading', { name: 'Dashboard' })
    expect(screen.getByRole('link', { name: 'Open kiosk' })).toHaveAttribute('href', '/kiosk')
    expect(screen.getByRole('link', { name: 'People' })).toHaveAttribute('href', '/admin/people')

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(store.getRefreshToken()).toBeNull()
    expect(store.getRole()).toBeNull()
  })

  it('lets an admin open the kiosk and come back through its menu', async () => {
    store.saveDeviceKey('dk_key')
    fakeApi({ ...noOneOnSite, 'GET /kiosk/status': () => ({ body: [] }) })
    const user = userEvent.setup()
    renderSignedIn('/admin', 'ADMIN')
    await user.click(await screen.findByRole('link', { name: 'Open kiosk' }))
    await screen.findByText('Ready to scan')
    await user.click(screen.getByText('admin@example.com'))
    await user.click(screen.getByRole('link', { name: 'Admin dashboard' }))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
