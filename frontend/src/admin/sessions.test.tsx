import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from '../api/client'
import { fromInputValue, isoDaysAgo, toInputValue } from '../dates'
import { fakeApi, person, renderSignedIn, session, sessionDetail, types } from '../test/fakeApi'

beforeEach(() => resetClientForTests())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const params = (call: { url: URL }) => Object.fromEntries(call.url.searchParams)

// ---------------------------------------------------------------------------------- dashboard

describe('dashboard', () => {
  const left = session({ id: 'left', person_name: 'Lena Left', status: 'OPEN', exit_time: null, duration_seconds: null, review: 'LEFT_OPEN', work_date: '2026-03-01' })
  const missed = session({ id: 'missed', person_name: 'Mia Missed', status: 'VOIDED', review: 'MISSED_EXIT', work_date: '2026-03-01' })
  const here = session({ id: 'here', person_name: 'Hugo Here', status: 'OPEN', exit_time: null, duration_seconds: null })

  const dashboard = (review: unknown[], open: unknown[]) => ({
    'GET /attendance/sessions': ({ url }: { url: URL }) => ({ body: url.searchParams.get('needs_review') === 'true' ? review : open }),
  })

  it('lists sessions that need review, and does not count them as on site', async () => {
    fakeApi(dashboard([left, missed], [left, here]))
    renderSignedIn('/admin')
    const queue = await screen.findByRole('region', { name: /needs review/i })
    expect(within(queue).getByText('2')).toBeInTheDocument()
    expect(within(queue).getByRole('link', { name: 'Lena Left' })).toHaveAttribute('href', '/admin/sessions/left')
    expect(within(queue).getByText('Left open')).toBeInTheDocument()
    expect(within(queue).getByText('Missed exit')).toBeInTheDocument()
    expect(within(queue).getByRole('link', { name: 'Review all' })).toHaveAttribute('href', '/admin/sessions?review=1')

    const onSite = screen.getByRole('region', { name: /on site now/i })
    expect(within(onSite).getByText('Hugo Here')).toBeInTheDocument()
    expect(within(onSite).queryByText('Lena Left')).not.toBeInTheDocument() // forgot to scan out: not on site
    expect(within(onSite).getByText('1')).toBeInTheDocument()
  })

  it('hides the review card when nothing needs review', async () => {
    fakeApi(dashboard([], [here]))
    renderSignedIn('/admin')
    await screen.findByText('Hugo Here')
    expect(screen.queryByRole('region', { name: /needs review/i })).not.toBeInTheDocument()
  })

  it('says so when nobody is on site', async () => {
    fakeApi(dashboard([], []))
    renderSignedIn('/admin')
    expect(await screen.findByText('Nobody is checked in.')).toBeInTheDocument()
  })

  it('shows an error when the server fails, and links to the main actions', async () => {
    fakeApi({ 'GET /attendance/sessions': () => ({ status: 500, body: { detail: 'Database unavailable' } }) })
    renderSignedIn('/admin')
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable')
    expect(screen.getByRole('link', { name: /add a person and print a badge/i })).toHaveAttribute('href', '/admin/people/new')
    expect(screen.getByRole('link', { name: /browse attendance sessions/i })).toHaveAttribute('href', '/admin/sessions')
  })
})

// ---------------------------------------------------------------------------------- sessions list

