import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getPerson, listPersonTypes, listSessions } from '../api/admin'
import type { PersonType, SessionSummary } from '../api/types'
import { ReviewChip, StatusChip } from '../components/SessionChips'
import { formatWorkDate, isoDaysAgo } from '../dates'
import { formatDuration, formatTime, typeLabel } from '../format'
import { describeError } from './errors'

const PAGE = 25
type StatusFilter = SessionSummary['status'] | ''
interface Result {
  key: string
  rows: SessionSummary[]
  error: string | null
}

export default function Sessions() {
  const [params, setParams] = useSearchParams()
  const [types, setTypes] = useState<PersonType[]>([])
  const [named, setNamed] = useState<{ id: string; name: string } | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const latest = useRef(0)

  // The filters live in the address, so a link (like the dashboard's "needs review") opens a ready-made view.
  const review = params.get('review') === '1'
  const person = params.get('person') ?? ''
  const type = params.get('type') ?? ''
  const status = (params.get('status') ?? '') as StatusFilter
  // Without dates the list starts at the last 7 days, except in the review queue, which has no date limit.
  const from = params.get('from') ?? (review ? '' : isoDaysAgo(7))
  const to = params.get('to') ?? ''
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)

  function change(updates: Record<string, string | null>, keepPage = false) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key)
      else next.set(key, value) // an empty string is kept on purpose: it means "no limit" and stops the default
    }
    if (!keepPage) next.delete('page')
    setParams(next, { replace: true })
  }

  useEffect(() => {
    let cancelled = false
    listPersonTypes().then((rows) => !cancelled && setTypes(rows), () => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!person) return
    let cancelled = false
    getPerson(person).then(
      (p) => !cancelled && setNamed({ id: person, name: `${p.first_name} ${p.last_name}` }),
      () => !cancelled && setNamed({ id: person, name: 'this person' }),
    )
    return () => {
      cancelled = true
    }
  }, [person])
  const personName = named?.id === person ? named.name : null

  const key = JSON.stringify([review, person, type, status, from, to, page])
  useEffect(() => {
    const ticket = ++latest.current
    listSessions({
      personId: person || undefined, type: type || undefined, status: status || undefined,
      dateFrom: from || undefined, dateTo: to || undefined, needsReview: review,
      limit: PAGE + 1, offset: page * PAGE, // one extra row tells us whether a next page exists
    }).then(
      (rows) => ticket === latest.current && setResult({ key, rows, error: null }),
      (e: unknown) => ticket === latest.current && setResult({ key, rows: [], error: describeError(e) }),
    )
  }, [key, review, person, type, status, from, to, page])

  const loading = result?.key !== key
  const rows = result?.rows.slice(0, PAGE) ?? []
  const hasNext = (result?.rows.length ?? 0) > PAGE

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{review ? 'Sessions needing review' : 'Sessions'}</h1>
        {review ? (
          <button type="button" className="btn" onClick={() => change({ review: null })}>Show all sessions</button>
        ) : (
          <button type="button" className="btn" onClick={() => change({ review: '1' })}>Show only those needing review</button>
        )}
      </div>

      {review && (
        <p className="notice">
          These sessions were left open past their cutoff, or were voided because a new entry was scanned after a
          missed exit. Open one and enter the real times to fix it.
        </p>
      )}

      {person && (
        <p className="filter-chip">
          Showing one person: <strong>{personName ?? '…'}</strong>
          <button type="button" className="btn btn-small" onClick={() => change({ person: null })}>Show everyone</button>
        </p>
      )}

      <form className="filters card" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" type="date" value={from} max={to || undefined} onChange={(e) => change({ from: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" type="date" value={to} min={from || undefined} onChange={(e) => change({ to: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" value={type} onChange={(e) => change({ type: e.target.value || null })}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.code} value={t.code}>{t.display_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => change({ status: e.target.value || null })}>
            <option value="">Any status</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
            <option value="VOIDED">Voided</option>
          </select>
        </div>
      </form>

      {result?.error && <p className="form-error" role="alert">{result.error}</p>}

      <div className="card table-card" aria-busy={loading}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Person</th><th>Type</th><th>In</th><th>Out</th><th>Time on site</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{formatWorkDate(s.work_date)}</td>
                  <td><Link to={`/admin/sessions/${s.id}`} className="strong">{s.person_name}</Link></td>
                  <td>{typeLabel(s.person_type)}</td>
                  <td>{formatTime(s.entry_time)}</td>
                  <td>{s.exit_time ? formatTime(s.exit_time) : <span className="muted">–</span>}</td>
                  <td>{s.duration_seconds !== null ? formatDuration(s.duration_seconds) : <span className="muted">–</span>}</td>
                  <td className="chips"><StatusChip status={s.status} /> <ReviewChip reason={s.review} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !result?.error && rows.length === 0 && (
          <p className="empty">{review ? 'Nothing needs review.' : 'No sessions match these filters.'}</p>
        )}
        {loading && rows.length === 0 && <p className="empty muted">Loading…</p>}
        <div className="pager">
          <button type="button" className="btn btn-small" disabled={page === 0 || loading} onClick={() => change({ page: String(page - 1) }, true)}>Previous</button>
          <span className="muted">Page {page + 1}</span>
          <button type="button" className="btn btn-small" disabled={!hasNext || loading} onClick={() => change({ page: String(page + 1) }, true)}>Next</button>
        </div>
      </div>
    </>
  )
}
