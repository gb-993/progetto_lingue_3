import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setOnRequiredAcceptance } from '../api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [requiredConsents, setRequiredConsents] = useState([]);
    const [consentsLoaded, setConsentsLoaded] = useState(false);

    const refreshRequiredConsents = useCallback(async () => {
        try {
            const res = await api.get('/api/consents/required');
            setRequiredConsents(res.data?.required || []);
            return res.data?.required || [];
        } catch {
            return null;
        } finally {
            setConsentsLoaded(true);
        }
    }, []);

    const acceptConsents = useCallback(async ({ ids, vexatiousApproved }) => {
        await api.post('/api/consents/accept', {
            accepted_document_ids: ids,
            vexatious_clauses_approved: vexatiousApproved,
        });
        await refreshRequiredConsents();
    }, [refreshRequiredConsents]);

    const login = async (token) => {
        localStorage.setItem('token', token);
        const res = await api.get('/api/me');
        setUser(res.data);
        await refreshRequiredConsents();
        return res.data;
    };

    const logout = (redirectTo = '/login') => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('name');
        setUser(null);
        setRequiredConsents([]);
        setConsentsLoaded(false);
        window.location.href = redirectTo;
    };

    useEffect(() => {
        setOnRequiredAcceptance(() => refreshRequiredConsents());
        return () => setOnRequiredAcceptance(null);
    }, [refreshRequiredConsents]);

    useEffect(() => {
        let active = true;
        const token = localStorage.getItem('token');
        if (!token) {
            setLoading(false);
            return;
        }
        api.get('/api/me')
            .then(async res => {
                if (!active) return;
                setUser(res.data);
                await refreshRequiredConsents();
            })
            .catch(() => { if (active) logout(); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [refreshRequiredConsents]);

    return (
        <AuthContext.Provider value={{
            user,
            login,
            logout,
            loading,
            isAdmin: user?.role === 'admin',
            requiredConsents,
            consentsLoaded,
            refreshRequiredConsents,
            acceptConsents,
        }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);