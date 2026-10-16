import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, isDeviceKeyError, scan } from '../api/client'
import type { ScanResponse } from '../api/types'

/** How long a result stays on screen before the kiosk returns to "ready". */
export const DISPLAY_MS = 4000
/** The same code is never re-submitted within this long of its last scan (also covers typed or USB input). */
export const COOLDOWN_MS = 5000
/**
 * A camera reports the same QR every frame for as long as it is held up. While a code keeps being seen (gaps
 * shorter than this) it counts as one presentation, so a badge left in front of the lens cannot flip ENTRY to EXIT.
 */
export const IN_VIEW_GAP_MS = 2000

export type Panel =
  | { kind: 'result'; data: ScanResponse }
  | { kind: 'error'; title: string; detail: string; deviceKeyRejected?: boolean }

function errorPanel(e: unknown): Panel {
  if (isDeviceKeyError(e)) {
    return {
      kind: 'error',
      title: 'Kiosk not authorised',
      detail: 'The device key for this kiosk was rejected. Ask an administrator for a new key.',
      deviceKeyRejected: true,
    }
  }
  if (e instanceof ApiError) {
    if (e.status === 422) {
      return { kind: 'error', title: 'QR code not recognised', detail: 'This code is not valid. Please see an administrator.' }
    }
    if (e.status === 429) {
      const wait = e.retryAfter ? ` Try again in ${e.retryAfter} seconds.` : ''
      return { kind: 'error', title: 'Too many scans', detail: `Please wait a moment.${wait}` }
    }
    if (e.status === 0) {
      return { kind: 'error', title: 'No connection', detail: 'Cannot reach the server. The scan was not recorded.' }
    }
    return { kind: 'error', title: 'Scan failed', detail: e.detail }
  }
  return { kind: 'error', title: 'Scan failed', detail: 'Something went wrong. The scan may not have been recorded.' }
}

/**
 * Submits scanned codes and holds what the kiosk should show.
 * `onRecorded` runs after a successful scan (to refresh the on-site list).
 */
export function useScanFlow(deviceKey: string, onRecorded: () => void) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // at = when it was last submitted; seen = when it was last reported (by the camera or typed)
  const last = useRef<{ token: string; at: number; seen: number } | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
  }, [])

  const show = useCallback((next: Panel, forMs: number | null) => {
    if (clearTimer.current) clearTimeout(clearTimer.current)
    setPanel(next)
    clearTimer.current = forMs === null ? null : setTimeout(() => setPanel(null), forMs)
  }, [])

  const submit = useCallback(
    async (raw: string) => {
      const token = raw.trim()
      if (!token) return
      const now = Date.now()
      const previous = last.current
      if (previous && previous.token === token) {
        const stillInView = now - previous.seen < IN_VIEW_GAP_MS
        previous.seen = now
        if (stillInView || now - previous.at < COOLDOWN_MS) return
      }
      if (busyRef.current) return

      busyRef.current = true
      setBusy(true)
      try {
        const data = await scan(token, deviceKey)
        last.current = { token, at: Date.now(), seen: Date.now() }
        show({ kind: 'result', data }, DISPLAY_MS)
        onRecorded()
      } catch (e) {
        const next = errorPanel(e)
        // An invalid code is also not retried straight away, so a held-up bad badge does not flood the server.
        last.current = { token, at: Date.now(), seen: Date.now() }
        // A rejected device key stays up until the user acts on it.
        show(next, next.kind === 'error' && next.deviceKeyRejected ? null : DISPLAY_MS)
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [deviceKey, onRecorded, show],
  )

  return { panel, busy, submit }
}
