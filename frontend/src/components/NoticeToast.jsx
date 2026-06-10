import { useEffect } from 'react';

const COLORS = {
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
};

/**
 * Toast non bloccante per l'esito delle operazioni (successo/avviso/errore):
 * sostituisce gli alert() nativi che obbligavano un click per informazioni
 * che non richiedono decisioni. Auto-dismiss (più lungo per gli errori),
 * chiudibile a mano con la ×.
 *
 * Uso:
 *   const [notice, setNotice] = useState(null);           // {type, text} | null
 *   const dismiss = useCallback(() => setNotice(null), []);
 *   ...
 *   setNotice({ type: 'success', text: 'Backup completed.' });
 *   ...
 *   <NoticeToast notice={notice} onClose={dismiss} />
 *
 * NB: onClose deve essere stabile (useCallback) per non far ripartire il
 * timer di auto-dismiss a ogni render del padre.
 */
export default function NoticeToast({ notice, onClose }) {
    useEffect(() => {
        if (!notice) return undefined;
        const ms = notice.type === 'success' ? 4500 : 8000;
        const t = setTimeout(onClose, ms);
        return () => clearTimeout(t);
    }, [notice, onClose]);

    if (!notice) return null;
    const color = COLORS[notice.type] || COLORS.success;

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: 'fixed',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: '1.25rem',
                zIndex: 200,
                maxWidth: 'min(560px, calc(100vw - 2rem))',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${color}`,
                borderRadius: '8px',
                boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
                padding: '0.7rem 0.9rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
            }}
        >
            <div className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
                {notice.text}
            </div>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                style={{
                    background: 'transparent', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '1rem', lineHeight: 1, flexShrink: 0,
                }}
            >
                ×
            </button>
        </div>
    );
}
