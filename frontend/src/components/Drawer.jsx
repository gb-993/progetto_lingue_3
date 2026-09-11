import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Drawer({ open, onClose, children, ariaLabel = 'Edit panel' }) {
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
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
                    aria-label="Close"
                    title="Close (Esc)"
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
