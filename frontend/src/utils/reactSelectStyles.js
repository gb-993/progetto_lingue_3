// react-select non legge i CSS variable del tema: in dark mode il menu resta
// bianco con testo bianco (illeggibile). Qui mappiamo le sue parti sui token
// del tema così segue automaticamente light/dark.
//
// Nota: in QuestionForm.jsx e features/compilation/QuestionRow.jsx vivono
// versioni inline molto simili a questa, con extra specifici (multiValue per
// la prima, loadingMessage/clearIndicator per la seconda). Quando capiterà
// di toccarle, conviene migrarle a questo file (eventualmente tramite spread)
// per evitare drift quando si aggiorna il tema.

const reactSelectStyles = {
    control: (base, state) => ({
        ...base,
        background: 'var(--surface)',
        borderColor: state.isFocused ? 'var(--brand, var(--link))' : 'var(--border)',
        boxShadow: state.isFocused ? '0 0 0 1px var(--brand, var(--link))' : 'none',
        ':hover': { borderColor: 'var(--border)' },
    }),
    menu: (base) => ({
        ...base,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
    }),
    menuList: (base) => ({ ...base, background: 'var(--surface)' }),
    option: (base, state) => ({
        ...base,
        background: state.isSelected
            ? 'var(--surface-2)'
            : state.isFocused ? 'var(--surface-alt, var(--surface-2))' : 'var(--surface)',
        color: 'var(--text)',
        cursor: 'pointer',
    }),
    singleValue: (base) => ({ ...base, color: 'var(--text)' }),
    input: (base) => ({ ...base, color: 'var(--text)' }),
    placeholder: (base) => ({ ...base, color: 'var(--text-muted)' }),
    dropdownIndicator: (base) => ({ ...base, color: 'var(--text-muted)' }),
    indicatorSeparator: (base) => ({ ...base, background: 'var(--border)' }),
    noOptionsMessage: (base) => ({ ...base, color: 'var(--text-muted)' }),
    clearIndicator: (base) => ({ ...base, color: 'var(--text-muted)' }),
};

export default reactSelectStyles;