describe('sessions list', () => {
  const routes = (rows: unknown[] = [session()]) => ({
    'GET /attendance/sessions': () => ({ body: rows }),
    'GET /person-types': () => ({ body: types }),
    'GET /people/p1': () => ({ body: person() }),
  })

  it('starts with the last 7 days and links each row to its detail', async () => {
    const { to } = fakeApi(routes([session(), session({ id: 's2', person_name: 'Ben Chen', status: 'OPEN', exit_time: null, duration_seconds: null, review: 'LEFT_OPEN' })]))
    renderSignedIn('/admin/sessions')
    const link = await screen.findByRole('link', { name: 'Anna Rivera' })
    expect(link).toHaveAttribute('href', '/admin/sessions/s1')
    expect(screen.getByText('8 h')).toBeInTheDocument()
    expect(screen.getByText('Left open')).toBeInTheDocument()
    expect(screen.getByLabelText('From')).toHaveValue(isoDaysAgo(7))
    expect(params(to('GET', '/attendance/sessions')[0])).toMatchObject({ date_from: isoDaysAgo(7), limit: '26', offset: '0' })
    expect(params(to('GET', '/attendance/sessions')[0]).needs_review).toBeUndefined()
  })

  it('opens the review queue from a link, with no date limit', async () => {
    const { to } = fakeApi(routes())
    renderSignedIn('/admin/sessions?review=1')
    expect(await screen.findByRole('heading', { name: 'Sessions needing review' })).toBeInTheDocument()
    await screen.findByRole('link', { name: 'Anna Rivera' })
    const sent = params(to('GET', '/attendance/sessions')[0])
    expect(sent.needs_review).toBe('true')
    expect(sent.date_from).toBeUndefined()
    expect(screen.getByLabelText('From')).toHaveValue('')
  })

  it('can switch between all sessions and the review queue', async () => {
    const { to } = fakeApi(routes())
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions')
    await user.click(await screen.findByRole('button', { name: 'Show only those needing review' }))
    expect(await screen.findByRole('heading', { name: 'Sessions needing review' })).toBeInTheDocument()
    await waitFor(() => expect(params(to('GET', '/attendance/sessions').at(-1)!).needs_review).toBe('true'))
    await user.click(screen.getByRole('button', { name: 'Show all sessions' }))
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
  })

  it('shows one person when opened from their page, and can go back to everyone', async () => {
    const { to } = fakeApi(routes())
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions?person=p1')
    expect(await screen.findByText('Anna Rivera', { selector: 'strong' })).toBeInTheDocument()
    expect(params(to('GET', '/attendance/sessions')[0]).person_id).toBe('p1')
    await user.click(screen.getByRole('button', { name: 'Show everyone' }))
    await waitFor(() => expect(params(to('GET', '/attendance/sessions').at(-1)!).person_id).toBeUndefined())
  })

  it('filters by type, status and dates', async () => {
    const { to } = fakeApi(routes())
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions')
    await screen.findByRole('link', { name: 'Anna Rivera' })
    const last = () => params(to('GET', '/attendance/sessions').at(-1)!)

    await user.selectOptions(screen.getByLabelText('Type'), 'TEACHER')
    await waitFor(() => expect(last().type).toBe('TEACHER'))
    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED')
    await waitFor(() => expect(last().status).toBe('CLOSED'))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } })
    await waitFor(() => expect(last().date_to).toBe('2026-03-31'))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } })
    await waitFor(() => expect(last().date_from).toBe('2026-03-01'))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } }) // cleared on purpose: no lower limit
    await waitFor(() => expect(last().date_from).toBeUndefined())
  })

  it('pages through results 25 at a time', async () => {
    const many = Array.from({ length: 26 }, (_, i) => session({ id: `s${i}`, person_name: `Person ${i}` }))
    const { to } = fakeApi({
      ...routes(),
      'GET /attendance/sessions': ({ url }) => ({ body: url.searchParams.get('offset') === '0' ? many : [session({ id: 'last', person_name: 'Zed Zimmer' })] }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions')
    await screen.findByRole('link', { name: 'Person 0' })
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('link', { name: 'Zed Zimmer' })).toBeInTheDocument()
    expect(params(to('GET', '/attendance/sessions').at(-1)!).offset).toBe('25')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByRole('link', { name: 'Person 0' })).toBeInTheDocument()
  })

  it('explains an empty list, and an empty review queue', async () => {
    fakeApi(routes([]))
    renderSignedIn('/admin/sessions')
    expect(await screen.findByText('No sessions match these filters.')).toBeInTheDocument()
  })

  it('says so when nothing needs review', async () => {
    fakeApi(routes([]))
    renderSignedIn('/admin/sessions?review=1')
    expect(await screen.findByText('Nothing needs review.')).toBeInTheDocument()
  })

  it('shows an error when loading fails', async () => {
    fakeApi({ ...routes(), 'GET /attendance/sessions': () => ({ status: 500, body: { detail: 'Boom' } }) })
    renderSignedIn('/admin/sessions')
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
  })
})

// ---------------------------------------------------------------------------------- session detail

