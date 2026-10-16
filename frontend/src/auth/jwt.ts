export type Role = 'ADMIN' | 'VOLUNTEER'

/**
 * Reads the role claim from an access token. This is only a hint for choosing which screens to show:
 * the server checks the role again on every request, so a tampered value gains nothing.
 */
export function roleFromToken(token: string): Role | null {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const role = (JSON.parse(json) as { role?: unknown }).role
    return role === 'ADMIN' || role === 'VOLUNTEER' ? role : null
  } catch {
    return null
  }
}
