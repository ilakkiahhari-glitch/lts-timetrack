// What survives a page reload. The access token is kept in memory only (see api/client.ts).
// The refresh token lives 7 days and lets a kiosk stay signed in all week; the device key is a kiosk's own
// credential, entered once by an admin. The role is a display hint only (the server enforces it).

import type { Role } from './jwt'

const REFRESH = 'lts.refreshToken'
const EMAIL = 'lts.operatorEmail'
const ROLE = 'lts.role'
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

export function getRole(): Role | null {
  const role = read(ROLE)
  return role === 'ADMIN' || role === 'VOLUNTEER' ? role : null
}

export function saveSession(refreshToken: string | null, email: string, role: Role | null = null): void {
  write(REFRESH, refreshToken)
  write(EMAIL, email)
  write(ROLE, role)
}

export function clearSession(): void {
  write(REFRESH, null)
  write(EMAIL, null)
  write(ROLE, null)
}

export const saveDeviceKey = (key: string) => write(DEVICE_KEY, key)
export const clearDeviceKey = () => write(DEVICE_KEY, null)
