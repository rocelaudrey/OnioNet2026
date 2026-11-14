import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Settings from './pages/settings/Settings.jsx';
import Farmers from './pages/farmers/Farmers.jsx';
import FarmerDetail from './pages/farmers/FarmerDetail.jsx';
import Inventory from './pages/inventory/Inventory.jsx';
import BatchDetail from './pages/inventory/BatchDetail.jsx';
import Receive from './pages/inventory/Receive.jsx';
import Release from './pages/inventory/Release.jsx';
import ReleaseSlip from './pages/inventory/ReleaseSlip.jsx';
import Move from './pages/inventory/Move.jsx';
import Tags from './pages/tags/Tags.jsx';
import TagDetail from './pages/tags/TagDetail.jsx';
import PrintSheet from './pages/tags/PrintSheet.jsx';
import TagCountPage from './pages/tags/TagCountPage.jsx';
import { navFor } from './lib/nav.js';
import { useAuth } from './lib/auth.jsx';

// Pages that are built. Everything else in the nav shows a placeholder.
const BUILT = { '/settings': <Settings />, '/farmers': <Farmers />, '/qr-tags': <Tags />, '/inventory': <Inventory /> };

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <ChangePassword forced />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  // Wait for the session check before matching routes; otherwise a reload on a
  // deep link (e.g. /farmers) would be sent home before the role is known.
  if (loading) return <p className="p-8 text-sm text-muted">Loading…</p>;
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
        {pages.some((item) => item.to === '/farmers') && <Route path="/farmers/:id" element={<FarmerDetail />} />}
        {pages.some((item) => item.to === '/inventory') && (
          <>
            <Route path="/inventory/move" element={<Move />} />
            <Route path="/inventory/releases/:releaseNo" element={<ReleaseSlip />} />
            <Route path="/inventory/:id/receive" element={<Receive />} />
            <Route path="/inventory/:id/release/:releaseNo" element={<Release />} />
            <Route path="/inventory/:id" element={<BatchDetail />} />
          </>
        )}
        {pages.some((item) => item.to === '/qr-tags') && (
          <>
            <Route path="/qr-tags/lots/:id/print" element={<PrintSheet />} />
            <Route path="/qr-tags/counts/:id" element={<TagCountPage />} />
            <Route path="/qr-tags/:id" element={<TagDetail />} />
          </>
        )}
        <Route path="/change-password" element={<ChangePassword />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
