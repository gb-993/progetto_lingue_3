import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// La protezione vera è server-side: ogni endpoint admin usa
// Depends(require_admin) o Depends(require_super_admin). Questo guard è solo
// per UX (evitare che un non-admin veda viste rotte). Leggiamo dal context
// invece che da localStorage: così anche se qualcuno scrivesse
// `localStorage.role='admin'` da DevTools, il routing usa lo user reale
// ottenuto da /api/me al boot dell'AuthProvider.
//
// Prop `requireSuperAdmin`: se true, richiede anche `is_super_admin`
// (admin la cui email e' nella env var SUPER_ADMIN_EMAIL del backend).
// Usato per le rotte "pericolose" (Migration Import, Backup Restore).
export default function AdminRoute({ children, requireSuperAdmin = false }) {
    const { user } = useAuth();
    if (user?.role !== 'admin') {
        return <Navigate to="/dashboard" replace />;
    }
    if (requireSuperAdmin && !user?.is_super_admin) {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
}
