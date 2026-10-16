import { createContext, useContext } from 'react'

export interface SessionValue {
  signedIn: boolean
  email: string | null
  deviceKey: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  saveDeviceKey: (key: string) => void
  forgetDeviceKey: () => void
}

export const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}
