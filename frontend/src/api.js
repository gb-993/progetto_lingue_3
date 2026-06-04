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

// Callback opzionale registrata dall'AuthContext per essere notificato quando
// il backend risponde 403 con `required_acceptance: true` (utente non in regola
// con i consensi GDPR/ToU correnti). Setter esposto sotto come funzione pura.
// L'AuthContext la imposta al mount e la usa per scatenare la apertura del
// modal di accettazione documenti.
let onRequiredAcceptance = null;
export const setOnRequiredAcceptance = (cb) => { onRequiredAcceptance = cb; };

// Gestione centralizzata degli errori (token scaduto, consensi mancanti).
//
// Strategia 401:
//   - rimuoviamo SEMPRE il token: se il backend dice 401, qualunque cosa
//     ci sia in localStorage è inutile e può solo creare confusione nei
//     componenti che leggono il flag "loggato" da quel valore;
//   - facciamo il redirect a /login SOLO se non siamo già su una rotta
//     pubblica. Da PublicHome/HowToCite/Login l'utente sta legittimamente
//     navigando senza login, e sbatterlo su /login solo perché un token
//     stale ha generato un 401 sarebbe un'esperienza pessima.
//
// Strategia 403 con required_acceptance:
//   - il backend (consent_enforcement middleware) restituisce 403 con
//     `{detail: "...", required_acceptance: true}` quando l'utente loggato
//     non ha ancora accettato la versione corrente dei documenti legali.
//   - notifichiamo l'AuthContext che ricarica la lista required e mostra
//     il modal. La promise originale viene comunque rigettata: il chiamante
//     vedrà fallire la sua richiesta (es. un POST di save), ma a quel punto
//     il modal e' davanti e l'utente non puo' fare altro che accettare.
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

// Estrae un messaggio d'errore leggibile da un errore axios. Pensata per gli
// alert/`setError` dei form: copre i casi in cui il `detail` NON è una stringa
// (e quindi mostrare `detail` direttamente darebbe "[object Object]" o niente):
//   - nessuna risposta dal server (rete giù, backend irraggiungibile, CORS,
//     timeout): `err.response` è undefined;
//   - 422 di FastAPI: `detail` è una lista di errori di validazione;
//   - 5xx generico senza dettaglio testuale.
// `fallback` è il messaggio usato solo quando non si riesce a ricavare nulla.
export function getApiErrorMessage(err, fallback = 'Operazione non riuscita.') {
    // 1) Nessuna risposta: la richiesta non è arrivata al server o non è
    //    tornata indietro. È il caso "alert ma nessuna riga in Network".
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

    // 2) Caso normale: il backend manda un detail testuale.
    if (typeof detail === 'string' && detail.trim()) return detail;

    // 3) 422 FastAPI: detail è una lista di {loc, msg, type}.
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

    // 4) detail oggetto con un campo message, o nient'altro di utile.
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
        return detail.message;
    }

    return status ? `${fallback} (HTTP ${status})` : fallback;
}

export default api;