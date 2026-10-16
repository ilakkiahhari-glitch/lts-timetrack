import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listPeople, listPersonTypes } from '../api/admin'
import type { Person, PersonType } from '../api/types'
import { typeLabel } from '../format'
import { describeError } from './errors'

const PAGE = 25
type Status = 'active' | 'inactive' | 'all'
interface Result {
  key: string
  rows: Person[]
  error: string | null
}

export default function PeopleList() {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState<Status>('active')
  const [page, setPage] = useState(0)
  const [applied, setApplied] = useState({ q: '', group: '' })
  const [types, setTypes] = useState<PersonType[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    let cancelled = false
    listPersonTypes().then((rows) => !cancelled && setTypes(rows), () => undefined) // the filter just stays empty
    return () => {
      cancelled = true
    }
  }, [])

  // Typing waits a moment before searching, and a new search starts from page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setApplied({ q: q.trim(), group: group.trim() })
      setPage(0)
    }, 300)
    return () => clearTimeout(id)
  }, [q, group])

  const key = JSON.stringify([applied, type, status, page])
  useEffect(() => {
    const ticket = ++latest.current
    // One extra row tells us whether a next page exists.
    listPeople({
      q: applied.q, group: applied.group, type, limit: PAGE + 1, offset: page * PAGE,
      active: status === 'all' ? undefined : status === 'active',
    }).then(
      (rows) => ticket === latest.current && setResult({ key, rows, error: null }),
      (e: unknown) => ticket === latest.current && setResult({ key, rows: [], error: describeError(e) }),
    )
  }, [key, applied, type, status, page])

  const loading = result?.key !== key
  const rows = result?.rows.slice(0, PAGE) ?? []
  const hasNext = (result?.rows.length ?? 0) > PAGE
  const filtered = Boolean(applied.q || applied.group || type || status !== 'active')

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">People</h1>
        <div className="actions">
          <Link to="/admin/people/types" className="btn">Person types</Link>
          <Link to="/admin/people/new" className="btn btn-primary">Add person</Link>
        </div>
      </div>

      <form className="filters card" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="q">Search</label>
          <input id="q" type="search" placeholder="Name, code or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="type">Type</label>
          <select id="type" value={type} onChange={(e) => { setType(e.target.value); setPage(0) }}>
            <option value="">All types</option>
            {types.map((t) => <option key={t.code} value={t.code}>{t.display_name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="group">Group</label>
          <input id="group" placeholder="Department or class" value={group} onChange={(e) => setGroup(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(0) }}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </form>

      {result?.error && <p className="form-error" role="alert">{result.error}</p>}

      <div className="card table-card" aria-busy={loading}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Code</th><th>Type</th><th>Group</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/admin/people/${p.id}`} className="strong">{p.last_name}, {p.first_name}</Link></td>
                  <td>{p.external_code}</td>
                  <td>{typeLabel(p.person_type)}</td>
                  <td>{p.group_name ?? <span className="muted">–</span>}</td>
                  <td><span className={`chip ${p.is_active ? 'chip-ok' : 'chip-off'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !result?.error && rows.length === 0 && (
          <p className="empty">
            {filtered ? 'No one matches these filters.' : 'No people yet. '}
            {!filtered && <Link to="/admin/people/new">Add the first person.</Link>}
          </p>
        )}
        {loading && rows.length === 0 && <p className="empty muted">Loading…</p>}
        <div className="pager">
          <button type="button" className="btn btn-small" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page + 1}</span>
          <button type="button" className="btn btn-small" disabled={!hasNext || loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </>
  )
}
