const pad = (n: number) => String(n).padStart(2, '0')

/** Today minus `days`, as the "YYYY-MM-DD" a date input uses (browser-local calendar day). */
export function isoDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - days)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** An ISO timestamp as the "YYYY-MM-DDTHH:mm" a datetime-local input uses (browser-local time). */
export function toInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A datetime-local value (browser-local time) as an ISO-8601 UTC timestamp for the API. */
export function fromInputValue(value: string): string {
  return new Date(value).toISOString()
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** "2026-03-02" as a readable local date without shifting it by the time zone. */
export function formatWorkDate(workDate: string): string {
  const [y, m, d] = workDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
