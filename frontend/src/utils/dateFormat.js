// il backend manda orari UTC senza "Z"

const HAS_TIMEZONE_RE = /Z$|[+-]\d{2}:?\d{2}$/;

export function parseBackendDate(isoString) {
    if (!isoString) return null;
    const withTimezone = HAS_TIMEZONE_RE.test(isoString) ? isoString : `${isoString}Z`;
    const date = new Date(withTimezone);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBackendDate(isoString, options) {
    const date = parseBackendDate(isoString);
    if (!date) return '—';
    return options ? date.toLocaleString(undefined, options) : date.toLocaleString();
}
