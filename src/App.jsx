import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Settings from './pages/settings/Settings.jsx';
import { navFor } from './lib/nav.js';
import { useAuth } from './lib/auth.jsx';

// Pages that are built. Everything else in the nav shows a placeholder.
const BUILT = { '/settings': <Settings /> };

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <ChangePassword forced />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  // Only the signed-in role's pages exist as routes; anything else goes home.
  const pages = user ? navFor(user.role).filter((item) => item.to !== '/') : [];
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        {pages.map(({ to, label, subtitle, icon }) => (
          <Route
            key={to}
            path={to}
            element={BUILT[to] ?? <ComingSoon title={label} subtitle={subtitle} icon={icon} />}
          />
        ))}
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
