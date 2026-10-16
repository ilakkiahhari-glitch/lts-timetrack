import { useEffect, useState, type FormEvent } from 'react'
import { createDevice, listDevices, updateDevice } from '../api/admin'
import type { Device, DeviceWithKey } from '../api/types'
import SecretReveal from '../components/SecretReveal'
import { formatDateTime } from '../dates'
import { timeAgo } from '../format'
import { describeError } from './errors'

interface Revealed {
  heading: string
  key: string
}

const byName = (a: Device, b: Device) => a.name.localeCompare(b.name)
const NAME_TAKEN = 'A kiosk with that name already exists.'

export default function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // id of the row being changed

  useEffect(() => {
    let cancelled = false
    listDevices().then(
      (rows) => !cancelled && setDevices(rows.sort(byName)),
      (e: unknown) => !cancelled && setError(describeError(e)),
    )
    return () => {
      cancelled = true
    }
  }, [])

  function replace(updated: Device | DeviceWithKey) {
    const { api_key: _key, ...device } = updated as DeviceWithKey
    setDevices((rows) => (rows ?? []).map((d) => (d.id === device.id ? device : d)).sort(byName))
  }

  async function change(device: Device, patch: Parameters<typeof updateDevice>[1], reveal?: string) {
    setBusy(device.id)
    setError(null)
    try {
      const updated = await updateDevice(device.id, patch)
      replace(updated)
      if ('api_key' in updated && reveal) setRevealed({ heading: reveal, key: updated.api_key })
      setEditing(null)
      return true
    } catch (e) {
      setError(describeError(e, { 409: NAME_TAKEN }))
      return false
    } finally {
      setBusy(null)
    }
  }

  function deactivate(device: Device) {
    if (!window.confirm(`Deactivate "${device.name}"? Scans from this kiosk will be refused until it is reactivated.`)) return
    void change(device, { is_active: false })
  }

  function newKey(device: Device) {
    if (!window.confirm(`Issue a new key for "${device.name}"? The kiosk stops working until the new key is entered on it.`)) return
    void change(device, { rotate_key: true }, `New key for ${device.name}`)
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Kiosks</h1>
      </div>

      {revealed && (
        <SecretReveal
          heading={revealed.heading}
          what="device key"
          secret={revealed.key}
          hint="Enter it on the kiosk when it asks for the device key."
          onDismiss={() => setRevealed(null)}
        />
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Last seen</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {devices?.map((d) =>
                editing === d.id ? (
                  <EditRow key={d.id} device={d} busy={busy === d.id} onCancel={() => setEditing(null)}
                    onSave={(name, location) => change(d, { name, location })} />
                ) : (
                  <tr key={d.id}>
                    <td className="strong">{d.name}</td>
                    <td>{d.location ?? <span className="muted">–</span>}</td>
                    <td className="nowrap"><span className={`chip ${d.is_active ? 'chip-ok' : 'chip-off'}`}>{d.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td className="nowrap" title={d.last_seen_at ? formatDateTime(d.last_seen_at) : undefined}>
                      {d.last_seen_at ? timeAgo(d.last_seen_at) : <span className="muted">Never</span>}
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => setEditing(d.id)} aria-label={`Edit ${d.name}`}>Edit</button>
                      <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => newKey(d)} aria-label={`New key for ${d.name}`}>New key</button>
                      {d.is_active ? (
                        <button type="button" className="btn btn-small btn-danger" disabled={busy !== null} onClick={() => deactivate(d)} aria-label={`Deactivate ${d.name}`}>Deactivate</button>
                      ) : (
                        <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void change(d, { is_active: true })} aria-label={`Reactivate ${d.name}`}>Reactivate</button>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {devices && devices.length === 0 && <p className="empty">No kiosks yet. Register one below.</p>}
        {!devices && !error && <p className="empty muted">Loading…</p>}
      </div>

      <AddDevice
        onAdded={(device) => {
          const { api_key, ...plain } = device
          setDevices((rows) => [...(rows ?? []), plain].sort(byName))
          setRevealed({ heading: `${device.name} is registered`, key: api_key })
        }}
      />
    </>
  )
}

function EditRow({ device, busy, onSave, onCancel }: {
  device: Device; busy: boolean; onSave: (name: string, location: string | null) => Promise<boolean>; onCancel: () => void
}) {
  const [name, setName] = useState(device.name)
  const [location, setLocation] = useState(device.location ?? '')
  return (
    <tr>
      <td><input aria-label="Kiosk name" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td><input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} /></td>
      <td colSpan={2} />
      <td className="row-actions">
        <button type="button" className="btn btn-small btn-primary" disabled={busy || !name.trim()} onClick={() => void onSave(name.trim(), location.trim() || null)}>Save</button>
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>Cancel</button>
      </td>
    </tr>
  )
}

function AddDevice({ onAdded }: { onAdded: (device: DeviceWithKey) => void }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onAdded(await createDevice(name.trim(), location.trim() || null))
      setName('')
      setLocation('')
    } catch (e) {
      setError(describeError(e, { 409: NAME_TAKEN }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>Register a kiosk</h2>
      <p className="muted">Each kiosk gets its own device key. You will see the key once, right after registering.</p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="device-name">Name</label>
          <input id="device-name" required placeholder="Front Door" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="device-location">Location (optional)</label>
          <input id="device-location" placeholder="Main entrance" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Registering…' : 'Register kiosk'}</button>
      </div>
    </form>
  )
}
