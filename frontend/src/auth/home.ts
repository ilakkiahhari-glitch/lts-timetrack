import type { Role } from './jwt'

/** Where each role starts after signing in. */
export const homeFor = (role: Role) => (role === 'ADMIN' ? '/admin' : '/kiosk')
