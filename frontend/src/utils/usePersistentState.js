import { useState, useEffect } from 'react';

// useState salvato in sessionStorage
const STORAGE_KEY_PREFIX = 'pcmhub:';

export default function usePersistentState(key, defaultValue) {
    const storageKey = STORAGE_KEY_PREFIX + key;

    const [value, setValue] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (raw !== null) return JSON.parse(raw);
        } catch {
            // dato non valido: usa il default
        }
        return defaultValue;
    });

    useEffect(() => {
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
            // storage pieno: resta solo in memoria
        }
    }, [storageKey, value]);

    return [value, setValue];
}
