// ordine delle domande in tutto il sito: prima le normali, poi le stop; dentro ogni gruppo per nome
export function compareQuestions(a, b) {
    if (Boolean(a.is_stop_question) !== Boolean(b.is_stop_question)) {
        return a.is_stop_question ? 1 : -1;
    }
    const idA = String(a.id);
    const idB = String(b.id);
    if (idA === idB) return 0;
    return idA < idB ? -1 : 1;
}
