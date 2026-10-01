import { useEffect, useRef, useState } from 'react';

/** Bozza del form salvata nel browser. */
export default function useFormDraft({
    storageKey,
    formData,
    setFormData,
    fields,
    enabled = true,
    debounceMs = 400,
}) {
    const loadedKeyRef = useRef(null);
    const saveTimerRef = useRef(null);
    const loadEchoSkippedRef = useRef(false);
    const fieldsKey = fields.join('|');

    const [savedState, setSavedState] = useState({ key: null, ts: null });

    useEffect(() => {
        loadEchoSkippedRef.current = false;
    }, [storageKey]);

    useEffect(() => {
        if (!enabled || !storageKey) return;
        if (loadedKeyRef.current === storageKey) return;
        loadedKeyRef.current = storageKey;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) return;
            const draft = JSON.parse(raw);
            if (!draft || typeof draft !== 'object') return;
            setFormData(prev => {
                const next = { ...prev };
                fields.forEach(f => {
                    if (Object.prototype.hasOwnProperty.call(draft, f)) {
                        next[f] = draft[f];
                    }
                });
                return next;
            });
        } catch {
            // bozza corrotta: ignora
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, enabled]);

    useEffect(() => {
        if (!enabled || !storageKey) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            if (!loadEchoSkippedRef.current) {
                loadEchoSkippedRef.current = true;
                return;
            }
            try {
                const draft = {};
                fields.forEach(f => {
                    draft[f] = formData[f];
                });
                window.localStorage.setItem(storageKey, JSON.stringify(draft));
                setSavedState({ key: storageKey, ts: Date.now() });
            } catch {
                // storage pieno o disabilitato: ignora
            }
        }, debounceMs);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey, enabled, fieldsKey, ...fields.map(f => formData[f])]);

    const clearDraft = () => {
        if (!storageKey) return;
        try {
            window.localStorage.removeItem(storageKey);
            setSavedState({ key: storageKey, ts: null });
        } catch { /* ignora */ }
    };

    const lastSavedAt = savedState.key === storageKey ? savedState.ts : null;

    return { clearDraft, lastSavedAt };
}
