import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPerson, getQrImage, rotateQr, updatePerson } from '../api/admin'
import { ApiError } from '../api/client'
import type { Person, PersonWithQr } from '../api/types'
import { BadgeCard, IssuedBadge } from '../components/Badge'
import KeyValueEditor from '../components/KeyValueEditor'
import { typeLabel } from '../format'
import { describeError } from './errors'

const stable = (value: Record<string, unknown>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
const fullName = (p: Pick<Person, 'first_name' | 'last_name'>) => `${p.first_name} ${p.last_name}`

export default function PersonDetail() {
  const { id = '' } = useParams()
  const [person, setPerson] = useState<Person | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [issued, setIssued] = useState<PersonWithQr | null>(null)
  const [fresh, setFresh] = useState<string | null>(null) // object URL of a still-available QR image

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    getPerson(id).then(
      (p) => !cancelled && setPerson(p),
      (e: unknown) => !cancelled && setLoadError(describeError(e, { 404: 'This person was not found.' })),
    )
    // Only works for a short time after a QR was issued; otherwise the badge cannot be reprinted.
    getQrImage(id).then(
      (blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setFresh(url)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [id])

  if (loadError) {
    return (
      <>
        <p className="form-error" role="alert">{loadError}</p>
        <Link to="/admin/people" className="btn">Back to the list</Link>
      </>
    )
  }
  if (!person) return <p className="muted" role="status">Loading…</p>

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{fullName(person)}</h1>
        <Link to="/admin/people" className="btn">Back to the list</Link>
      </div>

      <PersonEditor key={person.id} person={person} onUpdated={setPerson} />

      <QrSection
        person={person}
        issued={issued}
        fresh={issued ? null : fresh}
        onRotated={(next) => {
          setPerson(next)
          setIssued(next)
          setFresh(null)
        }}
      />
    </>
  )
}

function PersonEditor({ person, onUpdated }: { person: Person; onUpdated: (p: Person) => void }) {
  const [first, setFirst] = useState(person.first_name)
  const [last, setLast] = useState(person.last_name)
  const [email, setEmail] = useState(person.email ?? '')
  const [group, setGroup] = useState(person.group_name ?? '')
  const [attributes, setAttributes] = useState(person.attributes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    first.trim() !== person.first_name || last.trim() !== person.last_name ||
    email.trim() !== (person.email ?? '') || group.trim() !== (person.group_name ?? '') ||
    stable(attributes) !== stable(person.attributes)

  async function run(change: Parameters<typeof updatePerson>[1]) {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      onUpdated(await updatePerson(person.id, change))
      setSaved(true)
    } catch (e) {
      setError(describeError(e, { 422: 'Check the details: names must not be empty and the email must be valid.' }))
    } finally {
      setBusy(false)
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    await run({
      first_name: first.trim(),
      last_name: last.trim(),
      email: email.trim() || null,
      group_name: group.trim() || null,
      attributes,
    })
  }

  function toggleActive() {
    if (person.is_active && !window.confirm(`Deactivate ${fullName(person)}? Their badge stops working. Their attendance history is kept.`)) return
    void run({ is_active: !person.is_active })
  }

  return (
    <form className="card form" onSubmit={save}>
      <div className="form-head">
        <h2>Details</h2>
        <span className={`chip ${person.is_active ? 'chip-ok' : 'chip-off'}`}>{person.is_active ? 'Active' : 'Inactive'}</span>
      </div>

      <dl className="facts">
        <div><dt>Type</dt><dd>{typeLabel(person.person_type)}</dd></div>
        <div><dt>ID number</dt><dd>{person.external_code}</dd></div>
        <div><dt>Registered</dt><dd>{new Date(person.created_at).toLocaleDateString()}</dd></div>
      </dl>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="first">First name</label>
          <input id="first" required value={first} onChange={(e) => { setFirst(e.target.value); setSaved(false) }} />
        </div>
        <div className="field">
          <label htmlFor="last">Last name</label>
          <input id="last" required value={last} onChange={(e) => { setLast(e.target.value); setSaved(false) }} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false) }} />
        </div>
        <div className="field">
          <label htmlFor="group-name">Group</label>
          <input id="group-name" value={group} onChange={(e) => { setGroup(e.target.value); setSaved(false) }} />
        </div>
      </div>

      <KeyValueEditor initial={person.attributes} onChange={(next) => { setAttributes(next); setSaved(false) }} />

      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && !dirty && <p className="form-ok" role="status">Saved.</p>}

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className={`btn ${person.is_active ? 'btn-danger' : ''}`} disabled={busy} onClick={toggleActive}>
          {person.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </form>
  )
}

function QrSection({
  person, issued, fresh, onRotated,
}: { person: Person; issued: PersonWithQr | null; fresh: string | null; onRotated: (p: PersonWithQr) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function rotate() {
    if (!window.confirm(`Issue a new QR code for ${fullName(person)}? The current badge stops working immediately.`)) return
    setBusy(true)
    setError(null)
    try {
      onRotated(await rotateQr(person.id))
    } catch (e) {
      setError(e instanceof ApiError ? describeError(e) : 'Could not issue a new QR code.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {issued && (
        <IssuedBadge
          heading="New QR badge issued"
          name={fullName(issued)}
          personType={issued.person_type}
          code={issued.external_code}
          qrImage={issued.qr_image}
          token={issued.qr_token}
        />
      )}

      {fresh && (
        <section className="card issued" aria-labelledby="reprint-title">
          <h2 id="reprint-title">Badge available to print</h2>
          <p className="notice">This badge was issued a moment ago and can still be printed. It will not be available later.</p>
          <BadgeCard name={fullName(person)} personType={person.person_type} code={person.external_code} qrImage={fresh} />
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print badge</button>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="qr-title">
        <h2 id="qr-title">QR code</h2>
        <p>
          Version {person.qr_version}, issued {new Date(person.qr_issued_at).toLocaleString()}.
        </p>
        {!issued && !fresh && (
          <p className="muted">
            For security the QR code is not stored, so it cannot be shown again. If a badge is lost or damaged, issue a
            new one.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" className="btn" disabled={busy || !person.is_active} onClick={() => void rotate()}>
            {busy ? 'Issuing…' : 'Issue a new QR code'}
          </button>
        </div>
        {!person.is_active && <p className="help">Reactivate this person before issuing a new QR code.</p>}
      </section>
    </>
  )
}
