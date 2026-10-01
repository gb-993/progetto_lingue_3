// sezioni di un parametro che si possono segnare "da completare" (colonna "To do" della lista)
export const NEEDS_WORK_SECTIONS = [
    { key: 'short_description', label: 'Short Description' },
    { key: 'long_description', label: 'Long Description' },
    { key: 'implicational_condition', label: 'Implicational Condition(s)' },
    { key: 'description_of_the_implicational_condition', label: 'Explanation of the Implicational Condition(s)' },
    { key: 'questions', label: 'Questions' },
];

export function needsWorkLabels(sections) {
    const chosen = new Set(sections || []);
    return NEEDS_WORK_SECTIONS.filter(section => chosen.has(section.key)).map(section => section.label);
}
