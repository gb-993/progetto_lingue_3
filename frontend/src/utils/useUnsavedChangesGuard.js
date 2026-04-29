import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Doppia rete di sicurezza contro la perdita di modifiche non salvate:
 *
 *  1. `beforeunload` — intercetta chiusura tab, refresh, navigazione verso
 *     un dominio esterno o digitazione di un nuovo URL nella barra. Il browser
 *     mostra il proprio dialog nativo (testo non personalizzabile dai vendor
 *     moderni: ignora il valore di `returnValue`, mostra solo "Vuoi uscire?").
 *
 *  2. `useBlocker` (react-router v6.4+) — intercetta navigazioni *interne*
 *     all'app: click su `<Link>`, `navigate()` programmatico, tasto Back del
 *     browser. Mostra una `window.confirm()` personalizzabile.
 *
 * Insieme coprono tutti i modi in cui un linguista può perdere il lavoro
 * incollando un URL, cliccando un crumb, premendo back, o chiudendo per
 * errore la scheda.
 *
 * Esempio:
 *   const isDirty = changeNote.trim() || formChanged;
 *   useUnsavedChangesGuard(isDirty);
 */
export default function useUnsavedChangesGuard(
    isDirty,
    message = 'Hai modifiche non salvate. Se esci ora la bozza resterà nel browser ma non sarà inviata al server. Continuare?'
) {
    // 1. beforeunload (uscita "fuori app")
    useEffect(() => {
        if (!isDirty) return;
        const handler = (e) => {
            e.preventDefault();
            // Per i browser pre-2022. I browser moderni ignorano il testo e
            // mostrano sempre il loro messaggio standard.
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);

    // 2. useBlocker (navigazione "dentro l'app")
    // Blocca solo se cambia il pathname: gli aggiornamenti di query/hash
    // sulla stessa pagina (es. ?param_id=X) non vanno bloccati.
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname
    );

    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        if (window.confirm(message)) {
            blocker.proceed();
        } else {
            blocker.reset();
        }
    }, [blocker, message]);
}
