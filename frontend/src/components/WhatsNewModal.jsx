import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

// Stato "gia' visto" tenuto SOLO lato client (per-dispositivo): nessun rischio
// per il DB / login. Salviamo l'HASH del contenuto visto l'ultima volta e lo
// confrontiamo con l'hash del contenuto corrente.
const SEEN_KEY = 'pcm-whatsnew-seen';

// Vero solo se, tolti i tag e gli spazi, resta del testo reale. Serve a NON
// trattare una finestra vuota (o con solo <p></p>/&nbsp;) come "nuovo contenuto".
function hasRealText(html) {
    if (!html) return false;
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

// Hash djb2 compatto: firma il contenuto cosi' in localStorage salviamo una
// stringa corta invece dell'HTML intero. Due contenuti uguali -> stessa firma.
function hashContent(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
}

/**
 * Modale "What's New" — facoltativo e NON bloccante.
 *
 * Regole (volutamente conservative, "non deve dare problemi"):
 *  - cede SEMPRE il passo al modale legale: finche' ci sono consensi pendenti
 *    (requiredConsents non vuoto) non compare;
 *  - compare solo se c'e' testo reale ED e' DIVERSO dall'ultimo visto;
 *  - qualsiasi errore di rete -> semplicemente non si mostra (fail-safe);
 *  - OK (o click fuori) = segna come visto e chiude; non riappare finche' il
 *    super-admin non pubblica un contenuto diverso.
 */
export default function WhatsNewModal() {
    const { user, requiredConsents, consentsLoaded } = useAuth();
    const legalPending = !!(requiredConsents && requiredConsents.length > 0);

    const [content, setContent] = useState(null); // null = non ancora caricato / errore
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        // Non interroghiamo nemmeno il backend se: non loggati, lo stato dei
        // consensi non e' ancora noto (cosi' non corriamo davanti al legale),
        // o c'e' un consenso legale pendente (che ha SEMPRE la precedenza).
        if (!user || !consentsLoaded || legalPending) return;
        let active = true;
        api.get('/api/whats-new')
            .then(res => { if (active) setContent(res.data?.content ?? ''); })
            .catch(() => { if (active) setContent(null); });
        return () => { active = false; };
    }, [user, consentsLoaded, legalPending]);

    if (!user || !consentsLoaded || legalPending || dismissed || content == null) return null;
    if (!hasRealText(content)) return null; // vuoto -> non e' nuovo contenuto

    const sig = hashContent(content);
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { /* ignore */ }
    if (seen === sig) return null; // stesso contenuto del precedente -> non mostrare

    const handleOk = () => {
        try { localStorage.setItem(SEEN_KEY, sig); } catch { /* ignore */ }
        setDismissed(true);
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="whatsnew-title"
            onClick={handleOk}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9998, // sotto al modale legale (9999), per sicurezza
                padding: '1rem',
            }}
        >
            <div
                className="card"
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: '8px',
                    maxWidth: '720px',
                    width: '100%',
                    maxHeight: '85vh',
                    overflowY: 'auto',
                    padding: '1.75rem',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                }}
            >
                <h2 id="whatsnew-title" style={{ marginTop: 0, marginBottom: '1rem' }}>
                    What&apos;s New
                </h2>
                <div className="instructions-view" dangerouslySetInnerHTML={{ __html: content }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    <button type="button" className="btn btn--primary" onClick={handleOk}>
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}
