/** "7 h 36 min", "45 min", "under 1 min". */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
  if (minutes < 1) return 'under 1 min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Local time of an ISO timestamp, e.g. "08:05 AM" (the browser's locale and timezone). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** "TEACHER" -> "Teacher", "VOLUNTEER_HELPER" -> "Volunteer helper". */
export function typeLabel(code: string): string {
  const words = code.toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
