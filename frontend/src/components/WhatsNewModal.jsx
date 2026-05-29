import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

// Vero solo se, tolti i tag e gli spazi, resta del testo reale. Serve a NON
// mostrare una finestra vuota (o con solo <p></p>/&nbsp;) come "novita'".
// NB: il backend applica la stessa regola in should_show; questa e' una
// seconda difesa lato client.
function hasRealText(html) {
    if (!html) return false;
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

/**
 * Modale "What's New" — facoltativo e NON bloccante.
 *
 * Regole (volutamente conservative, "non deve dare problemi"):
 *  - cede SEMPRE il passo al modale legale: finche' ci sono consensi pendenti
 *    (requiredConsents non vuoto) non compare;
 *  - compare solo se il server dice should_show=true (versione corrente non
 *    ancora vista dall'utente E con testo reale) ED il testo e' reale;
 *  - lo stato "gia' visto" e' lato server, per-utente (tabella whats_new_views):
 *    "una volta" vale su qualsiasi dispositivo;
 *  - "dal vivo" senza logout: ricontrolliamo a ogni cambio pagina e quando
 *    l'utente torna sulla scheda (niente timer). Cosi' se il super-admin
 *    pubblica mentre l'utente e' gia' dentro, lo vede appena naviga/rifocalizza;
 *  - qualsiasi errore di rete -> semplicemente non si mostra (fail-safe);
 *  - OK (o click fuori) = nasconde subito e POST /api/whats-new/seen; non
 *    riappare finche' il super-admin non pubblica un contenuto nuovo.
 */
export default function WhatsNewModal() {
    const { user, requiredConsents, consentsLoaded } = useAuth();
    const legalPending = !!(requiredConsents && requiredConsents.length > 0);
    const { pathname } = useLocation();

    const [content, setContent] = useState(null); // null = non ancora caricato / errore
    const [shouldShow, setShouldShow] = useState(false);

    // Possiamo controllare solo se: loggati, stato consensi noto (cosi' non
    // corriamo davanti al legale) e nessun consenso legale pendente (precedenza
    // assoluta al modale legale).
    const canCheck = !!user && consentsLoaded && !legalPending;

    const refresh = useCallback(() => {
        if (!canCheck) return;
        api.get('/api/whats-new')
            .then(res => {
                setContent(res.data?.content ?? '');
                setShouldShow(!!res.data?.should_show);
            })
            .catch(() => { setContent(null); setShouldShow(false); });
    }, [canCheck]);

    // Ricarica quando cambiano i presupposti (login / consensi) E a ogni
    // navigazione (pathname). Se non possiamo controllare, azzeriamo.
    useEffect(() => {
        if (!canCheck) { setShouldShow(false); return; }
        refresh();
    }, [canCheck, pathname, refresh]);

    // Ricarica quando l'utente torna sulla scheda/finestra (focus o tab di
    // nuovo visibile): cosi' una pubblicazione fatta mentre era altrove
    // compare al rientro, senza bisogno di logout o reload manuale.
    useEffect(() => {
        if (!canCheck) return;
        const onFocus = () => refresh();
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [canCheck, refresh]);

    if (!canCheck || content == null) return null;
    if (!shouldShow) return null; // versione corrente gia' vista (o niente da mostrare)
    if (!hasRealText(content)) return null; // vuoto -> non e' una novita'

    const handleOk = () => {
        // Ottimistico: nascondo subito e segnalo "visto" al server. Se il POST
        // fallisce il banner ricomparira' al prossimo refresh (fail-safe
        // accettabile: meglio che bloccare la UI).
        setShouldShow(false);
        api.post('/api/whats-new/seen').catch(() => { /* ignore */ });
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
