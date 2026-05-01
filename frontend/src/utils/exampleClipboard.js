import { useState, useEffect, useCallback } from 'react';

/**
 * Clipboard interno per esempi linguistici della pagina di compilazione.
 *
 * Slot unico (l'ultimo "Copy" sovrascrive). Persiste in localStorage così
 * sopravvive al refresh ed è condiviso tra tab/finestre della stessa origin
 * (utile se il linguista apre più finestre della stessa lingua per copiare
 * da una all'altra). Niente TTL: la pulizia avviene solo su:
 *   - "Clear" manuale dal banner Paste
 *   - cambio di lingua (gestito in LanguageData via `clearExampleClipboard`)
 *
 * Un esempio nel clipboard è sempre legato alla `langId` di origine: il
 * banner Paste compare solo nella stessa lingua, così non si rischia di
 * incollare frammenti di una lingua dentro un'altra.
 */
const STORAGE_KEY = 'pcm_example_clipboard';
// Custom event per notificare i listener nella STESSA tab. Necessario perché
// l'evento `storage` nativo di localStorage scatta solo nelle ALTRE tab —
// se una QuestionRow chiama copy(), le altre QuestionRow montate nella stessa
// pagina non lo saprebbero mai senza questo broadcast intra-tab.
const LOCAL_EVENT = 'pcm:exampleClipboardChange';

const readFromStorage = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.langId) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writeToStorage = (val) => {
    try {
        if (val === null) {
            window.localStorage.removeItem(STORAGE_KEY);
        } else {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
        }
        // Notifica i listener nella stessa tab. Le altre tab ricevono
        // automaticamente l'evento `storage` nativo.
        window.dispatchEvent(new Event(LOCAL_EVENT));
    } catch {
        // quota piena o storage disabilitato: ignora silenziosamente
    }
};

// Helper esposto per cancellare il clipboard senza dover montare l'hook
// (es. da un useEffect su cambio lingua in LanguageData).
export const clearExampleClipboard = () => {
    writeToStorage(null);
};

export const readExampleClipboard = () => readFromStorage();

export default function useExampleClipboard() {
    const [copied, setCopied] = useState(() => readFromStorage());

    useEffect(() => {
        // `storage`: cambia in altre tab della stessa origin.
        // LOCAL_EVENT: cambia nella stessa tab (broadcast custom da writeToStorage).
        const sync = () => setCopied(readFromStorage());
        const onStorage = (e) => {
            if (e.key !== STORAGE_KEY) return;
            sync();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(LOCAL_EVENT, sync);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(LOCAL_EVENT, sync);
        };
    }, []);

    const copy = useCallback((example, langId, sourceQuestionId) => {
        writeToStorage({
            langId,
            sourceQuestionId,
            textarea: example.textarea || '',
            transliteration: example.transliteration || '',
            gloss: example.gloss || '',
            translation: example.translation || '',
            reference: example.reference || '',
        });
        // Niente setCopied diretto: l'evento LOCAL_EVENT lo aggiorna in tutti
        // i hook montati nella tab (incluso questo).
    }, []);

    const clear = useCallback(() => {
        writeToStorage(null);
    }, []);

    return { copied, copy, clear };
}
