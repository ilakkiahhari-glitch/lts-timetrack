import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../api/client'
import { SessionContext } from './context'
import * as store from './storage'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(api.hasSession)
  const [email, setEmail] = useState(store.getOperatorEmail)
  const [deviceKey, setDeviceKey] = useState(store.getDeviceKey)

  // The refresh token was rejected somewhere in the app: go back to the login screen.
  useEffect(() => {
    api.setSessionLostHandler(() => setSignedIn(false))
    return () => api.setSessionLostHandler(null)
  }, [])

  const signIn = useCallback(async (address: string, password: string) => {
    await api.login(address, password)
    setEmail(address)
    setSignedIn(true)
  }, [])

  const signOut = useCallback(() => {
    api.logout()
    setSignedIn(false)
  }, [])

  const saveDeviceKey = useCallback((key: string) => {
    store.saveDeviceKey(key)
    setDeviceKey(key)
  }, [])

  const forgetDeviceKey = useCallback(() => {
    store.clearDeviceKey()
    setDeviceKey(null)
  }, [])

  const value = useMemo(
    () => ({ signedIn, email, deviceKey, signIn, signOut, saveDeviceKey, forgetDeviceKey }),
    [signedIn, email, deviceKey, signIn, signOut, saveDeviceKey, forgetDeviceKey],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
