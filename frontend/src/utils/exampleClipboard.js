import { useState, useEffect, useCallback } from 'react';

/** Clipboard degli esempi, condiviso fra le tab. */
const STORAGE_KEY = 'pcm_example_clipboard';
// l'evento storage arriva solo alle altre tab
const SAME_TAB_CHANGE_EVENT = 'pcm:exampleClipboardChange';

const normalizeExample = (ex) => ({
    textarea: ex?.textarea || '',
    transliteration: ex?.transliteration || '',
    gloss: ex?.gloss || '',
    translation: ex?.translation || '',
    reference: ex?.reference || '',
    is_test: !!ex?.is_test,
});

const readFromStorage = () => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !parsed.langId
            || !Array.isArray(parsed.examples) || parsed.examples.length === 0) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writeToStorage = (clipboard) => {
    try {
        if (clipboard === null) {
            window.localStorage.removeItem(STORAGE_KEY);
        } else {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clipboard));
        }
        window.dispatchEvent(new Event(SAME_TAB_CHANGE_EVENT));
    } catch {
        // storage pieno o disabilitato: ignora
    }
};

export const clearExampleClipboard = () => {
    writeToStorage(null);
};

export const readExampleClipboard = () => readFromStorage();

export default function useExampleClipboard() {
    const [copied, setCopied] = useState(() => readFromStorage());

    useEffect(() => {
        const syncFromStorage = () => setCopied(readFromStorage());
        const onStorage = (e) => {
            if (e.key !== STORAGE_KEY) return;
            syncFromStorage();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(SAME_TAB_CHANGE_EVENT, syncFromStorage);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(SAME_TAB_CHANGE_EVENT, syncFromStorage);
        };
    }, []);

    const copy = useCallback((examples, langId, sourceQuestionId) => {
        const normalizedExamples = (Array.isArray(examples) ? examples : [examples]).map(normalizeExample);
        if (normalizedExamples.length === 0) return;
        writeToStorage({ langId, sourceQuestionId, examples: normalizedExamples });
    }, []);

    const clear = useCallback(() => {
        writeToStorage(null);
    }, []);

    return { copied, copy, clear };
}
