import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : ''),
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

const PUBLIC_PATHS = ['/', '/how-to-cite', '/login'];

let onRequiredAcceptance = null;
export const setOnRequiredAcceptance = (cb) => { onRequiredAcceptance = cb; };

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            const path = typeof window !== 'undefined' ? window.location.pathname : '';
            if (!PUBLIC_PATHS.includes(path)) {
                window.location.href = '/login';
            }
        }
        if (
            error.response?.status === 403
            && error.response?.data?.required_acceptance === true
            && typeof onRequiredAcceptance === 'function'
        ) {
            onRequiredAcceptance();
        }
        return Promise.reject(error);
    }
);

export function getApiErrorMessage(err, fallback = 'Operazione non riuscita.') {
    if (err && !err.response) {
        if (err.code === 'ECONNABORTED') {
            return 'La richiesta è scaduta (timeout). Riprova.';
        }
        if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
            return 'Impossibile contattare il server: backend non raggiungibile, '
                + 'connessione assente o richiesta bloccata (CORS). '
                + 'Controlla che il backend sia attivo e l’indirizzo API corretto.';
        }
        return err?.message ? `Errore di rete: ${err.message}` : fallback;
    }

    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;

    if (typeof detail === 'string' && detail.trim()) return detail;

    if (Array.isArray(detail)) {
        const msgs = detail
            .map((d) => {
                const loc = Array.isArray(d?.loc)
                    ? d.loc.filter((x) => x !== 'body').join('.')
                    : '';
                return loc ? `${loc}: ${d?.msg || ''}` : (d?.msg || '');
            })
            .filter(Boolean);
        if (msgs.length) return `Dati non validi — ${msgs.join('; ')}`;
    }

    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message;
    }

    return status ? `${fallback} (HTTP ${status})` : fallback;
}

export default api;