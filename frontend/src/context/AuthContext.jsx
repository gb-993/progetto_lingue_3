import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setOnRequiredAcceptance } from '../api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    // Lista dei documenti legali (ToU, Privacy) che l'utente loggato deve
    // ancora accettare. Vuota = utente in regola. Popolata da
    // refreshRequiredConsents(), chiamata al login e quando l'interceptor
    // di api.js intercetta un 403 con required_acceptance.
    const [requiredConsents, setRequiredConsents] = useState([]);

    // Carica la lista required dal backend. Tollerante agli errori: se la
    // chiamata fallisce (rete giu', backend in restart) lasciamo la lista
    // com'era e il modal precedente, se aperto, resta visibile.
    const refreshRequiredConsents = useCallback(async () => {
        try {
            const res = await api.get('/api/consents/required');
            setRequiredConsents(res.data?.required || []);
            return res.data?.required || [];
        } catch {
            return null;
        }
    }, []);

    // Chiamata dal modal quando l'utente clicca "Accept & Continue".
    // Dopo l'accept, ricarichiamo /api/consents/required: se la lista
    // diventa vuota, il modal si chiude da solo (App.jsx lo monta in
    // base a requiredConsents.length).
    const acceptConsents = useCallback(async ({ ids, vexatiousApproved }) => {
        await api.post('/api/consents/accept', {
            accepted_document_ids: ids,
            vexatious_clauses_approved: vexatiousApproved,
        });
        await refreshRequiredConsents();
    }, [refreshRequiredConsents]);

    // Chiamata da Login.jsx subito dopo l'auth: salva il token, popola lo
    // stato `user` recuperando il profilo da /api/me e carica la lista
    // required dei consensi. Senza questo, dopo il login `user` resta null
    // finché non si fa un refresh.
    const login = async (token) => {
        localStorage.setItem('token', token);
        const res = await api.get('/api/me');
        setUser(res.data);
        // Carica required dopo /api/me: il modal scatta subito se mancano
        // accettazioni.
        await refreshRequiredConsents();
        return res.data;
    };

    // `redirectTo` è opzionale (default `/login`): l'interceptor 401 di api.js
    // e i flussi di scadenza-token continuano a finire al login, ma il
    // pulsante Logout della topbar (Layout.jsx) passa `/` per riportare
    // l'utente alla home pubblica invece che alla pagina di login.
    //
    // NB: `login` e `logout` sono dichiarati PRIMA dell'useEffect sotto perché
    // l'effect chiama `logout` nel `.catch` di /api/me (token scaduto/invalido):
    // tenerli sopra evita il warning ESLint react-hooks/immutability "logout
    // accessed before declared".
    const logout = (redirectTo = '/login') => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('name');
        setUser(null);
        setRequiredConsents([]);
        window.location.href = redirectTo;
    };

    useEffect(() => {
        // Registra la callback per il 403 con required_acceptance: se durante
        // la navigazione il backend dice "devi accettare", ricarichiamo la
        // lista required e il modal scatta (vedi App.jsx). Cleanup al unmount
        // per evitare di tenere riferimenti stale dopo un hot-reload in dev.
        setOnRequiredAcceptance(() => refreshRequiredConsents());
        return () => setOnRequiredAcceptance(null);
    }, [refreshRequiredConsents]);

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
            .then(async res => {
                if (!active) return;
                setUser(res.data);
                // Anche all'avvio app (token gia' in storage): carico required.
                // Caso d'uso tipico: nuova versione di documento pubblicata
                // mentre l'utente era offline -> al primo refresh vede il modal.
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
            refreshRequiredConsents,
            acceptConsents,
        }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);