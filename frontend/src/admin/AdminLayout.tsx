import { Link, NavLink, Outlet } from 'react-router-dom'
import { useSession } from '../auth/context'
import './admin.css'

export default function AdminLayout() {
  const { email, signOut } = useSession()
  return (
    <div className="admin">
      <header className="admin-header">
        <Link to="/admin" className="admin-brand">LTS TimeTrack <span>Admin</span></Link>
        <nav aria-label="Main">
          <NavLink to="/admin" end>Dashboard</NavLink>
          <NavLink to="/admin/people">People</NavLink>
        </nav>
        <div className="admin-user">
          <span className="admin-email" title={email ?? ''}>{email}</span>
          <Link to="/kiosk" className="btn btn-small">Open kiosk</Link>
          <button type="button" className="btn btn-small" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
