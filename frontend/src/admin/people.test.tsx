import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from '../api/client'
import { fakeApi, person, PNG, renderSignedIn, types } from '../test/fakeApi'

beforeEach(() => {
  resetClientForTests()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:fake-qr'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const params = (call: { url: URL }) => Object.fromEntries(call.url.searchParams)

// ---------------------------------------------------------------------------------- people list

describe('people list', () => {
  const list = (rows: unknown[] = [person()]) => ({
    'GET /people': () => ({ body: rows }),
    'GET /person-types': () => ({ body: types }),
  })

  it('lists active people by default', async () => {
    const { to } = fakeApi(list([person(), person({ id: 'p2', first_name: 'Ben', last_name: 'Chen', external_code: 'T002', group_name: null })]))
    renderSignedIn('/admin/people')
    const link = await screen.findByRole('link', { name: 'Rivera, Anna' })
    expect(link).toHaveAttribute('href', '/admin/people/p1')
    expect(screen.getByText('Chen, Ben')).toBeInTheDocument()
    expect(params(to('GET', '/people')[0])).toMatchObject({ active: 'true', limit: '26', offset: '0' })
  })

  it('searches after a short pause and filters by type, group and status', async () => {
    const { to } = fakeApi(list())
    const user = userEvent.setup()
    renderSignedIn('/admin/people')
    await screen.findByRole('link', { name: 'Rivera, Anna' })
    const last = () => params(to('GET', '/people').at(-1)!)

    await user.type(screen.getByLabelText('Search'), 'riv')
    await waitFor(() => expect(last().q).toBe('riv'))

    await user.selectOptions(screen.getByLabelText('Type'), 'TEACHER')
    await waitFor(() => expect(last().type).toBe('TEACHER'))

    await user.type(screen.getByLabelText('Group'), 'Math')
    await waitFor(() => expect(last().group).toBe('Math'))

    await user.selectOptions(screen.getByLabelText('Status'), 'all')
    await waitFor(() => expect(last().active).toBeUndefined())
    await user.selectOptions(screen.getByLabelText('Status'), 'inactive')
    await waitFor(() => expect(last().active).toBe('false'))
  })

  it('pages through results 25 at a time', async () => {
    const many = Array.from({ length: 26 }, (_, i) => person({ id: `p${i}`, first_name: `N${i}`, last_name: 'Person', external_code: `T${i}` }))
    const { to } = fakeApi({
      ...list(),
      'GET /people': ({ url }) => ({ body: url.searchParams.get('offset') === '0' ? many : [person({ id: 'last', first_name: 'Zed', last_name: 'Zimmer' })] }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/people')
    await screen.findByRole('link', { name: 'Person, N0' })
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25 (the 26th only signals a next page)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('link', { name: 'Zimmer, Zed' })).toBeInTheDocument()
    expect(params(to('GET', '/people').at(-1)!).offset).toBe('25')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByRole('link', { name: 'Person, N0' })).toBeInTheDocument()
  })

  it('explains an empty list, with and without filters', async () => {
    fakeApi(list([]))
    const user = userEvent.setup()
    renderSignedIn('/admin/people')
    expect(await screen.findByRole('link', { name: 'Add the first person.' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'nobody')
    expect(await screen.findByText('No one matches these filters.')).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    fakeApi({ ...list(), 'GET /people': () => ({ status: 500, body: { detail: 'Boom' } }) })
    renderSignedIn('/admin/people')
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
  })
})

// ---------------------------------------------------------------------------------- add person

describe('add person', () => {
  const created = (over: object = {}) => ({ ...person({ id: 'new1', external_code: 'T900', first_name: 'Maria', last_name: 'Lopez' }), qr_token: 'tt_secret123', qr_image: PNG, ...over })
  const form = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText('Employee or ID number'), ' T900 ')
    await user.type(screen.getByLabelText('First name'), 'Maria')
    await user.type(screen.getByLabelText('Last name'), 'Lopez')
  }

  it('creates the person, then shows the badge with print and download', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { to } = fakeApi({ 'GET /person-types': () => ({ body: types }), 'POST /people': () => ({ status: 201, body: created() }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/new')
    expect(await screen.findByLabelText('Type')).toHaveValue('TEACHER') // the usual choice is preselected

    await form(user)
    await user.type(screen.getByLabelText('Group (optional)'), 'Science')
    await user.click(screen.getByRole('button', { name: 'Add detail' }))
    await user.type(screen.getByLabelText('Detail 1 name'), 'room')
    await user.type(screen.getByLabelText('Detail 1 value'), 'S3')
    await user.click(screen.getByRole('button', { name: 'Save and create badge' }))

    expect(await screen.findByRole('heading', { name: 'Maria Lopez is registered' })).toBeInTheDocument()
    expect(to('POST', '/people')[0].json).toEqual({
      person_type: 'TEACHER', external_code: 'T900', first_name: 'Maria', last_name: 'Lopez',
      email: null, group_name: 'Science', attributes: { room: 'S3' },
    })
    expect(screen.getByAltText('QR code for Maria Lopez')).toHaveAttribute('src', PNG)
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download QR image' })).toHaveAttribute('download', 'badge-T900.png')

    await user.click(screen.getByRole('button', { name: 'Print badge' }))
    expect(print).toHaveBeenCalledOnce()

    await user.click(screen.getByText('Show the code text'))
    expect(screen.getByText('tt_secret123')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View person' })).toHaveAttribute('href', '/admin/people/new1')
  })

  it('does not print the code text on the badge itself', async () => {
    fakeApi({ 'GET /person-types': () => ({ body: types }), 'POST /people': () => ({ status: 201, body: created() }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/new')
    await form(user)
    await user.click(screen.getByRole('button', { name: 'Save and create badge' }))
    await screen.findByAltText('QR code for Maria Lopez')
    const badge = document.querySelector('.badge-print')!
    expect(badge.textContent).not.toContain('tt_secret123')
    expect(badge.textContent).toContain('Maria Lopez')
    expect(badge.textContent).toContain('Teacher · T900')
  })

  it.each([
    [409, { detail: 'dup' }, 'already exists'],
    [422, { detail: 'bad' }, 'Check the details'],
    [500, { detail: 'Server exploded' }, 'Server exploded'],
  ])('explains a %i response and keeps what was typed', async (status, body, text) => {
    fakeApi({ 'GET /person-types': () => ({ body: types }), 'POST /people': () => ({ status, body }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/new')
    await form(user)
    await user.click(screen.getByRole('button', { name: 'Save and create badge' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByLabelText('Last name')).toHaveValue('Lopez')
  })

  it('can add another person with a clean form', async () => {
    fakeApi({ 'GET /person-types': () => ({ body: types }), 'POST /people': () => ({ status: 201, body: created() }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/new')
    await form(user)
    await user.click(screen.getByRole('button', { name: 'Save and create badge' }))
    await user.click(await screen.findByRole('button', { name: 'Add another person' }))
    expect(await screen.findByLabelText('First name')).toHaveValue('')
    expect(screen.getByLabelText('Type')).toHaveValue('TEACHER')
  })
})

// ---------------------------------------------------------------------------------- person detail

describe('person detail', () => {
  function server(over: Record<string, () => object> = {}) {
    return fakeApi({
      'GET /people/p1': () => ({ body: person({ attributes: { room: 'B12', capacity: 30 } }) }),
      'GET /people/p1/qr': () => ({ status: 404, body: { detail: 'QR image no longer available' } }),
      'PATCH /people/p1': () => ({ body: person() }),
      ...over,
    })
  }

  it('shows the person and saves only after something changed', async () => {
    const { to } = fakeApi({
      'GET /people/p1': () => ({ body: person({ attributes: { room: 'B12', capacity: 30 } }) }),
      'GET /people/p1/qr': () => ({ status: 404, body: { detail: 'gone' } }),
      'PATCH /people/p1': ({ json }) => ({ body: person({ ...json }) }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    expect(await screen.findByRole('heading', { name: 'Anna Rivera' })).toBeInTheDocument()
    expect(screen.getByText('T001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Group'))
    await user.type(screen.getByLabelText('Group'), 'Science')
    await user.clear(screen.getByLabelText('Email'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    // blank email becomes null, and the untouched number in "attributes" is still a number
    expect(to('PATCH', '/people/p1')[0].json).toEqual({
      first_name: 'Anna', last_name: 'Rivera', email: null, group_name: 'Science', attributes: { room: 'B12', capacity: 30 },
    })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('shows a validation error from the server', async () => {
    server({ 'PATCH /people/p1': () => ({ status: 422, body: { detail: 'x' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    await user.type(await screen.findByLabelText('Last name'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the details')
  })

  it('deactivates only after confirmation, and reactivates without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { to } = fakeApi({
      'GET /people/p1': () => ({ body: person() }),
      'GET /people/p1/qr': () => ({ status: 404, body: { detail: 'gone' } }),
      'PATCH /people/p1': ({ json }) => ({ body: person({ ...json }) }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    await user.click(await screen.findByRole('button', { name: 'Deactivate' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(to('PATCH', '/people/p1')).toHaveLength(0)

    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Deactivate' }))
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument()
    expect(to('PATCH', '/people/p1')[0].json).toEqual({ is_active: false })
    expect(screen.getByRole('button', { name: 'Issue a new QR code' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Reactivate' }))
    expect(await screen.findByRole('button', { name: 'Deactivate' })).toBeInTheDocument()
    expect(confirm).toHaveBeenCalledTimes(2) // reactivating did not ask
  })

  it('issues a new QR code after confirmation and shows the new badge', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { to } = server({
      'POST /people/p1/qr/rotate': () => ({ body: { ...person({ qr_version: 2 }), qr_token: 'tt_new_token', qr_image: PNG } }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    await screen.findByText(/cannot be shown again/i)
    await user.click(screen.getByRole('button', { name: 'Issue a new QR code' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('stops working immediately'))
    expect(await screen.findByRole('heading', { name: 'New QR badge issued' })).toBeInTheDocument()
    expect(to('POST', '/people/p1/qr/rotate')).toHaveLength(1)
    expect(screen.getByAltText('QR code for Anna Rivera')).toHaveAttribute('src', PNG)
    expect(screen.getByText(/Version 2/)).toBeInTheDocument()
  })

  it('does nothing when the rotation is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { to } = server()
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    await user.click(await screen.findByRole('button', { name: 'Issue a new QR code' }))
    expect(to('POST', '/people/p1/qr/rotate')).toHaveLength(0)
  })

  it('offers to reprint a badge that was issued moments ago', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    server({ 'GET /people/p1/qr': () => ({ blob: new Blob(['png'], { type: 'image/png' }), headers: { 'Content-Type': 'image/png' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/p1')
    expect(await screen.findByRole('heading', { name: 'Badge available to print' })).toBeInTheDocument()
    expect(screen.getByAltText('QR code for Anna Rivera')).toHaveAttribute('src', 'blob:fake-qr')
    expect(screen.queryByText(/cannot be shown again/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Print badge' }))
    expect(print).toHaveBeenCalledOnce()
  })

  it('says when the person does not exist', async () => {
    fakeApi({
      'GET /people/p1': () => ({ status: 404, body: { detail: 'Person not found' } }),
      'GET /people/p1/qr': () => ({ status: 404, body: { detail: 'Person not found' } }),
    })
    renderSignedIn('/admin/people/p1')
    expect(await screen.findByRole('alert')).toHaveTextContent('not found')
    expect(screen.getByRole('link', { name: 'Back to the list' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------- person types

describe('person types', () => {
  it('lists the types and adds a new one', async () => {
    const { to } = fakeApi({
      'GET /person-types': () => ({ body: types }),
      'POST /person-types': ({ json }) => ({ status: 201, body: { code: String(json?.code).toUpperCase(), display_name: json?.display_name, is_active: true } }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/types')
    expect(await screen.findByText('Teacher')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Code'), 'contractor')
    await user.type(screen.getByLabelText('Display name'), 'Contractor')
    await user.click(screen.getByRole('button', { name: 'Add type' }))

    expect(await screen.findByText('CONTRACTOR')).toBeInTheDocument()
    expect(to('POST', '/person-types')[0].json).toEqual({ code: 'contractor', display_name: 'Contractor' })
    expect(screen.getByLabelText('Code')).toHaveValue('')
  })

  it.each([
    [409, 'already exists'],
    [422, 'must start with a letter'],
  ])('explains a %i response', async (status, text) => {
    fakeApi({ 'GET /person-types': () => ({ body: types }), 'POST /person-types': () => ({ status, body: { detail: 'x' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/people/types')
    await user.type(await screen.findByLabelText('Code'), 'staff')
    await user.type(screen.getByLabelText('Display name'), 'Staff')
    await user.click(screen.getByRole('button', { name: 'Add type' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})