describe('session detail', () => {
  const audit = [
    { id: 2, actor_id: 'a1', action: 'CORRECT', entity_type: 'attendance_session', entity_id: 's1', reason: 'Forgot to scan out', created_at: '2026-03-03T09:00:00Z' },
    { id: 1, actor_id: null, action: 'UPDATE', entity_type: 'attendance_session', entity_id: 's1', reason: 'Left open past auto-close time', created_at: '2026-03-02T23:00:00Z' },
  ]
  const detailRoutes = (over: Record<string, unknown> = {}, extra: Record<string, never> = {}) => ({
    'GET /attendance/sessions/s1': () => ({ body: sessionDetail(over) }),
    'GET /audit-logs': () => ({ body: audit }),
    ...extra,
  })

  it('shows the summary, the scan events and the change history', async () => {
    const { to } = fakeApi(detailRoutes())
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByRole('heading', { name: 'Session for Anna Rivera' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anna Rivera' })).toHaveAttribute('href', '/admin/people/p1')
    expect(screen.getByText('8 h')).toBeInTheDocument()
    const events = screen.getByRole('region', { name: /scan events/i })
    expect(within(events).getAllByText('Kiosk scan')).toHaveLength(2)
    expect(within(events).getByText('Entry')).toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'History' })
    expect(within(history).getByText('Forgot to scan out')).toBeInTheDocument()
    expect(within(history).getByText('Corrected')).toBeInTheDocument()
    expect(within(history).getByText(/by the system/)).toBeInTheDocument()
    expect(params(to('GET', '/audit-logs')[0])).toMatchObject({ entity_type: 'attendance_session', entity_id: 's1' })
    expect(screen.getByRole('link', { name: /see all of this person's sessions/i })).toHaveAttribute('href', '/admin/sessions?person=p1')
  })

  it('prefills the correction form and saves a correction, then shows the replacement', async () => {
    const { to } = fakeApi({
      ...detailRoutes(),
      'POST /attendance/sessions/s1/correct': () => ({ status: 201, body: sessionDetail({ id: 's2' }) }),
      'GET /attendance/sessions/s2': () => ({ body: sessionDetail({ id: 's2', status: 'CLOSED' }) }),
    })
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions/s1')
    const entry = await screen.findByLabelText('Entry time')
    expect(entry).toHaveValue(toInputValue('2026-03-02T13:00:00Z'))
    expect(screen.getByLabelText('Exit time')).toHaveValue(toInputValue('2026-03-02T21:00:00Z'))
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled() // a reason is required

    fireEvent.change(screen.getByLabelText('Exit time'), { target: { value: '2026-03-02T17:30' } })
    await user.type(screen.getByLabelText('Reason (required)'), '  Left early, badge missed  ')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByText(/correction saved/i)).toBeInTheDocument()
    expect(to('POST', '/attendance/sessions/s1/correct')[0].json).toEqual({
      entry_time: fromInputValue(toInputValue('2026-03-02T13:00:00Z')),
      exit_time: new Date('2026-03-02T17:30').toISOString(),
      reason: 'Left early, badge missed', // trimmed
    })
    expect(to('GET', '/attendance/sessions/s2')).toHaveLength(1) // moved on to the replacement
  })

  it('stops an exit that is not after the entry', async () => {
    const { to } = fakeApi(detailRoutes())
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions/s1')
    await user.type(await screen.findByLabelText('Reason (required)'), 'test')
    fireEvent.change(screen.getByLabelText('Exit time'), { target: { value: '2026-03-02T06:00' } })
    expect(await screen.findByText('The exit must be after the entry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled()
    expect(to('POST', '/attendance/sessions/s1/correct')).toHaveLength(0)
  })

  it.each([
    [409, 'already corrected'],
    [422, 'Check the times'],
    [500, 'Server exploded'],
  ])('explains a %i response and keeps the form', async (status, text) => {
    fakeApi({ ...detailRoutes(), 'POST /attendance/sessions/s1/correct': () => ({ status, body: { detail: 'Server exploded' } }) })
    const user = userEvent.setup()
    renderSignedIn('/admin/sessions/s1')
    await user.type(await screen.findByLabelText('Reason (required)'), 'because')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.getByLabelText('Reason (required)')).toHaveValue('because')
  })

  it('asks for the real exit time of a session that was left open', async () => {
    fakeApi(detailRoutes({ status: 'OPEN', exit_time: null, duration_seconds: null, review: 'LEFT_OPEN', notes: '[FLAGGED: left open past auto-close time]' }))
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByText(/never closed/i)).toBeInTheDocument()
    expect(screen.getByText('Left open', { selector: '.chip' })).toBeInTheDocument()
    expect(screen.getByText(/\[FLAGGED/)).toBeInTheDocument()
    expect(screen.getByLabelText('Exit time')).toHaveValue('') // the admin has to supply it
  })

  it('lets a missed-exit session be rebuilt', async () => {
    fakeApi(detailRoutes({ status: 'VOIDED', exit_time: null, duration_seconds: null, review: 'MISSED_EXIT', notes: '[MISSED EXIT] no exit was scanned' }))
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByText(/to rebuild it/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeInTheDocument()
  })

  it('offers no correction for a session that was already replaced', async () => {
    fakeApi(detailRoutes({ status: 'VOIDED', review: null, notes: null }))
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByText(/voided and replaced/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Entry time')).not.toBeInTheDocument()
  })

  it('still works when the history cannot be loaded', async () => {
    fakeApi({ ...detailRoutes(), 'GET /audit-logs': () => ({ status: 500, body: { detail: 'down' } }) })
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByRole('heading', { name: 'Session for Anna Rivera' })).toBeInTheDocument()
    expect(screen.getByText(/no changes have been recorded/i)).toBeInTheDocument()
  })

  it('says when the session does not exist', async () => {
    fakeApi({
      'GET /attendance/sessions/s1': () => ({ status: 404, body: { detail: 'Session not found' } }),
      'GET /audit-logs': () => ({ body: [] }),
    })
    renderSignedIn('/admin/sessions/s1')
    expect(await screen.findByRole('alert')).toHaveTextContent('not found')
    expect(screen.getByRole('link', { name: 'Back to sessions' })).toBeInTheDocument()
  })
})
