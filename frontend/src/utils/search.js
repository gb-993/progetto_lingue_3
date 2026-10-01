const flattenToStrings = (value, strings = []) => {
    if (value === null || value === undefined) return strings;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        strings.push(String(value));
    } else if (Array.isArray(value)) {
        value.forEach(item => flattenToStrings(item, strings));
    } else if (typeof value === 'object') {
        Object.values(value).forEach(nested => flattenToStrings(nested, strings));
    }
    return strings;
};

export function searchMatches(item, query, fields = null) {
    const normalizedQuery = (query || '').trim().toLowerCase();
    if (!normalizedQuery) return true;
    if (item === null || item === undefined) return false;

    const candidates = fields
        ? fields.map(field => item[field])
        : Object.values(item);

    const haystack = candidates
        .flatMap(value => flattenToStrings(value))
        .join('\n')
        .toLowerCase();

    return haystack.includes(normalizedQuery);
}
