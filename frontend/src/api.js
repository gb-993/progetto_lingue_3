import axios from 'axios';

// Creiamo un'istanza centrale di Axios
const api = axios.create({
    baseURL: 'http://localhost:8000', // L'indirizzo del tuo backend FastAPI
});

// Questo "interceptor" aggiunge AUTOMATICAMENTE il token a ogni chiamata
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

export default api;