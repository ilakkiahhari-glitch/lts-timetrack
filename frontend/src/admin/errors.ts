import { ApiError } from '../api/client'

/** A sentence for the admin; `overrides` maps status codes to wording specific to the action. */
export function describeError(e: unknown, overrides: Partial<Record<number, string>> = {}): string {
  if (e instanceof ApiError) {
    if (overrides[e.status]) return overrides[e.status]!
    if (e.status === 0) return 'Cannot reach the server. Check the connection and try again.'
    if (e.status === 403) return 'You do not have permission to do that.'
    if (e.status === 404) return 'That record was not found.'
    return e.detail
  }
  return 'Something went wrong. Please try again.'
}
