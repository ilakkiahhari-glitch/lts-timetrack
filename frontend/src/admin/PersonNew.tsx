import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createPerson, listPersonTypes } from '../api/admin'
import type { PersonType, PersonWithQr } from '../api/types'
import { IssuedBadge } from '../components/Badge'
import KeyValueEditor from '../components/KeyValueEditor'
import { describeError } from './errors'

export default function PersonNew() {
  const [types, setTypes] = useState<PersonType[]>([])
  const [personType, setPersonType] = useState('')
  const [code, setCode] = useState('')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [group, setGroup] = useState('')
  const [attributes, setAttributes] = useState<Record<string, unknown>>({})
  const [formKey, setFormKey] = useState(0) // changing it clears the details editor for "add another"
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<PersonWithQr | null>(null)

  useEffect(() => {
    let cancelled = false
    listPersonTypes().then(
      (rows) => {
        if (cancelled) return
        const active = rows.filter((t) => t.is_active)
        setTypes(active)
        setPersonType((current) => current || (active.find((t) => t.code === 'TEACHER') ?? active[0])?.code || '')
      },
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setIssued(
        await createPerson({
          person_type: personType,
          external_code: code.trim(),
          first_name: first.trim(),
          last_name: last.trim(),
          email: email.trim() || null,
          group_name: group.trim() || null,
          attributes,
        }),
      )
    } catch (e) {
      setError(describeError(e, { 409: 'A person of this type with that code already exists.', 422: 'Check the details: the type, code, names and email must be valid.' }))
    } finally {
      setBusy(false)
    }
  }

  function addAnother() {
    setIssued(null)
    setCode('')
    setFirst('')
    setLast('')
    setEmail('')
    setGroup('')
    setAttributes({})
    setFormKey((n) => n + 1)
  }

  if (issued) {
    return (
      <>
        <h1 className="page-title">Person added</h1>
        <IssuedBadge
          heading={`${issued.first_name} ${issued.last_name} is registered`}
          name={`${issued.first_name} ${issued.last_name}`}
          personType={issued.person_type}
          code={issued.external_code}
          qrImage={issued.qr_image}
          token={issued.qr_token}
        />
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={addAnother}>Add another person</button>
          <Link to={`/admin/people/${issued.id}`} className="btn">View person</Link>
          <Link to="/admin/people" className="btn">Back to the list</Link>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Add a person</h1>
        <Link to="/admin/people" className="btn">Cancel</Link>
      </div>
      <form className="card form" onSubmit={submit}>
        <p className="muted">Saving creates the person and a one-time QR badge you can print straight away.</p>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="person-type">Type</label>
            <select id="person-type" required value={personType} onChange={(e) => setPersonType(e.target.value)}>
              {types.map((t) => <option key={t.code} value={t.code}>{t.display_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="code">Employee or ID number</label>
            <input id="code" required value={code} onChange={(e) => setCode(e.target.value)} aria-describedby="code-help" />
            <p id="code-help" className="help">Cannot be changed later. Must be unique within the type.</p>
          </div>
          <div className="field">
            <label htmlFor="first">First name</label>
            <input id="first" required autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="last">Last name</label>
            <input id="last" required autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email (optional)</label>
            <input id="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="group-name">Group (optional)</label>
            <input id="group-name" placeholder="Department or class" value={group} onChange={(e) => setGroup(e.target.value)} />
          </div>
        </div>

        <KeyValueEditor key={formKey} initial={{}} onChange={setAttributes} />

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !personType}>
            {busy ? 'Saving…' : 'Save and create badge'}
          </button>
        </div>
      </form>
    </>
  )
}
