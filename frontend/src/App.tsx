import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './admin/AdminLayout'
import Dashboard from './admin/Dashboard'
import PeopleList from './admin/PeopleList'
import PersonDetail from './admin/PersonDetail'
import PersonNew from './admin/PersonNew'
import PersonTypes from './admin/PersonTypes'
import { HomeRedirect, KioskRoute, LoginRoute, RequireAdmin, RequireAuth } from './routes'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<RequireAuth />}>
        <Route path="/kiosk" element={<KioskRoute />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="people" element={<PeopleList />} />
            <Route path="people/new" element={<PersonNew />} />
            <Route path="people/types" element={<PersonTypes />} />
            <Route path="people/:id" element={<PersonDetail />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
