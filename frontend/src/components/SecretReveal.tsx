import { useState } from 'react'

interface Props {
  heading: string
  /** What the secret is, for the sentence "Copy the ... now". */
  what: string
  secret: string
  /** Extra guidance for what to do with it. */
  hint?: string
  onDismiss: () => void
}

/** Shows a secret the server will never show again (a device key), with a copy button. */
export default function SecretReveal({ heading, what, secret, hint, onDismiss }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      setCopied(false) // the text stays selectable on screen
    }
  }

  return (
    <section className="card secret" aria-labelledby="secret-title">
      <h2 id="secret-title">{heading}</h2>
      <p className="notice">
        Copy the {what} now. For security it is shown only once and cannot be retrieved later.
        {hint ? ` ${hint}` : ''}
      </p>
      <code className="token">{secret}</code>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>{copied ? 'Copied' : `Copy ${what}`}</button>
        <button type="button" className="btn" onClick={onDismiss}>I have saved it</button>
      </div>
    </section>
  )
}
