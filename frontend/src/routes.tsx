import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from './auth/context'
import { homeFor } from './auth/home'
import DeviceSetup from './pages/DeviceSetup'
import Kiosk from './pages/Kiosk'
import Login from './pages/Login'

/** "/" sends everyone to their own starting screen. */
export function HomeRedirect() {
  const { signedIn, role } = useSession()
  return <Navigate to={signedIn ? homeFor(role) : '/login'} replace />
}

export function LoginRoute() {
  const { signedIn, role } = useSession()
  const from = (useLocation().state as { from?: string } | null)?.from
  if (signedIn) return <Navigate to={from ?? homeFor(role)} replace />
  return <Login />
}

export function RequireAuth() {
  const { signedIn } = useSession()
  const location = useLocation()
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

/** Admin pages. Volunteers are sent to the kiosk; the server also refuses them (403) if they get this far. */
export function RequireAdmin() {
  const { role } = useSession()
  if (role !== 'ADMIN') return <Navigate to="/kiosk" replace />
  return <Outlet />
}

export function KioskRoute() {
  const { deviceKey } = useSession()
  return deviceKey ? <Kiosk deviceKey={deviceKey} /> : <DeviceSetup />
}
