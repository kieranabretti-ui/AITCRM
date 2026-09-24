import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function AppShell() {
  const { profile, isOwner, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-stone bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-baseline gap-3">
            <div className="font-display text-lg font-bold">
              <span className="text-ink">A</span>
              <span className="text-petrol">-IT</span>
            </div>
            <span className="eyebrow">Client Manager</span>
          </div>

          <nav className="flex items-center gap-5 text-[13.5px]">
            <NavLink
              to="/"
              end
              className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
            >
              Clients
            </NavLink>
            <NavLink
              to="/clients/inactive"
              className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
            >
              Inactive
            </NavLink>
            <NavLink
              to="/support"
              className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
            >
              Support
            </NavLink>
            <NavLink
              to="/sales"
              className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
            >
              Sales
            </NavLink>
            {isOwner && (
              <NavLink
                to="/team"
                className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
              >
                Team
              </NavLink>
            )}
            {isOwner && (
              <NavLink
                to="/admin/settings"
                className={({ isActive }) => (isActive ? 'font-semibold text-petrol' : 'text-ink/70 hover:text-ink')}
              >
                Bot settings
              </NavLink>
            )}
            <span className="hidden text-ink/50 sm:inline">{profile?.email}</span>
            <button type="button" onClick={signOut} className="btn btn-ghost px-3 py-1.5 text-[12.5px]">
              Sign out
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-content px-5 py-8">
        <Outlet />
      </main>
    </div>
  )
}
