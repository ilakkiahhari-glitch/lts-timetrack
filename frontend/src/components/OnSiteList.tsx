import type { OnSiteEntry } from '../api/types'
import { formatTime, typeLabel } from '../format'

interface Props {
  entries: OnSiteEntry[]
  loaded: boolean
  error: string | null
}

export default function OnSiteList({ entries, loaded, error }: Props) {
  return (
    <section className="card onsite" aria-labelledby="onsite-title">
      <h2 id="onsite-title">
        On site now <span className="count">{loaded ? entries.length : '–'}</span>
      </h2>
      {error && <p className="onsite-error" role="alert">{error}</p>}
      {loaded && entries.length === 0 && !error && <p className="muted">Nobody is checked in.</p>}
      <ul>
        {entries.map((e, i) => (
          <li key={`${e.person}-${e.entry_time}-${i}`}>
            <span className="onsite-name">{e.person}</span>
            <span className="chip">{typeLabel(e.person_type)}</span>
            <span className="muted onsite-since">since {formatTime(e.entry_time)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
