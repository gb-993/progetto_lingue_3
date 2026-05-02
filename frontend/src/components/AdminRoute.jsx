import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// La protezione vera è server-side: ogni endpoint admin usa Depends(require_admin).
// Questo guard è solo per UX (evitare che un non-admin veda viste rotte).
// Leggiamo dal context invece che da localStorage: così anche se qualcuno
// scrivesse `localStorage.role='admin'` da DevTools, il routing usa lo
// user reale ottenuto da /api/me al boot dell'AuthProvider.
export default function AdminRoute({ children }) {
    const { user } = useAuth();
    if (user?.role !== 'admin') {
        return <Navigate to="/dashboard" replace />;
    }
    return children;
}
