import { useSession } from './auth/context'
import DeviceSetup from './pages/DeviceSetup'
import Kiosk from './pages/Kiosk'
import Login from './pages/Login'

export default function App() {
  const { signedIn, deviceKey } = useSession()
  if (!signedIn) return <Login />
  if (!deviceKey) return <DeviceSetup />
  return <Kiosk deviceKey={deviceKey} />
}
