import { useEffect, useState } from 'react';

/**
 * Indicatore "Bozza salvata localmente" mostrato nelle form lunghe
 * (parametro, domanda) per rassicurare l'utente che le modifiche
 * non andranno perse anche se chiude o ricarica la pagina prima del save.
 *
 * Riceve `lastSavedAt` (timestamp ms) da useFormDraft. Se null/undefined non
 * mostra nulla: l'utente non ha ancora toccato il form da quando è stato
 * caricato, quindi non c'è bozza locale di cui parlare.
 *
 * Il testo "x minuti fa" si aggiorna ogni 30 secondi così rimane realistico
 * durante sessioni di editing lunghe.
 */
export default function DraftIndicator({ lastSavedAt }) {
    // Tick periodico per ricalcolare il "x minuti fa". Tenere `Date.now()`
    // nel render diretto sarebbe impuro (regola di React 19): lo materializziamo
    // in uno state che aggiorniamo da un setInterval.
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!lastSavedAt) return;
        // Tick relativamente frequente: subito dopo un save, `now` può essere
        // ancora "vecchio" finché non scatta il primo tick. 5s tiene il display
        // realistico senza creare carico.
        const id = setInterval(() => setNow(Date.now()), 5_000);
        return () => clearInterval(id);
    }, [lastSavedAt]);

    if (!lastSavedAt) return null;

    const time = new Date(lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
    // Clamp a 0: se `now` non si è ancora aggiornato dopo un save fresco
    // mostriamo "ora" anziché un valore negativo o stale dal save precedente.
    const ago = formatAgo(Math.max(0, now - lastSavedAt));

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                padding: '0.2rem 0.55rem',
                borderRadius: '999px',
                background: 'var(--surface-2, #f1f5f9)',
                border: '1px solid var(--border)',
            }}
            title={`Le modifiche non salvate vengono memorizzate nel browser e ripristinate al ricaricamento della pagina. Salvate alle ${time}.`}
        >
            <span aria-hidden="true" style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '50%',
                background: '#16a34a',
                display: 'inline-block',
            }} />
            Bozza salvata {ago} ({time})
        </div>
    );
}

function formatAgo(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 5) return 'ora';
    if (sec < 60) return `${sec}s fa`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min fa`;
    const h = Math.round(min / 60);
    return `${h}h fa`;
}
