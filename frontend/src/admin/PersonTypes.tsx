import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createPersonType, listPersonTypes } from '../api/admin'
import type { PersonType } from '../api/types'
import { describeError } from './errors'

export default function PersonTypes() {
  const [types, setTypes] = useState<PersonType[] | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listPersonTypes().then(
      (rows) => !cancelled && setTypes(rows),
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function add(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await createPersonType(code.trim(), name.trim())
      setTypes((current) => [...(current ?? []), created].sort((a, b) => a.code.localeCompare(b.code)))
      setCode('')
      setName('')
    } catch (e) {
      setError(describeError(e, {
        409: 'That person type already exists.',
        422: 'The code must start with a letter and use only letters, numbers and underscores (2 to 32 characters).',
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Person types</h1>
        <Link to="/admin/people" className="btn">Back to people</Link>
      </div>

      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
            <tbody>
              {types?.map((t) => (
                <tr key={t.code}>
                  <td>{t.code}</td>
                  <td>{t.display_name}</td>
                  <td><span className={`chip ${t.is_active ? 'chip-ok' : 'chip-off'}`}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!types && !error && <p className="empty muted">Loading…</p>}
      </div>

      <form className="card form" onSubmit={add}>
        <h2>Add a person type</h2>
        <p className="muted">For example VOLUNTEER or CONTRACTOR. It starts with the standard attendance rules (30-second duplicate window).</p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="type-code">Code</label>
            <input id="type-code" required placeholder="CONTRACTOR" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="type-name">Display name</label>
            <input id="type-name" required placeholder="Contractor" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add type'}</button>
        </div>
      </form>
    </>
  )
}
