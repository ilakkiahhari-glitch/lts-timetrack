import { useEffect, useState, type FormEvent } from 'react'
import { createUser, listUsers, updateUser } from '../api/admin'
import type { User, UserRole, UserUpdate } from '../api/types'
import { useSession } from '../auth/context'
import { formatDateTime } from '../dates'
import { generatePassword } from '../password'
import { describeError } from './errors'

const ROLE: Record<UserRole, string> = { ADMIN: 'Admin', VOLUNTEER: 'Volunteer' }
const byName = (a: User, b: User) => a.full_name.localeCompare(b.full_name)
const MIN_PASSWORD = 8

type Mode = { id: string; kind: 'edit' | 'password' } | null

export default function Users() {
  const { email: myEmail } = useSession()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listUsers().then(
      (rows) => !cancelled && setUsers(rows.sort(byName)),
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const isMe = (u: User) => u.email.toLowerCase() === (myEmail ?? '').toLowerCase()

  async function change(user: User, patch: UserUpdate, done: string): Promise<boolean> {
    setBusy(user.id)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateUser(user.id, patch)
      setUsers((rows) => (rows ?? []).map((u) => (u.id === updated.id ? updated : u)).sort(byName))
      setMode(null)
      setNotice(done)
      return true
    } catch (e) {
      setError(describeError(e, {
        409: 'You cannot deactivate or demote your own account.',
        422: 'Check the details: the name must not be empty and a password needs at least 8 characters.',
      }))
      return false
    } finally {
      setBusy(null)
    }
  }

  function deactivate(user: User) {
    if (!window.confirm(`Deactivate ${user.full_name}? They will no longer be able to sign in.`)) return
    void change(user, { is_active: false }, `${user.full_name} was deactivated.`)
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Users</h1>
      </div>
      <p className="muted">Admins manage everything. Volunteers can only run the kiosk. People who are scanned (teachers, students) are not users.</p>

      {notice && <p className="form-ok" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {users?.map((u) => {
                if (mode?.id === u.id && mode.kind === 'edit') {
                  return <EditRow key={u.id} user={u} isMe={isMe(u)} busy={busy === u.id} onCancel={() => setMode(null)}
                    onSave={(name, role) => change(u, { full_name: name, ...(isMe(u) ? {} : { role }) }, `${name} was updated.`)} />
                }
                return (
                  <tr key={u.id}>
                    <td className="strong">{u.full_name}{isMe(u) && <span className="muted"> (you)</span>}</td>
                    <td>{u.email}</td>
                    <td className="nowrap">{ROLE[u.role]}</td>
                    <td className="nowrap"><span className={`chip ${u.is_active ? 'chip-ok' : 'chip-off'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="nowrap">{u.last_login_at ? formatDateTime(u.last_login_at) : <span className="muted">Never</span>}</td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => setMode({ id: u.id, kind: 'edit' })} aria-label={`Edit ${u.full_name}`}>Edit</button>
                      <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => setMode({ id: u.id, kind: 'password' })} aria-label={`Reset password for ${u.full_name}`}>Reset password</button>
                      {u.is_active ? (
                        <button type="button" className="btn btn-small btn-danger" disabled={busy !== null || isMe(u)} title={isMe(u) ? 'You cannot deactivate yourself' : undefined} onClick={() => deactivate(u)} aria-label={`Deactivate ${u.full_name}`}>Deactivate</button>
                      ) : (
                        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void change(u, { is_active: true }, `${u.full_name} was reactivated.`)} aria-label={`Reactivate ${u.full_name}`}>Reactivate</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!users && !error && <p className="empty muted">Loading…</p>}
      </div>

      {mode?.kind === 'password' && users?.find((u) => u.id === mode.id) && (
        <PasswordForm
          key={mode.id}
          user={users.find((u) => u.id === mode.id)!}
          busy={busy === mode.id}
          onCancel={() => setMode(null)}
          onSave={(user, password) => change(user, { password }, `New password set for ${user.full_name}. Their account is unlocked.`)}
        />
      )}

      <AddUser onAdded={(user) => { setUsers((rows) => [...(rows ?? []), user].sort(byName)); setNotice(`${user.full_name} was added. Give them the password you set.`) }} />
    </>
  )
}

function EditRow({ user, isMe, busy, onSave, onCancel }: {
  user: User; isMe: boolean; busy: boolean; onSave: (name: string, role: UserRole) => Promise<boolean>; onCancel: () => void
}) {
  const [name, setName] = useState(user.full_name)
  const [role, setRole] = useState<UserRole>(user.role)
  return (
    <tr>
      <td><input aria-label={`Full name of ${user.email}`} value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td>{user.email}</td>
      <td>
        <select aria-label={`Role of ${user.email}`} value={role} disabled={isMe} title={isMe ? 'You cannot change your own role' : undefined} onChange={(e) => setRole(e.target.value as UserRole)}>
          <option value="VOLUNTEER">Volunteer</option>
          <option value="ADMIN">Admin</option>
        </select>
      </td>
      <td colSpan={2} />
      <td className="row-actions">
        <button type="button" className="btn btn-small btn-primary" disabled={busy || !name.trim()} onClick={() => void onSave(name.trim(), role)}>Save</button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  )
}

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>Password</label>
      <div className="manual-row">
        <input id={id} type="text" autoComplete="off" spellCheck={false} minLength={MIN_PASSWORD} required value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-help`} />
        <button type="button" className="btn" onClick={() => onChange(generatePassword())}>Generate</button>
      </div>
      <p id={`${id}-help`} className="help">At least {MIN_PASSWORD} characters. You will not be able to see it again, so give it to the person now.</p>
    </div>
  )
}

function PasswordForm({ user, busy, onSave, onCancel }: {
  user: User; busy: boolean; onSave: (user: User, password: string) => Promise<boolean>; onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave(user, password)
  }
  return (
    <form className="card form" onSubmit={submit} aria-labelledby="pw-title">
      <h2 id="pw-title">New password for {user.full_name}</h2>
      <p className="muted">This replaces their password and unlocks the account if it was locked after failed sign-ins.</p>
      <PasswordField id="reset-password" value={password} onChange={setPassword} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || password.length < MIN_PASSWORD}>{busy ? 'Saving…' : 'Set password'}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function AddUser({ onAdded }: { onAdded: (user: User) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('VOLUNTEER')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onAdded(await createUser({ email: email.trim(), full_name: name.trim(), role, password }))
      setName('')
      setEmail('')
      setPassword('')
      setRole('VOLUNTEER')
    } catch (e) {
      setError(describeError(e, {
        409: 'That email address is already in use.',
        422: 'Check the details: a valid email address, a name, and a password of at least 8 characters.',
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Add a user</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="user-name">Full name</label>
          <input id="user-name" required autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="user-email">Email</label>
          <input id="user-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="user-role">Role</label>
          <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="VOLUNTEER">Volunteer (runs the kiosk)</option>
            <option value="ADMIN">Admin (manages everything)</option>
          </select>
        </div>
        <PasswordField id="user-password" value={password} onChange={setPassword} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || password.length < MIN_PASSWORD}>{busy ? 'Adding…' : 'Add user'}</button>
      </div>
    </form>
  )
}
