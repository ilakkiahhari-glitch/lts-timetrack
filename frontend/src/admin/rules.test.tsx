import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from '../api/client'
import { fakeApi, renderSignedIn, rule, types } from '../test/fakeApi'

beforeEach(() => resetClientForTests())
afterEach(() => vi.unstubAllGlobals())

const server = (over: Record<string, unknown> = {}) => ({
  'GET /person-types': () => ({ body: types }),
  'GET /attendance-rules/TEACHER': () => ({ body: rule(over) }),
  'GET /attendance-rules/STAFF': () => ({ body: rule({ person_type: 'STAFF', duplicate_window_seconds: 120 }) }),
})

describe('attendance rules page', () => {
  it('shows the rules of the teacher type to start with', async () => {
    fakeApi(server({ auto_close_time: '23:59:00', late_after_time: '08:30:00' }))
    renderSignedIn('/admin/rules')
    expect(await screen.findByLabelText('Duplicate scan window (seconds)')).toHaveValue(30)
    expect(screen.getByLabelText('Auto-close time (optional)')).toHaveValue('23:59')
    expect(screen.getByLabelText('Late after (optional)')).toHaveValue('08:30')
    expect(screen.getByLabelText('Person type')).toHaveValue('TEACHER')
    expect(screen.getByText(/never closed/i, { exact: false })).toBeInTheDocument() // the help explains "left open"
  })

  it('saves changes, sending times in the API format', async () => {
    const { to } = fakeApi({ ...server(), 'PUT /attendance-rules/TEACHER': ({ json }) => ({ body: rule({ ...json, updated_at: '2026-10-16T13:00:00Z' }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/rules')
    const window_ = await screen.findByLabelText('Duplicate scan window (seconds)')
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled() // nothing changed yet

    await user.clear(window_)
    await user.type(window_, '0')
    await user.type(screen.getByLabelText('Late after (optional)'), '0830')
    await user.type(screen.getByLabelText('Auto-close time (optional)'), '1800')
    await user.click(screen.getByRole('button', { name: 'Save rules' }))

    expect(await screen.findByText(/new rules apply from the next scan/i)).toBeInTheDocument()
    expect(to('PUT', '/attendance-rules/TEACHER')[0].json).toEqual({
      duplicate_window_seconds: 0, auto_close_time: '18:00:00', late_after_time: '08:30:00',
    })
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled()
  })

  it('clears an optional time by sending null', async () => {
    const { to } = fakeApi({ ...server({ late_after_time: '08:30:00' }), 'PUT /attendance-rules/TEACHER': ({ json }) => ({ body: rule({ ...json }) }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/rules')
    await user.clear(await screen.findByLabelText('Late after (optional)'))
    await user.click(screen.getByRole('button', { name: 'Save rules' }))
    await screen.findByText(/new rules apply/i)
    expect(to('PUT', '/attendance-rules/TEACHER')[0].json).toMatchObject({ late_after_time: null })
  })

  it.each([['', 'empty'], ['-5', 'negative'], ['2.5', 'fractional']])('refuses a %j duplicate window (%s)', async (value) => {
    fakeApi(server())
    const user = userEvent.setup()
    renderSignedIn('/admin/rules')
    const field = await screen.findByLabelText('Duplicate scan window (seconds)')
    await user.clear(field)
    if (value) await user.type(field, value)
    expect(screen.getByText('Enter a whole number, 0 or more.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled()
  })

  it("loads another type's rules when the type changes", async () => {
    fakeApi(server())
    const user = userEvent.setup()
    renderSignedIn('/admin/rules')
    await screen.findByLabelText('Duplicate scan window (seconds)')
    await user.selectOptions(screen.getByLabelText('Person type'), 'STAFF')
    expect(await screen.findByRole('heading', { name: 'Rules for staff' })).toBeInTheDocument()
    expect(screen.getByLabelText('Duplicate scan window (seconds)')).toHaveValue(120)
  })

  it.each([
    [422, 'whole number of seconds'],
    [500, 'Server exploded'],
  ])('explains a %i response when saving and keeps the edits', async (status, text) => {
    fakeApi({ ...server(), 'PUT /attendance-rules/TEACHER': () => ({ status, body: { detail: 'Server exploded' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/rules')
    const field = await screen.findByLabelText('Duplicate scan window (seconds)')
    await user.clear(field)
    await user.type(field, '45')
    await user.click(screen.getByRole('button', { name: 'Save rules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(field).toHaveValue(45)
  })

  it('says when a type has no rules, and when types cannot be loaded', async () => {
    fakeApi({ ...server(), 'GET /attendance-rules/TEACHER': () => ({ status: 404, body: { detail: 'none' } }) })
    renderSignedIn('/admin/rules')
    expect(await screen.findByRole('alert')).toHaveTextContent('no rules yet')
  })

  it('shows an error when the person types cannot be loaded', async () => {
    fakeApi({ 'GET /person-types': () => ({ status: 500, body: { detail: 'Database unavailable' } }) })
    renderSignedIn('/admin/rules')
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
  })
})
