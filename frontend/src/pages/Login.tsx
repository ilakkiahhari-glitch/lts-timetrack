import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { useSession } from '../auth/context'

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Wrong email or password.'
    if (e.status === 403) return 'This account is temporarily locked after too many failed attempts. Try again in a few minutes.'
    if (e.status === 429) return `Too many attempts. Please wait${e.retryAfter ? ` ${e.retryAfter} seconds` : ' a moment'} and try again.`
    if (e.status === 422) return 'Enter a valid email address and password.'
    if (e.status === 0) return 'Cannot reach the server. Check the connection and try again.'
    return e.detail
  }
  return 'Sign-in failed. Please try again.'
}

export default function Login() {
  const { signIn } = useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
    } catch (e) {
      setError(messageFor(e))
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>LTS TimeTrack</h1>
        <p className="muted">Sign in as a volunteer scanner operator to start the kiosk.</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="form-error" role="alert">{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
