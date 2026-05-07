import axios from 'axios';

// URL del backend.
// - In prod: il frontend e il backend stanno dietro lo stesso Caddy
//   (stesso dominio), quindi baseURL vuoto = path relativi. Le chiamate
//   /api/* e /auth/* le inoltra Caddy al backend.
// - In dev (vite su :5173, backend su :8000): VITE_API_URL=http://localhost:8000
//   nel .env locale del frontend, oppure il fallback qui sotto.
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8000' : ''),
});

// Intercettore per aggiungere il Token a ogni richiesta
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Path delle rotte pubbliche dell'app: visitabili senza autenticazione.
// Vedi App.jsx — le altre rotte sono dietro Layout o AdminRoute e quindi
// richiedono già un token valido in localStorage.
const PUBLIC_PATHS = ['/', '/how-to-cite', '/login'];

// Gestione centralizzata degli errori (es. token scaduto).
// Strategia 401:
//   - rimuoviamo SEMPRE il token: se il backend dice 401, qualunque cosa
//     ci sia in localStorage è inutile e può solo creare confusione nei
//     componenti che leggono il flag "loggato" da quel valore;
//   - facciamo il redirect a /login SOLO se non siamo già su una rotta
//     pubblica. Da PublicHome/HowToCite/Login l'utente sta legittimamente
//     navigando senza login, e sbatterlo su /login solo perché un token
//     stale ha generato un 401 sarebbe un'esperienza pessima.
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
        return Promise.reject(error);
    }
);

export default api;