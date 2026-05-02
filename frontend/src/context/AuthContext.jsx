import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Al caricamento, controlla se c'è un token e recupera il profilo.
        // Flag `active` per evitare setState dopo unmount o doppio-mount in
        // StrictMode (React 18): la response del primo render non deve
        // sovrascrivere lo stato del secondo.
        let active = true;
        const token = localStorage.getItem('token');
        if (!token) {
            setLoading(false);
            return;
        }
        api.get('/api/me')
            .then(res => { if (active) setUser(res.data); })
            .catch(() => { if (active) logout(); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const login = (token, userData) => {
        localStorage.setItem('token', token);
        setUser(userData);
    };

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
        window.location.href = '/login';
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading, isAdmin: user?.role === 'admin' }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);