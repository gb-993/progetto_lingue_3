import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Pannello laterale a scorrimento dalla destra. Usato per aprire form di
 * dettaglio (es. la edit di una question dentro la edit del suo parametro)
 * senza far perdere all'utente il contesto della pagina sottostante.
 *
 * Il drawer è renderizzato in un portal sul body così non eredita stacking
 * context o overflow:hidden delle pagine ospite. Quando aperto:
 *   - blocca lo scroll della pagina sotto
 *   - chiude su ESC o click sull'overlay scuro
 *   - viene mostrato un pulsante × in alto a destra
 *
 * NB: il drawer non sa nulla di "modifiche non salvate". La logica di
 * conferma prima di chiudere vive nel form ospitato (via
 * `useUnsavedChangesGuard`) — quando l'utente clicca per chiudere, il
 * componente padre chiama `navigate(parentPath)` e lo guard del form
 * intercetta la transizione di route mostrando la `confirm()`.
 */
export default function Drawer({ open, onClose, children, ariaLabel = 'Pannello di modifica' }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        // Evita che lo scroll dietro il pannello si muova quando si scrolla
        // sopra l'overlay; lo scroll del contenuto del drawer rimane attivo
        // perché vive in un proprio overflow:auto.
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="drawer-root" role="dialog" aria-modal="true" aria-label={ariaLabel}>
            <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
            <div className="drawer-panel">
                <button
                    type="button"
                    className="drawer-close"
                    onClick={onClose}
                    aria-label="Chiudi"
                    title="Chiudi (Esc)"
                >
                    ×
                </button>
                <div className="drawer-body">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
