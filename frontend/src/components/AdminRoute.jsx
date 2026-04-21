import { Navigate } from 'react-router-dom';

export default function AdminRoute({ children }) {
    const role = localStorage.getItem('role');

    // Se non è admin, lo rimanda alla dashboard
    if (role !== 'admin') {
        return <Navigate to="/dashboard" replace />;
    }

    return children;
}