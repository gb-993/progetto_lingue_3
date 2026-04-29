import { useEffect, useRef, useState } from 'react';

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
    // Salta il primo save dopo (re)load: è solo l'eco del caricamento iniziale
    // dei dati server, non una vera modifica utente. Senza questo skip,
    // l'indicatore "Bozza salvata" lampeggia subito al mount confondendo l'utente.
    const firstSaveSkippedRef = useRef(false);
    const fieldsKey = fields.join('|'); // dipendenza stabile per useEffect

    // Stato dell'ultimo save: legato alla chiave di storage. Serve a esporre
    // un timestamp solo se è coerente con lo storageKey corrente — altrimenti,
    // cambiando form (es. /add → /edit/123), il timestamp del form precedente
    // mostrerebbe una falsa "bozza salvata" nel form nuovo.
    const [savedState, setSavedState] = useState({ key: null, ts: null });

    // Reset del flag "primo save da saltare" al cambio key. Niente setState
    // qui dentro: lo storageKey nuovo invalida automaticamente `savedState`
    // tramite la derivazione di `lastSavedAt` qui sotto.
    useEffect(() => {
        firstSaveSkippedRef.current = false;
    }, [storageKey]);

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
            // Il primo "save" dopo un (re)load coincide con i dati appena
            // caricati: lo saltiamo per non far apparire l'indicatore senza
            // che l'utente abbia toccato nulla.
            if (!firstSaveSkippedRef.current) {
                firstSaveSkippedRef.current = true;
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
            setSavedState({ key: storageKey, ts: null });
        } catch { /* ignora */ }
    };

    // Esposto alla UI solo se coerente con lo storageKey corrente.
    const lastSavedAt = savedState.key === storageKey ? savedState.ts : null;

    return { clearDraft, lastSavedAt };
}
