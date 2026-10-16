// What survives a page reload on a kiosk. The access token is kept in memory only (see api/client.ts).
// The refresh token lives 7 days and lets the kiosk stay signed in all week; the device key is this
// kiosk's own credential, entered once by an admin.

const REFRESH = 'lts.refreshToken'
const EMAIL = 'lts.operatorEmail'
const DEVICE_KEY = 'lts.deviceKey'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage blocked (private window): the session just will not survive a reload
  }
}

export const getRefreshToken = () => read(REFRESH)
export const getOperatorEmail = () => read(EMAIL)
export const getDeviceKey = () => read(DEVICE_KEY)

export function saveSession(refreshToken: string | null, email: string): void {
  write(REFRESH, refreshToken)
  write(EMAIL, email)
}

export function clearSession(): void {
  write(REFRESH, null)
  write(EMAIL, null)
}

export const saveDeviceKey = (key: string) => write(DEVICE_KEY, key)
export const clearDeviceKey = () => write(DEVICE_KEY, null)
