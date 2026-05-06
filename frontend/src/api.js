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