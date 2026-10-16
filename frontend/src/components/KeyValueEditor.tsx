import { useState } from 'react'

let lastRowId = 0
const newRowId = () => ++lastRowId

interface Row {
  id: number
  key: string
  text: string
  initialText: string
  original: unknown // kept while the text is untouched, so numbers and nested values survive a save
}

const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value))

interface Props {
  /** Starting values. The editor owns the rows after that; remount with a new `key` to reset it. */
  initial: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  legend?: string
}

/** Edits a flat set of name/value pairs (a person's `attributes`, for example: subject, room, grade). */
export default function KeyValueEditor({ initial, onChange, legend = 'Extra details' }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    Object.entries(initial).map(([key, value]) => ({
      id: newRowId(), key, text: show(value), initialText: show(value), original: value,
    })),
  )

  function commit(next: Row[]) {
    setRows(next)
    const out: Record<string, unknown> = {}
    for (const row of next) {
      const name = row.key.trim()
      if (name) out[name] = row.text === row.initialText ? row.original : row.text
    }
    onChange(out)
  }

  const update = (id: number, patch: Partial<Row>) => commit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const names = rows.map((r) => r.key.trim()).filter(Boolean)
  const duplicate = (key: string) => key.trim() !== '' && names.filter((n) => n === key.trim()).length > 1

  return (
    <fieldset className="kv">
      <legend>{legend}</legend>
      {rows.length === 0 && <p className="muted kv-empty">None yet. For example: subject, room, grade.</p>}
      {rows.map((row, index) => (
        <div className="kv-row" key={row.id}>
          <input
            aria-label={`Detail ${index + 1} name`}
            placeholder="Name (e.g. room)"
            value={row.key}
            aria-invalid={duplicate(row.key)}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <input
            aria-label={`Detail ${index + 1} value`}
            placeholder="Value"
            value={row.text}
            onChange={(e) => update(row.id, { text: e.target.value })}
          />
          <button
            type="button"
            className="btn btn-icon"
            aria-label={`Remove detail ${index + 1}`}
            onClick={() => commit(rows.filter((r) => r.id !== row.id))}
          >
            ×
          </button>
          {duplicate(row.key) && <p className="field-error kv-error">Two details are named "{row.key.trim()}"; only the last is kept.</p>}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-small"
        onClick={() => commit([...rows, { id: newRowId(), key: '', text: '', initialText: '', original: '' }])}
      >
        Add detail
      </button>
    </fieldset>
  )
}
