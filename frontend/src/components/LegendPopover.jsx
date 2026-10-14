import { useState, useEffect, useRef } from 'react';

export function LegendGroup({ title }) {
    return (
        <span style={{ gridColumn: '1 / -1', marginTop: '0.45rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
            {title}
        </span>
    );
}

export function LegendItem({ symbol, children }) {
    return (
        <>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{symbol}</span>
            <span>{children}</span>
        </>
    );
}

export default function LegendPopover({ children, width = 'min(25rem, 85vw)' }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const closeOnOutsideClick = (event) => {
            if (!containerRef.current?.contains(event.target)) setOpen(false);
        };
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('mousedown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <div ref={containerRef} style={{ position: 'relative' }}>
            <button
                type="button"
                className="btn"
                aria-expanded={open}
                onClick={() => setOpen(isOpen => !isOpen)}
                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem' }}
            >
                Legend {open ? '▴' : '▾'}
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label="Legend"
                    style={{
                        position: 'absolute', top: '100%', right: 0, zIndex: 15, marginTop: '0.4rem', width,
                        padding: '0.35rem 0.9rem 0.7rem', background: 'var(--surface)', color: 'var(--text)',
                        border: '1px solid var(--border)', borderRadius: '10px', boxShadow: 'var(--shadow)',
                        display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '0.75rem', rowGap: '0.2rem',
                        alignItems: 'center', fontSize: '0.8rem', textAlign: 'left',
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
}
