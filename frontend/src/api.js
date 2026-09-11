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

export function getApiErrorMessage(err, fallback = 'Operation failed.') {
    if (err && !err.response) {
        if (err.code === 'ECONNABORTED') {
            return 'The request timed out. Please try again.';
        }
        if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
            return 'Cannot reach the server: the backend is unavailable, '
                + 'there is no connection, or the request was blocked (CORS). '
                + 'Check that the backend is running and the API address is correct.';
        }
        return err?.message ? `Network error: ${err.message}` : fallback;
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
        if (msgs.length) return `Invalid data — ${msgs.join('; ')}`;
    }

    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message;
    }

    return status ? `${fallback} (HTTP ${status})` : fallback;
}

export default api;