import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from '../api/client'
import { fakeApi, renderSignedIn, user as makeUser } from '../test/fakeApi'

beforeEach(() => resetClientForTests())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const me = makeUser({ id: 'me', email: 'admin@example.com', full_name: 'Ada Admin', role: 'ADMIN', last_login_at: '2026-10-16T12:00:00Z' })
const vera = makeUser()
const list = (rows: unknown[] = [me, vera]) => ({ 'GET /users': () => ({ body: rows }) })

describe('users page', () => {
  it('lists users, marks the signed-in admin, and keeps you from deactivating yourself', async () => {
    fakeApi(list())
    renderSignedIn('/admin/users') // signed in as admin@example.com
    expect(await screen.findByText('Ada Admin')).toBeInTheDocument()
    expect(screen.getByText('(you)')).toBeInTheDocument()
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument()
    expect(screen.getAllByText('Never')).toHaveLength(1) // Vera has never signed in
    expect(screen.getByRole('button', { name: 'Deactivate Ada Admin' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deactivate Vera Volunteer' })).toBeEnabled()
  })

  it('shows an error when the list cannot be loaded', async () => {
    fakeApi({ 'GET /users': () => ({ status: 500, body: { detail: 'Database unavailable' } }) })
    renderSignedIn('/admin/users')
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
  })

  it('adds a user with a generated password', async () => {
    const { to } = fakeApi({
      ...list(),
      'POST /users': ({ json }) => ({ status: 201, body: makeUser({ id: 'new', email: json?.email, full_name: json?.full_name, role: json?.role }) }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await screen.findByText('Ada Admin')

    await user.type(screen.getByLabelText('Full name'), 'Nora New')
    await user.type(screen.getByLabelText('Email'), 'nora@example.com')
    await user.selectOptions(screen.getByLabelText('Role'), 'ADMIN')
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled() // no password yet
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    const password = (screen.getAllByLabelText('Password')[0] as HTMLInputElement).value
    expect(password).toHaveLength(14)
    await user.click(screen.getByRole('button', { name: 'Add user' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Nora New was added')
    expect(to('POST', '/users')[0].json).toEqual({ email: 'nora@example.com', full_name: 'Nora New', role: 'ADMIN', password })
    expect(screen.getByText('nora@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('') // form cleared for the next one
  })

  it('needs a password of at least 8 characters', async () => {
    fakeApi(list())
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await screen.findByText('Ada Admin')
    await user.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByRole('button', { name: 'Add user' })).toBeDisabled()
    await user.type(screen.getByLabelText('Password'), '12345')
    expect(screen.getByRole('button', { name: 'Add user' })).toBeEnabled()
  })

  it.each([
    [409, 'already in use'],
    [422, 'Check the details'],
  ])('explains a %i response when adding', async (status, text) => {
    fakeApi({ ...list(), 'POST /users': () => ({ status, body: { detail: 'x' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await screen.findByText('Ada Admin')
    await user.type(screen.getByLabelText('Full name'), 'Nora')
    await user.type(screen.getByLabelText('Email'), 'nora@example.com')
    await user.type(screen.getByLabelText('Password'), 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Add user' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it("changes someone's name and role", async () => {
    const { to } = fakeApi({ ...list(), 'PATCH /users/u1': ({ json }) => ({ body: makeUser({ ...json }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await user.click(await screen.findByRole('button', { name: 'Edit Vera Volunteer' }))
    await user.clear(screen.getByLabelText('Full name of vol@example.com'))
    await user.type(screen.getByLabelText('Full name of vol@example.com'), 'Vera Boss')
    await user.selectOptions(screen.getByLabelText('Role of vol@example.com'), 'ADMIN')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Vera Boss')).toBeInTheDocument()
    expect(to('PATCH', '/users/u1')[0].json).toEqual({ full_name: 'Vera Boss', role: 'ADMIN' })
    expect(screen.getByRole('status')).toHaveTextContent('Vera Boss was updated')
  })

  it('does not let you change your own role', async () => {
    const { to } = fakeApi({ ...list(), 'PATCH /users/me': ({ json }) => ({ body: { ...me, ...json } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await user.click(await screen.findByRole('button', { name: 'Edit Ada Admin' }))
    expect(screen.getByLabelText('Role of admin@example.com')).toBeDisabled()
    await user.type(screen.getByLabelText('Full name of admin@example.com'), ' II')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('cell', { name: /Ada Admin II/ })
    expect(to('PATCH', '/users/me')[0].json).toEqual({ full_name: 'Ada Admin II' }) // no role sent
  })

  it('resets a password, which also unlocks the account', async () => {
    const { to } = fakeApi({ ...list(), 'PATCH /users/u1': () => ({ body: vera }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await user.click(await screen.findByRole('button', { name: 'Reset password for Vera Volunteer' }))
    const form = screen.getByRole('form', { name: /new password for vera/i })
    expect(within(form).getByText(/unlocks the account/i)).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Set password' })).toBeDisabled()
    await user.type(within(form).getByLabelText('Password'), 'brand-new-pass')
    await user.click(within(form).getByRole('button', { name: 'Set password' }))
    expect(await screen.findByRole('status')).toHaveTextContent('New password set for Vera Volunteer')
    expect(to('PATCH', '/users/u1')[0].json).toEqual({ password: 'brand-new-pass' })
    expect(screen.queryByRole('form', { name: /new password/i })).not.toBeInTheDocument()
  })

  it('deactivates only after confirmation, and reactivates without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { to } = fakeApi({ ...list(), 'PATCH /users/u1': ({ json }) => ({ body: makeUser({ ...json }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await user.click(await screen.findByRole('button', { name: 'Deactivate Vera Volunteer' }))
    expect(to('PATCH', '/users/u1')).toHaveLength(0)

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Deactivate Vera Volunteer' }))
    expect(await screen.findByRole('button', { name: 'Reactivate Vera Volunteer' })).toBeInTheDocument()
    expect(to('PATCH', '/users/u1')[0].json).toEqual({ is_active: false })

    await user.click(screen.getByRole('button', { name: 'Reactivate Vera Volunteer' }))
    expect(await screen.findByRole('button', { name: 'Deactivate Vera Volunteer' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('shows the server message if it refuses a change to your own account', async () => {
    fakeApi({ ...list([me, vera]), 'PATCH /users/u1': () => ({ status: 409, body: { detail: 'x' } }) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    renderSignedIn('/admin/users')
    await user.click(await screen.findByRole('button', { name: 'Deactivate Vera Volunteer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('your own account')
  })
})
