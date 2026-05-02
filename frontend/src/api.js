import axios from 'axios';

// URL del backend. In dev (senza variabile impostata) usa localhost:8000.
// In prod, prima di `npm run build` imposta VITE_API_URL al dominio reale,
// p.es. esportandola in shell o mettendola in frontend/.env.production:
//   VITE_API_URL=https://hub.parametricomparison.unimore.it
// Vite la inietta a build-time tramite import.meta.env.
const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
});

// Intercettore per aggiungere il Token a ogni richiesta
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Gestione centralizzata degli errori (es. token scaduto)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;