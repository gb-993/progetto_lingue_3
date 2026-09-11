import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
