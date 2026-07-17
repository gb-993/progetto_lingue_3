import { useEffect, useRef, useState } from 'react';

/**
 * Voce di un menu a tendina (Tools ▾, kebab di riga, ...). Estratta da
 * LanguageList per essere condivisa tra le pagine-lista.
 */
export function DropdownItem({ onClick, disabled, danger, children }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            disabled={disabled}
            style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.6rem 0.9rem',
                background: 'transparent',
                border: 'none',
                color: danger ? '#dc2626' : 'var(--text)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                opacity: disabled ? 0.55 : 1,
            }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
            {children}
        </button>
    );
}

/**
 * Intestazione di sezione dentro un menu ("Export", "Maintenance", ...).
 * `divider` aggiunge la riga di separazione sopra (non usarlo sulla prima).
 */
export function MenuSection({ label, divider = false }) {
    return (
        <div style={{
            padding: '0.5rem 0.9rem 0.2rem',
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            color: 'var(--text-muted)',
            borderTop: divider ? '1px solid var(--border)' : 'none',
            marginTop: divider ? '0.25rem' : 0,
        }}>
            {label}
        </div>
    );
}

/**
 * Menu "⋯" per le azioni rare di una riga di tabella (progressive disclosure:
 * le azioni quotidiane restano bottoni visibili, le eccezionali finiscono qui).
 *
 * items: [{ label, onClick, disabled, danger }]
 *
 * Il menu usa position:fixed calcolata dal bottone: le card-tabella hanno
 * overflow:hidden (per il border-radius) e un menu absolute verrebbe tagliato
 * sulle ultime righe. Si chiude su click fuori, scroll o resize.
 */
export function RowActionsMenu({ items, title = 'More actions' }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, right: 0 });
    const wrapRef = useRef(null);

    const toggle = () => {
        if (!open && wrapRef.current) {
            const r = wrapRef.current.getBoundingClientRect();
            // Se sotto il bottone resta poco spazio (righe in fondo a finestre
            // basse), il menu si apre verso l'alto: chiudendosi allo scroll,
            // le voci fuori viewport sarebbero irraggiungibili.
            const spaceBelow = window.innerHeight - r.bottom;
            const openUp = spaceBelow < 240 && r.top > spaceBelow;
            setPos({
                top: openUp ? undefined : r.bottom + 4,
                bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
                right: Math.max(8, window.innerWidth - r.right),
            });
        }
        setOpen(o => !o);
    };

    useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        const close = () => setOpen(false);
        document.addEventListener('mousedown', onDocClick);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [open]);

    return (
        <span ref={wrapRef} style={{ display: 'inline-flex' }}>
            <button
                type="button"
                className="btn"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open}
                title={title}
                style={{ paddingLeft: '0.55rem', paddingRight: '0.55rem', fontWeight: 700 }}
            >
                ⋯
            </button>
            {open && (
                <div
                    role="menu"
                    style={{
                        position: 'fixed',
                        top: pos.top,
                        bottom: pos.bottom,
                        right: pos.right,
                        minWidth: 180,
                        maxHeight: 'calc(100vh - 16px)',
                        overflowY: 'auto',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                        zIndex: 120,
                    }}
                >
                    {items.map((it) => (
                        <DropdownItem
                            key={it.label}
                            disabled={it.disabled}
                            danger={it.danger}
                            onClick={() => { setOpen(false); it.onClick(); }}
                        >
                            {it.label}
                        </DropdownItem>
                    ))}
                </div>
            )}
        </span>
    );
}
