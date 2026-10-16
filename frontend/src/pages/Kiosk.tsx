import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, isDeviceKeyError, onSite } from '../api/client'
import type { OnSiteEntry } from '../api/types'
import { useSession } from '../auth/context'
import Clock from '../components/Clock'
import OnSiteList from '../components/OnSiteList'
import QrScanner from '../components/QrScanner'
import ResultPanel from '../components/ResultPanel'
import { useScanFlow } from '../kiosk/useScanFlow'

const REFRESH_MS = 20_000

export default function Kiosk({ deviceKey }: { deviceKey: string }) {
  const { email, role, signOut, forgetDeviceKey } = useSession()
  const [entries, setEntries] = useState<OnSiteEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const manualRef = useRef<HTMLInputElement>(null)
  const [manual, setManual] = useState('')

  const refreshOnSite = useCallback(async () => {
    try {
      setEntries(await onSite(deviceKey))
      setListError(null)
      setLoaded(true)
    } catch (e) {
      if (isDeviceKeyError(e)) return // the scan panel explains this one
      setListError(e instanceof ApiError && e.status === 0 ? 'Offline: showing the last known list.' : 'Could not refresh the list.')
    }
  }, [deviceKey])

  useEffect(() => {
    // Fetch on mount and then poll: state is only set after the request resolves, not synchronously here.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshOnSite()
    const id = setInterval(() => void refreshOnSite(), REFRESH_MS)
    return () => clearInterval(id)
  }, [refreshOnSite])

  const { panel, busy, submit } = useScanFlow(deviceKey, refreshOnSite)

  async function submitManual(event: FormEvent) {
    event.preventDefault()
    const value = manual
    setManual('')
    await submit(value)
    manualRef.current?.focus()
  }

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <h1>LTS TimeTrack</h1>
        <Clock />
        <details className="menu">
          <summary>{email ?? 'Menu'}</summary>
          <div className="menu-items">
            {role === 'ADMIN' && <Link to="/admin" className="btn">Admin dashboard</Link>}
            <button type="button" className="btn" onClick={forgetDeviceKey}>Change device key</button>
            <button type="button" className="btn" onClick={signOut}>Sign out</button>
          </div>
        </details>
      </header>

      <main className="kiosk-main">
        <section className="card scan-card" aria-label="Scanner">
          <QrScanner onDetect={(text) => void submit(text)} />
          <ResultPanel panel={panel} busy={busy} onReenterDeviceKey={forgetDeviceKey} />
          <form className="manual" onSubmit={submitManual}>
            <label htmlFor="manual">USB scanner or manual entry</label>
            <div className="manual-row">
              <input
                id="manual"
                ref={manualRef}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                placeholder="Scan or type a code"
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !manual.trim()}>Submit</button>
            </div>
          </form>
        </section>

        <OnSiteList entries={entries} loaded={loaded} error={listError} />
      </main>
    </div>
  )
}
