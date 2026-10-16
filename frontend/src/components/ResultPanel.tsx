import { formatDuration, formatTime, typeLabel } from '../format'
import type { Panel } from '../kiosk/useScanFlow'

interface Props {
  panel: Panel | null
  busy: boolean
  onReenterDeviceKey: () => void
}

/** The big banner the person at the kiosk reads: ready, checked in, checked out, already scanned, or an error. */
export default function ResultPanel({ panel, busy, onReenterDeviceKey }: Props) {
  if (panel === null) {
    return (
      <div className="result result-idle" role="status" aria-live="polite">
        <div className="result-glyph" aria-hidden="true">▣</div>
        <h2>{busy ? 'Checking…' : 'Ready to scan'}</h2>
        <p>Hold your QR code up to the camera.</p>
      </div>
    )
  }

  if (panel.kind === 'error') {
    return (
      <div className="result result-error" role="alert">
        <div className="result-glyph" aria-hidden="true">✕</div>
        <h2>{panel.title}</h2>
        <p>{panel.detail}</p>
        {panel.deviceKeyRejected && (
          <button type="button" className="btn btn-light" onClick={onReenterDeviceKey}>
            Enter a new device key
          </button>
        )}
      </div>
    )
  }

  const { data } = panel
  const who = (
    <p className="result-name">
      {data.person} <span className="chip">{typeLabel(data.person_type)}</span>
    </p>
  )

  if (data.result === 'ENTRY') {
    return (
      <div className="result result-entry" role="status" aria-live="polite">
        <div className="result-glyph" aria-hidden="true">✓</div>
        <h2>Checked in</h2>
        {who}
        <p>{data.time ? `At ${formatTime(data.time)}` : 'Welcome'}</p>
        {/missed/i.test(data.message) && (
          <p className="result-note">Your previous exit was not scanned. An administrator will review it.</p>
        )}
      </div>
    )
  }

  if (data.result === 'EXIT') {
    return (
      <div className="result result-exit" role="status" aria-live="polite">
        <div className="result-glyph" aria-hidden="true">↪</div>
        <h2>Checked out</h2>
        {who}
        <p>
          {data.duration_seconds !== null ? `Time on site: ${formatDuration(data.duration_seconds)}` : 'Goodbye'}
        </p>
      </div>
    )
  }

  return (
    <div className="result result-duplicate" role="status" aria-live="polite">
      <div className="result-glyph" aria-hidden="true">!</div>
      <h2>Already scanned</h2>
      {who}
      <p>Nothing was changed.</p>
    </div>
  )
}
