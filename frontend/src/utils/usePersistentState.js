import { useState, useEffect } from 'react';

// Drop-in replacement di useState che ricorda il valore in sessionStorage.
// Lo stato sopravvive a cambi pagina e reload finché la scheda del browser
// resta aperta; si azzera da solo alla chiusura della scheda.
//
// Uso identico a useState:
//   const [filters, setFilters] = usePersistentState('parameters:filters', INITIAL_FILTERS);
//
// `key` viene namespacizzata con un prefisso comune per evitare collisioni.
const PREFIX = 'pcmhub:';

export default function usePersistentState(key, defaultValue) {
    const storageKey = PREFIX + key;

    const [value, setValue] = useState(() => {
        try {
            const raw = sessionStorage.getItem(storageKey);
            if (raw !== null) return JSON.parse(raw);
        } catch {
            // chiave corrotta o storage non disponibile → usa il default
        }
        return defaultValue;
    });

    useEffect(() => {
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
            // storage pieno o non disponibile → ignora, lo stato resta in memoria
        }
    }, [storageKey, value]);

    return [value, setValue];
}
