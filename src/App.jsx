import { Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AppShell from './components/AppShell.jsx'
import Login from './pages/Login.jsx'
import AcceptInvite from './pages/AcceptInvite.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Support from './pages/Support.jsx'
import UnmatchedTickets from './pages/UnmatchedTickets.jsx'
import Team from './pages/Team.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite" element={<AcceptInvite />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/support" element={<Support />} />
          <Route path="/tickets/unmatched" element={<UnmatchedTickets />} />
          <Route element={<ProtectedRoute ownerOnly />}>
            <Route path="/team" element={<Team />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
