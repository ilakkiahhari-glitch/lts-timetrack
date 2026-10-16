import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listOpenSessions } from '../api/admin'
import type { SessionSummary } from '../api/types'
import { formatTime, typeLabel } from '../format'
import { describeError } from './errors'

const SHOWN = 10

export default function Dashboard() {
  const [open, setOpen] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listOpenSessions().then(
      (rows) => !cancelled && setOpen(rows),
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <h1 className="page-title">Dashboard</h1>

      <div className="grid-2">
        <section className="card" aria-labelledby="onsite-heading">
          <h2 id="onsite-heading">
            On site now <span className="count">{open ? open.length : '–'}</span>
          </h2>
          {error && <p className="form-error" role="alert">{error}</p>}
          {open && open.length === 0 && <p className="muted">Nobody is checked in.</p>}
          <ul className="plain-list">
            {open?.slice(0, SHOWN).map((s) => (
              <li key={s.id}>
                <span className="strong">{s.person_name}</span>
                <span className="chip">{typeLabel(s.person_type)}</span>
                {s.notes && <span className="chip chip-warn">Needs review</span>}
                <span className="muted since">since {formatTime(s.entry_time)}</span>
              </li>
            ))}
          </ul>
          {open && open.length > SHOWN && <p className="muted">…and {open.length - SHOWN} more.</p>}
        </section>

        <section className="card" aria-labelledby="actions-heading">
          <h2 id="actions-heading">Quick actions</h2>
          <div className="stack">
            <Link to="/admin/people/new" className="btn btn-primary">Add a person and print a badge</Link>
            <Link to="/admin/people" className="btn">Find or edit people</Link>
            <Link to="/kiosk" className="btn">Open the kiosk screen</Link>
          </div>
        </section>
      </div>
    </>
  )
}
