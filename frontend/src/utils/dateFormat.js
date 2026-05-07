/**
 * Parse di timestamp seriallizzati dal backend.
 *
 * Il backend memorizza naive datetime in UTC (vedi backend/time_utils.py) e
 * li serializza via `.isoformat()` → produce stringhe del tipo
 * "2026-05-08T14:30:00" SENZA suffisso `Z` né offset.
 *
 * `new Date(s)` su una stringa simile interpreta il valore come ORA LOCALE,
 * non UTC. Sul fuso italiano in estate (CEST = UTC+2) il timestamp appariva
 * ~2h indietro rispetto all'ora reale — bug riportato sui backup.
 *
 * Questi helper centralizzano l'interpretazione: se la stringa non ha già
 * `Z` o un offset (`+HH:MM`/`-HH:MM`), aggiungiamo `Z` per forzare l'UTC.
 * Sono retro-compatibili anche con eventuali futuri serializzatori che
 * includano già la timezone.
 */

const HAS_TZ_RE = /Z$|[+-]\d{2}:?\d{2}$/;

/**
 * Restituisce un Date dalla stringa ISO ricevuta dal backend, oppure null
 * se l'input è falsy/non parsabile.
 */
export function parseBackendDate(s) {
    if (!s) return null;
    const normalized = HAS_TZ_RE.test(s) ? s : `${s}Z`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Formatta una stringa ISO del backend nella locale corrente del browser.
 * Default: data + ora completi (toLocaleString). Per output personalizzato
 * passare l'options object di toLocaleString.
 */
export function formatBackendDate(s, options) {
    const d = parseBackendDate(s);
    if (!d) return '—';
    return options ? d.toLocaleString(undefined, options) : d.toLocaleString();
}
