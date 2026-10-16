import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from '../api/client'
import { device, fakeApi, renderSignedIn } from '../test/fakeApi'

beforeEach(() => resetClientForTests())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()
const list = (rows: unknown[] = [device()]) => ({ 'GET /devices': () => ({ body: rows }) })

describe('kiosks page', () => {
  it('lists kiosks with status and when each was last seen', async () => {
    fakeApi(list([
      device({ id: 'd2', name: 'Side Gate', location: null, last_seen_at: minutesAgo(5) }),
      device({ name: 'Front Door' }),
      device({ id: 'd3', name: 'Old Kiosk', is_active: false }),
    ]))
    renderSignedIn('/admin/devices')
    await screen.findByText('Side Gate') // wait for the list, not just the header row
    const text = screen.getAllByRole('row').slice(1).map((r) => r.textContent ?? '')
    expect(text[0]).toContain('Front Door') // sorted by name
    expect(text[0]).toContain('Never')
    expect(text[1]).toContain('Old Kiosk')
    expect(text[1]).toContain('Inactive')
    expect(text[2]).toContain('Side Gate')
    expect(text[2]).toContain('5 min ago')
  })

  it('says so when there are no kiosks, or when loading fails', async () => {
    fakeApi(list([]))
    renderSignedIn('/admin/devices')
    expect(await screen.findByText(/no kiosks yet/i)).toBeInTheDocument()
  })

  it('shows an error when the list cannot be loaded', async () => {
    fakeApi({ 'GET /devices': () => ({ status: 500, body: { detail: 'Database unavailable' } }) })
    renderSignedIn('/admin/devices')
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
  })

  it('registers a kiosk and shows its key once, with a copy button', async () => {
    const { to } = fakeApi({
      ...list([]),
      'POST /devices': ({ json }) => ({ status: 201, body: { ...device({ id: 'new', name: json?.name, location: json?.location }), api_key: 'dk_secret_value' } }),
    })
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText') // user-event provides the clipboard on setup()
    renderSignedIn('/admin/devices')
    await user.type(await screen.findByLabelText('Name'), '  Gate  ')
    await user.click(screen.getByRole('button', { name: 'Register kiosk' }))

    const secret = await screen.findByRole('region', { name: 'Gate is registered' })
    expect(within(secret).getByText('dk_secret_value')).toBeInTheDocument()
    expect(within(secret).getByText(/shown only once/i)).toBeInTheDocument()
    expect(to('POST', '/devices')[0].json).toEqual({ name: 'Gate', location: null }) // trimmed, blank location is null
    expect(screen.getByRole('cell', { name: 'Gate' })).toBeInTheDocument()

    await user.click(within(secret).getByRole('button', { name: 'Copy device key' }))
    expect(clipboard).toHaveBeenCalledWith('dk_secret_value')
    expect(await within(secret).findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await user.click(within(secret).getByRole('button', { name: 'I have saved it' }))
    expect(screen.queryByText('dk_secret_value')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('') // the form is ready for the next one
  })

  it('refuses a duplicate name', async () => {
    fakeApi({ ...list(), 'POST /devices': () => ({ status: 409, body: { detail: 'dup' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.type(await screen.findByLabelText('Name'), 'Front Door')
    await user.click(screen.getByRole('button', { name: 'Register kiosk' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByLabelText('Name')).toHaveValue('Front Door')
  })

  it('renames a kiosk and changes its location', async () => {
    const { to } = fakeApi({ ...list(), 'PATCH /devices/d1': ({ json }) => ({ body: device({ ...json }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.click(await screen.findByRole('button', { name: 'Edit Front Door' }))
    await user.clear(screen.getByLabelText('Kiosk name'))
    await user.type(screen.getByLabelText('Kiosk name'), 'Main Door')
    await user.clear(screen.getByLabelText('Location'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('cell', { name: 'Main Door' })).toBeInTheDocument()
    expect(to('PATCH', '/devices/d1')[0].json).toEqual({ name: 'Main Door', location: null })
  })

  it('can cancel an edit, and reports a name that is taken', async () => {
    fakeApi({ ...list(), 'PATCH /devices/d1': () => ({ status: 409, body: { detail: 'dup' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.click(await screen.findByRole('button', { name: 'Edit Front Door' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('cell', { name: 'Front Door' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Front Door' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('deactivates only after confirmation, and reactivates without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { to } = fakeApi({ ...list(), 'PATCH /devices/d1': ({ json }) => ({ body: device({ ...json }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.click(await screen.findByRole('button', { name: 'Deactivate Front Door' }))
    expect(to('PATCH', '/devices/d1')).toHaveLength(0)

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Deactivate Front Door' }))
    expect(await screen.findByRole('button', { name: 'Reactivate Front Door' })).toBeInTheDocument()
    expect(to('PATCH', '/devices/d1')[0].json).toEqual({ is_active: false })

    await user.click(screen.getByRole('button', { name: 'Reactivate Front Door' }))
    expect(await screen.findByRole('button', { name: 'Deactivate Front Door' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('issues a new key after confirmation and shows it once', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { to } = fakeApi({ ...list(), 'PATCH /devices/d1': () => ({ body: { ...device(), api_key: 'dk_brand_new' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.click(await screen.findByRole('button', { name: 'New key for Front Door' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('stops working'))
    const secret = await screen.findByRole('region', { name: 'New key for Front Door' })
    expect(within(secret).getByText('dk_brand_new')).toBeInTheDocument()
    expect(to('PATCH', '/devices/d1')[0].json).toEqual({ rotate_key: true })
    expect(screen.queryByText('dk_old')).not.toBeInTheDocument()
  })

  it('does not rotate the key unless confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { to } = fakeApi(list())
    const user = userEvent.setup()
    renderSignedIn('/admin/devices')
    await user.click(await screen.findByRole('button', { name: 'New key for Front Door' }))
    expect(to('PATCH', '/devices/d1')).toHaveLength(0)
  })
})
