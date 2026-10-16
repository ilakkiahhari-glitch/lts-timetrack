import { useState } from 'react'
import { typeLabel } from '../format'

interface CardProps {
  name: string
  personType: string
  code: string
  qrImage: string
}

/**
 * The printable badge: name, type, employee ID and the QR code. The QR holds only a random token, never the
 * person's details, so the text printed beside it is what makes the badge recognisable to people.
 * Printing shows only this card (see `.badge-print` in admin.css).
 */
export function BadgeCard({ name, personType, code, qrImage }: CardProps) {
  return (
    <div className="badge-card badge-print">
      <div className="badge-brand">LTS TimeTrack</div>
      <img className="badge-qr" src={qrImage} alt={`QR code for ${name}`} />
      <div className="badge-name">{name}</div>
      <div className="badge-meta">
        {typeLabel(personType)} · {code}
      </div>
      <div className="badge-foot">Scan at the kiosk when you arrive and when you leave.</div>
    </div>
  )
}

interface IssuedProps extends CardProps {
  /** Present only straight after create/rotate; the raw token cannot be fetched again. */
  token?: string
  heading?: string
}

/** A freshly issued QR: the badge, print and download buttons, and (optionally) the code text. */
export function IssuedBadge({ name, personType, code, qrImage, token, heading = 'QR badge ready' }: IssuedProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(token ?? '')
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="card issued" aria-labelledby="issued-title">
      <h2 id="issued-title">{heading}</h2>
      <p className="notice">
        Print or save this badge now. The QR code is shown only once; if it is lost, issue a new one (the old one then
        stops working).
      </p>
      <BadgeCard name={name} personType={personType} code={code} qrImage={qrImage} />
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print badge
        </button>
        <a className="btn" href={qrImage} download={`badge-${code}.png`}>
          Download QR image
        </a>
      </div>
      {token && (
        <details className="token-details">
          <summary>Show the code text</summary>
          <p className="muted">For testing or typing in by hand at a kiosk. Treat it like a password.</p>
          <code className="token">{token}</code>
          <button type="button" className="btn btn-small" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </details>
      )}
    </section>
  )
}
