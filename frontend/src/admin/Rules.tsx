import { useEffect, useState, type FormEvent } from 'react'
import { getRule, listPersonTypes, saveRule } from '../api/admin'
import type { PersonType, Rule } from '../api/types'
import { describeError } from './errors'

/** "08:30:00" -> "08:30" for a time input; "" when unset. */
const toTime = (value: string | null) => (value ? value.slice(0, 5) : '')
/** "08:30" -> "08:30:00" for the API; null when empty. */
const fromTime = (value: string) => (value ? `${value}:00` : null)

interface Loaded {
  type: string
  rule: Rule | null
  error: string | null
}

export default function Rules() {
  const [types, setTypes] = useState<PersonType[]>([])
  const [type, setType] = useState('')
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [typesError, setTypesError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listPersonTypes().then(
      (rows) => {
        if (cancelled) return
        setTypes(rows)
        setType((current) => current || (rows.find((t) => t.code === 'TEACHER') ?? rows[0])?.code || '')
      },
      (e: unknown) => !cancelled && setTypesError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!type) return
    let cancelled = false
    getRule(type).then(
      (rule) => !cancelled && setLoaded({ type, rule, error: null }),
      (e: unknown) => !cancelled && setLoaded({ type, rule: null, error: describeError(e, { 404: 'This person type has no rules yet.' }) }),
    )
    return () => {
      cancelled = true
    }
  }, [type])

  const current = loaded?.type === type ? loaded : null

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Attendance rules</h1>
      </div>
      <p className="muted">Rules are set for each type of person. Changes apply to the next scan.</p>

      {typesError && <p className="form-error" role="alert">{typesError}</p>}

      <div className="card form">
        <div className="field narrow">
          <label htmlFor="rule-type">Person type</label>
          <select id="rule-type" value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => <option key={t.code} value={t.code}>{t.display_name}</option>)}
          </select>
        </div>
      </div>

      {!current && type && <p className="muted" role="status">Loading…</p>}
      {current?.error && <p className="form-error" role="alert">{current.error}</p>}
      {/* keyed by type only: saving must not remount the form, or the "Saved" message would vanish */}
      {current?.rule && <RuleForm key={current.type} rule={current.rule} onSaved={(rule) => setLoaded({ type, rule, error: null })} />}
    </>
  )
}

function RuleForm({ rule, onSaved }: { rule: Rule; onSaved: (rule: Rule) => void }) {
  const [window_, setWindow] = useState(String(rule.duplicate_window_seconds))
  const [autoClose, setAutoClose] = useState(toTime(rule.auto_close_time))
  const [lateAfter, setLateAfter] = useState(toTime(rule.late_after_time))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const seconds = Number(window_)
  const valid = window_ !== '' && Number.isInteger(seconds) && seconds >= 0
  const dirty =
    window_ !== String(rule.duplicate_window_seconds) ||
    autoClose !== toTime(rule.auto_close_time) ||
    lateAfter !== toTime(rule.late_after_time)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await saveRule(rule.person_type, {
        duplicate_window_seconds: seconds,
        auto_close_time: fromTime(autoClose),
        late_after_time: fromTime(lateAfter),
      }))
      setSaved(true)
    } catch (e) {
      setError(describeError(e, { 422: 'Check the values: the duplicate window must be a whole number of seconds, 0 or more.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Rules for {rule.person_type.toLowerCase().replace(/_/g, ' ')}</h2>

      <div className="rule">
        <div className="field narrow">
          <label htmlFor="window">Duplicate scan window (seconds)</label>
          <input id="window" type="number" min={0} step={1} inputMode="numeric" value={window_} aria-invalid={!valid}
            onChange={(e) => { setWindow(e.target.value); setSaved(false) }} aria-describedby="window-help" />
        </div>
        <p id="window-help" className="help">
          A second scan within this many seconds is ignored as a duplicate. Use 0 to allow an exit straight after an
          entry (handy for testing).
        </p>
        {!valid && <p className="field-error">Enter a whole number, 0 or more.</p>}
      </div>

      <div className="rule">
        <div className="field narrow">
          <label htmlFor="auto-close">Auto-close time (optional)</label>
          <input id="auto-close" type="time" value={autoClose} onChange={(e) => { setAutoClose(e.target.value); setSaved(false) }} aria-describedby="auto-close-help" />
        </div>
        <p id="auto-close-help" className="help">
          After this time (school time) a session that was never closed counts as <strong>left open</strong>: it is
          flagged for review overnight, and a later scan starts a new entry instead of closing it. Leave empty to treat a
          session as left open once its day has ended.
        </p>
      </div>

      <div className="rule">
        <div className="field narrow">
          <label htmlFor="late-after">Late after (optional)</label>
          <input id="late-after" type="time" value={lateAfter} onChange={(e) => { setLateAfter(e.target.value); setSaved(false) }} aria-describedby="late-help" />
        </div>
        <p id="late-help" className="help">
          A person whose first entry of the day is after this time (school time) counts as late in the reports. Leave
          empty to not track lateness for this type.
        </p>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && !dirty && <p className="form-ok" role="status">Saved. The new rules apply from the next scan.</p>}

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty || !valid}>{busy ? 'Saving…' : 'Save rules'}</button>
      </div>
    </form>
  )
}
