import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { KeyRound, LogOut, Menu, X } from 'lucide-react';
import { navFor } from '../lib/nav.js';
import { useAuth } from '../lib/auth.jsx';

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/logo.png" alt="" className="h-9 w-9" />
      <div className="leading-tight">
        <p className="text-xl font-semibold">
          <span className="text-brand-purple">Onio</span>
          <span className="text-brand-green">Net</span>
        </p>
        <p className="text-xs text-muted">Cold Storage</p>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5"><Logo /></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
        {navFor(user.role).map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
                isActive ? 'bg-brand-green-tint font-medium text-brand-green' : 'text-muted hover:bg-page'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line px-5 py-4">
        <NavLink to="/change-password" onClick={onNavigate} className="mb-3 flex items-center gap-2 text-sm text-muted hover:text-ink">
          <KeyRound size={16} /> Change Password
        </NavLink>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 text-sm text-muted hover:text-ink"
        >
          <LogOut size={16} /> Sign out
        </button>
        <p className="mt-4 text-xs text-muted">© OnioNet Systems</p>
      </div>
    </div>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen">
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-[220px] border-r border-line bg-white md:block print:hidden">
        <Sidebar />
      </aside>

      {/* Mobile: top bar with hamburger menu */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden print:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-2 text-ink hover:bg-page"
        >
          <Menu size={24} />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-3 top-4 rounded-lg p-2 text-muted hover:bg-page"
            >
              <X size={20} />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="md:ml-[220px] print:ml-0">
        {/* Header: where you are signed in, and as whom */}
        <div className="flex items-center justify-between gap-4 border-b border-line bg-white px-4 py-3 md:px-8 print:hidden">
          <p className="truncate text-sm font-medium">{user.facilityName || user.cooperativeName || 'OnioNet Platform'}</p>
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 text-right leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.roleLabel}</p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-sm font-semibold text-brand-green">
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
        <main className="px-4 py-6 md:px-8 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
