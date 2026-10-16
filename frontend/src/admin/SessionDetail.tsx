import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { correctSession, getSession, listAuditLogs } from '../api/admin'
import type { AuditEntry, SessionDetail as Detail } from '../api/types'
import { ReviewChip, StatusChip } from '../components/SessionChips'
import { browserTimeZone, formatDateTime, formatWorkDate, fromInputValue, toInputValue } from '../dates'
import { formatDuration, typeLabel } from '../format'
import { describeError } from './errors'

const SOURCE = { KIOSK: 'Kiosk scan', ADMIN_CORRECTION: 'Admin correction', SYSTEM: 'System' } as const
const ACTION: Record<string, string> = { CORRECT: 'Corrected', UPDATE: 'Updated', CREATE: 'Created' }

export default function SessionDetail() {
  const { id = '' } = useParams()
  const corrected = (useLocation().state as { corrected?: boolean } | null)?.corrected === true
  const [loaded, setLoaded] = useState<{ id: string; session: Detail | null; history: AuditEntry[]; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([getSession(id), listAuditLogs({ entityType: 'attendance_session', entityId: id })]).then(
      ([session, history]) => {
        if (cancelled) return
        setLoaded({
          id,
          session: session.status === 'fulfilled' ? session.value : null,
          history: history.status === 'fulfilled' ? history.value : [], // the history is a bonus; the page works without it
          error: session.status === 'rejected' ? describeError(session.reason, { 404: 'This session was not found.' }) : null,
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])

  if (loaded?.id === id && loaded.error) {
    return (
      <>
        <p className="form-error" role="alert">{loaded.error}</p>
        <Link to="/admin/sessions" className="btn">Back to sessions</Link>
      </>
    )
  }
  if (loaded?.id !== id || !loaded.session) return <p className="muted" role="status">Loading…</p>

  const { session, history } = loaded
  const canCorrect = session.status !== 'VOIDED' || session.review === 'MISSED_EXIT'

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Session for {session.person_name}</h1>
        <Link to="/admin/sessions" className="btn">Back to sessions</Link>
      </div>

      {corrected && (
        <p className="form-ok" role="status">
          Correction saved. The original session was voided and stays on record in the history below.
        </p>
      )}

      <section className="card" aria-labelledby="summary-title">
        <div className="form-head">
          <h2 id="summary-title">Summary</h2>
          <span className="chips"><StatusChip status={session.status} /> <ReviewChip reason={session.review} /></span>
        </div>
        <dl className="facts">
          <div><dt>Person</dt><dd><Link to={`/admin/people/${session.person_id}`}>{session.person_name}</Link> ({session.external_code})</dd></div>
          <div><dt>Type</dt><dd>{typeLabel(session.person_type)}</dd></div>
          <div><dt>Date</dt><dd>{formatWorkDate(session.work_date)}</dd></div>
          <div><dt>In</dt><dd>{formatDateTime(session.entry_time)}</dd></div>
          <div><dt>Out</dt><dd>{session.exit_time ? formatDateTime(session.exit_time) : 'Not yet'}</dd></div>
          <div><dt>Time on site</dt><dd>{session.duration_seconds !== null ? formatDuration(session.duration_seconds) : '–'}</dd></div>
        </dl>
        {session.notes && <p className="notice">{session.notes}</p>}
        <p><Link to={`/admin/sessions?person=${session.person_id}`}>See all of this person's sessions</Link></p>
      </section>

      <section className="card table-card" aria-labelledby="events-title">
        <h2 id="events-title" className="card-title">Scan events</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Event</th><th>Source</th></tr></thead>
            <tbody>
              {session.events.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.event_time)}</td>
                  <td>{e.event_type === 'ENTRY' ? 'Entry' : 'Exit'}</td>
                  <td>{SOURCE[e.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {session.events.length === 0 && <p className="empty muted">No events.</p>}
      </section>

      {canCorrect ? (
        <CorrectionForm session={session} />
      ) : (
        <section className="card">
          <h2>Correction</h2>
          <p className="muted">
            This session was voided and replaced, so it can no longer be corrected. Open the replacement from the
            person's sessions.
          </p>
        </section>
      )}

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title">History</h2>
        {history.length === 0 && <p className="muted">No changes have been recorded for this session.</p>}
        <ul className="plain-list">
          {history.map((h) => (
            <li key={h.id}>
              <span className="strong">{ACTION[h.action] ?? h.action}</span>
              <span className="muted">{formatDateTime(h.created_at)}{h.actor_id ? '' : ' by the system'}</span>
              {h.reason && <span className="reason">{h.reason}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function CorrectionForm({ session }: { session: Detail }) {
  const navigate = useNavigate()
  const [entry, setEntry] = useState(toInputValue(session.entry_time))
  const [exit, setExit] = useState(toInputValue(session.exit_time))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orderProblem = entry && exit && new Date(exit) <= new Date(entry)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (orderProblem) return
    setBusy(true)
    setError(null)
    try {
      const replacement = await correctSession(session.id, {
        entry_time: fromInputValue(entry),
        exit_time: fromInputValue(exit),
        reason: reason.trim(),
      })
      navigate(`/admin/sessions/${replacement.id}`, { state: { corrected: true } })
    } catch (e) {
      setError(describeError(e, {
        409: 'This session was already corrected. Reload the page.',
        422: 'Check the times (the exit must be after the entry) and give a reason.',
      }))
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit} aria-labelledby="correct-title">
      <h2 id="correct-title">Correct this session</h2>
      {session.review === 'LEFT_OPEN' && (
        <p className="notice">This session was never closed. Enter when the person actually left.</p>
      )}
      {session.review === 'MISSED_EXIT' && (
        <p className="notice">
          A new entry was scanned after this session was left open, so it was voided. Enter the real entry and exit
          times to rebuild it. This can be done once.
        </p>
      )}
      <p className="muted">
        This voids the current session and creates a corrected one. The original scans and this correction stay on
        record. Times are in your browser's time zone ({browserTimeZone()}).
      </p>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="entry">Entry time</label>
          <input id="entry" type="datetime-local" required value={entry} onChange={(e) => setEntry(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="exit">Exit time</label>
          <input id="exit" type="datetime-local" required value={exit} onChange={(e) => setExit(e.target.value)} aria-invalid={Boolean(orderProblem)} />
          {orderProblem && <p className="field-error">The exit must be after the entry.</p>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="reason">Reason (required)</label>
        <textarea id="reason" required rows={3} placeholder="For example: forgot to scan out" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !entry || !exit || !reason.trim() || Boolean(orderProblem)}>
          {busy ? 'Saving…' : 'Save correction'}
        </button>
      </div>
    </form>
  )
}
