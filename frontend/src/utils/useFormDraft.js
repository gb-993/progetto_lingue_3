import { useEffect, useRef } from 'react';

/**
 * Persistenza locale di una bozza di form. Carica i campi da localStorage al
 * mount, salva ad ogni modifica (debounce 400ms), e fornisce `clearDraft()` da
 * chiamare al submit riuscito così la bozza non riappare alla prossima visita.
 *
 * Esempio:
 *   const { clearDraft } = useFormDraft({
 *       storageKey: `draft_parameter_${id || 'new'}`,
 *       formData,
 *       setFormData,
 *       fields: ['name', 'short_description', 'long_description'],
 *       enabled: !loading,
 *   });
 *
 *   // dopo un POST/PUT andato a buon fine:
 *   clearDraft();
 *
 * Note:
 * - `fields`: solo i campi elencati vengono salvati e ripristinati. Tieni
 *   fuori id immutabili, FK derivate o roba sensibile.
 * - `enabled`: passa false durante il loading iniziale per non sovrascrivere
 *   i dati appena fetchati con una bozza vecchia. Fai true quando i dati
 *   server sono caricati.
 * - Se cambi `storageKey` (es. perché passi da /add a /edit/123), l'hook
 *   ricarica dalla nuova chiave.
 */
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
    const fieldsKey = fields.join('|'); // dipendenza stabile per useEffect

    // CARICAMENTO al mount o quando cambia storageKey/enabled
    useEffect(() => {
        if (!enabled || !storageKey) return;
        if (loadedKeyRef.current === storageKey) return; // già caricato per questa key
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

    // SALVATAGGIO debounced ad ogni cambio dei campi tracciati
    useEffect(() => {
        if (!enabled || !storageKey) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            try {
                const draft = {};
                fields.forEach(f => {
                    draft[f] = formData[f];
                });
                window.localStorage.setItem(storageKey, JSON.stringify(draft));
            } catch {
                // quota piena o storage disabilitato: ignora
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
        } catch { /* ignora */ }
    };

    return { clearDraft };
}
