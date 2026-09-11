import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { sanitizeHtml } from '../utils/sanitizeHtml';

function hasRealText(html) {
    if (!html) return false;
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

export default function WhatsNewModal() {
    const { user, requiredConsents, consentsLoaded } = useAuth();
    const legalPending = !!(requiredConsents && requiredConsents.length > 0);
    const { pathname } = useLocation();

    const [content, setContent] = useState(null);
    const [shouldShow, setShouldShow] = useState(false);
    const [version, setVersion] = useState(null);
    const ackedVersionRef = useRef(null);

    const canCheck = !!user && consentsLoaded && !legalPending;

    const refresh = useCallback(() => {
        if (!canCheck) return;
        api.get('/api/whats-new')
            .then(res => {
                const v = res.data?.updated_at ?? null;
                setContent(res.data?.content ?? '');
                setVersion(v);
                const acked = ackedVersionRef.current !== null && ackedVersionRef.current === v;
                setShouldShow(!!res.data?.should_show && !acked);
            })
            .catch(() => { setContent(null); setShouldShow(false); });
    }, [canCheck]);

    useEffect(() => {
        if (!canCheck) { setShouldShow(false); return; }
        refresh();
    }, [canCheck, pathname, refresh]);

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
    if (!shouldShow) return null;
    if (!hasRealText(content)) return null;

    const handleOk = () => {
        ackedVersionRef.current = version;
        setShouldShow(false);
        api.post('/api/whats-new/seen').catch(() => {});
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
                zIndex: 9998,
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
                <div className="instructions-view" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                    <button type="button" className="btn btn--primary" onClick={handleOk}>
                        OK
                    </button>
                </div>
            </div>
        </div>
    );
}
