import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppShell from './components/AppShell.jsx'
import Login from './pages/Login.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import Dashboard from './pages/Dashboard.jsx'
import InactiveClients from './pages/InactiveClients.jsx'
import Support from './pages/Support.jsx'
import UnmatchedTickets from './pages/UnmatchedTickets.jsx'
import ClosedTickets from './pages/ClosedTickets.jsx'
import Sales from './pages/Sales.jsx'
import FormSubmissions from './pages/FormSubmissions.jsx'
import Team from './pages/Team.jsx'
import AdminSettings from './pages/AdminSettings.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite" element={<AcceptInvite />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients/inactive" element={<InactiveClients />} />
          <Route path="/support" element={<Support />} />
          <Route path="/tickets/unmatched" element={<UnmatchedTickets />} />
          <Route path="/tickets/closed" element={<ClosedTickets />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/form-submissions" element={<FormSubmissions />} />
          <Route element={<ProtectedRoute ownerOnly />}>
            <Route path="/team" element={<Team />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
