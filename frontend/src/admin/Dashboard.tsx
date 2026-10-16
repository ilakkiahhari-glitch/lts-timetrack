import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listSessions } from '../api/admin'
import type { SessionSummary } from '../api/types'
import { ReviewChip } from '../components/SessionChips'
import { formatTime, typeLabel } from '../format'
import { describeError } from './errors'

const SHOWN = 10
const REVIEW_SHOWN = 5

export default function Dashboard() {
  const [open, setOpen] = useState<SessionSummary[] | null>(null)
  const [review, setReview] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      listSessions({ status: 'OPEN', limit: 500, offset: 0 }),
      listSessions({ needsReview: true, limit: 500, offset: 0 }),
    ]).then(
      ([openRows, reviewRows]) => {
        if (cancelled) return
        setOpen(openRows)
        setReview(reviewRows)
      },
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  // A session left open past its cutoff is not "on site": it is in the review queue instead.
  const onSite = open?.filter((s) => s.review !== 'LEFT_OPEN') ?? null

  return (
    <>
      <h1 className="page-title">Dashboard</h1>

      {error && <p className="form-error" role="alert">{error}</p>}

      {review && review.length > 0 && (
        <section className="card review-card" aria-labelledby="review-heading">
          <div className="form-head">
            <h2 id="review-heading">
              Needs review <span className="count count-warn">{review.length}</span>
            </h2>
            <Link to="/admin/sessions?review=1" className="btn btn-small">Review all</Link>
          </div>
          <p className="muted">Someone forgot to scan out. Open each one and enter the real times.</p>
          <ul className="plain-list">
            {review.slice(0, REVIEW_SHOWN).map((s) => (
              <li key={s.id}>
                <Link to={`/admin/sessions/${s.id}`} className="strong">{s.person_name}</Link>
                <span className="chip">{typeLabel(s.person_type)}</span>
                <ReviewChip reason={s.review} />
                <span className="muted since">{s.work_date}</span>
              </li>
            ))}
          </ul>
          {review.length > REVIEW_SHOWN && <p className="muted">…and {review.length - REVIEW_SHOWN} more.</p>}
        </section>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="onsite-heading">
          <h2 id="onsite-heading">
            On site now <span className="count">{onSite ? onSite.length : '–'}</span>
          </h2>
          {onSite && onSite.length === 0 && <p className="muted">Nobody is checked in.</p>}
          <ul className="plain-list">
            {onSite?.slice(0, SHOWN).map((s) => (
              <li key={s.id}>
                <Link to={`/admin/sessions/${s.id}`} className="strong">{s.person_name}</Link>
                <span className="chip">{typeLabel(s.person_type)}</span>
                <span className="muted since">since {formatTime(s.entry_time)}</span>
              </li>
            ))}
          </ul>
          {onSite && onSite.length > SHOWN && <p className="muted">…and {onSite.length - SHOWN} more.</p>}
        </section>

        <section className="card" aria-labelledby="actions-heading">
          <h2 id="actions-heading">Quick actions</h2>
          <div className="stack">
            <Link to="/admin/people/new" className="btn btn-primary">Add a person and print a badge</Link>
            <Link to="/admin/people" className="btn">Find or edit people</Link>
            <Link to="/admin/sessions" className="btn">Browse attendance sessions</Link>
            <Link to="/kiosk" className="btn">Open the kiosk screen</Link>
          </div>
        </section>
      </div>
    </>
  )
}
