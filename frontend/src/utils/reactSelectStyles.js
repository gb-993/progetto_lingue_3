// colori di react-select presi dal tema (per il dark mode)

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
