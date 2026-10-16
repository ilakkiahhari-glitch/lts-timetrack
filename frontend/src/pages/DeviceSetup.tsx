import { useState, type FormEvent } from 'react'
import { ApiError, isDeviceKeyError, onSite } from '../api/client'
import { useSession } from '../auth/context'

/** One-time setup: an administrator registers the kiosk (POST /devices) and gives its device key. */
export default function DeviceSetup() {
  const { email, saveDeviceKey, signOut } = useSession()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const candidate = key.trim()
    setBusy(true)
    setError(null)
    try {
      await onSite(candidate) // checks the key and the login together, without recording anything
      saveDeviceKey(candidate)
    } catch (e) {
      if (isDeviceKeyError(e)) setError('That device key was not accepted. Check it and try again.')
      else if (e instanceof ApiError && e.status === 403) setError('This login is not allowed to run a kiosk.')
      else if (e instanceof ApiError && e.status === 0) setError('Cannot reach the server. Check the connection and try again.')
      else setError(e instanceof ApiError ? e.detail : 'Could not verify the key.')
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Set up this kiosk</h1>
        <p className="muted">
          Signed in as {email}. Enter the device key an administrator created for this kiosk. It is stored on this
          device only.
        </p>

        <label htmlFor="device-key">Device key</label>
        <input
          id="device-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          required
          placeholder="dk_…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />

        {error && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Save and start'}
        </button>
        <button type="button" className="btn btn-link" onClick={signOut}>
          Sign out
        </button>
      </form>
    </main>
  )
}
