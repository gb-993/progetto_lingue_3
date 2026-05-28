// Toggle segmentato riusabile, coerente coi token del tema (funziona in
// light e dark). Stato attivo = brand + testo bianco, come le voci attive
// del resto del sito. Per 2-3 opzioni mutuamente esclusive.
//
// Uso:
//   <SegmentedToggle
//     value={value}
//     onChange={setValue}
//     options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
//     ariaLabel="Etichetta gruppo"
//   />
export default function SegmentedToggle({ value, onChange, options, ariaLabel }) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            style={{
                display: 'inline-flex',
                gap: '2px',
                padding: '3px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
            }}
        >
            {options.map(opt => {
                const active = value === opt.value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChange(opt.value)}
                        aria-pressed={active}
                        style={{
                            border: 'none',
                            cursor: 'pointer',
                            padding: '.4rem .9rem',
                            borderRadius: 'calc(var(--radius) - 3px)',
                            fontWeight: 600,
                            fontSize: '.9rem',
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                            background: active ? 'var(--brand)' : 'transparent',
                            color: active ? '#fff' : 'var(--text-muted)',
                            transition: 'background .15s ease, color .15s ease',
                        }}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
