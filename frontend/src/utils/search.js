// Helper per la ricerca testuale: matcha se la query è contenuta in
// almeno uno dei campi indicati (o, se fields è null, in qualsiasi valore
// dell'oggetto, ricorsivamente per oggetti annidati).
//
// Esempi:
//   searchMatches(item, "ita")                                   // cerca ovunque
//   searchMatches(lang, q, ["id","name_full","family"])          // limita ai campi indicati

const flatten = (val, out = []) => {
    if (val === null || val === undefined) return out;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out.push(String(val));
    } else if (Array.isArray(val)) {
        val.forEach(v => flatten(v, out));
    } else if (typeof val === 'object') {
        Object.values(val).forEach(v => flatten(v, out));
    }
    return out;
};

export function searchMatches(item, query, fields = null) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return true;
    if (item === null || item === undefined) return false;

    const candidates = fields
        ? fields.map(f => item[f])
        : Object.values(item);

    const haystack = candidates
        .flatMap(v => flatten(v))
        .join('\n')
        .toLowerCase();

    return haystack.includes(q);
}
