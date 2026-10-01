import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

/** Avvisa prima di uscire con modifiche non salvate. */
export default function useUnsavedChangesGuard(
    isDirty,
    message = 'You have unsaved changes. If you leave now the draft stays in your browser but is not sent to the server. Continue?'
) {
    useEffect(() => {
        if (!isDirty) return;
        const warnBeforeUnload = (event) => {
            event.preventDefault();
            // richiesto dai browser meno recenti
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', warnBeforeUnload);
        return () => window.removeEventListener('beforeunload', warnBeforeUnload);
    }, [isDirty]);

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
