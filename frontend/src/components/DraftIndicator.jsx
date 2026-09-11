import { useEffect, useState } from 'react';

export default function DraftIndicator({ lastSavedAt }) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!lastSavedAt) return;
        const id = setInterval(() => setNow(Date.now()), 5_000);
        return () => clearInterval(id);
    }, [lastSavedAt]);

    if (!lastSavedAt) return null;

    const time = new Date(lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
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
            title={`Unsaved changes are kept in your browser and restored when the page reloads. Saved at ${time}.`}
        >
            <span aria-hidden="true" style={{
                width: '0.5rem',
                height: '0.5rem',
                borderRadius: '50%',
                background: '#16a34a',
                display: 'inline-block',
            }} />
            Draft saved {ago} ({time})
        </div>
    );
}

function formatAgo(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    return `${h}h ago`;
}
