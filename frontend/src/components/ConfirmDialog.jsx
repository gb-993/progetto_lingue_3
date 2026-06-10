import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../api';

/**
 * Modale di conferma riusabile: sostituisce window.prompt/confirm nei flussi
 * dell'app (duplicate/delete lingua, note backup, recompute, ...) con un
 * dialogo coerente con lo stile PCM (stesso overlay di LegalConsentsModal).
 *
 * Uso (il chiamante tiene il config in uno useState; null = chiuso):
 *   {dialog && <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />}
 *
 * config:
 *   - title           titolo del dialogo
 *   - message         testo o JSX sotto il titolo (opzionale)
 *   - fields          [{ name, label, placeholder, initial, autoFocus }] input testuali (opzionale)
 *   - confirmLabel    etichetta bottone conferma (default "Confirm")
 *   - cancelLabel     etichetta bottone annulla (default "Cancel")
 *   - danger          true = conferma rossa (azioni distruttive)
 *   - confirmEnabled  (values) => bool, abilita/disabilita la conferma
 *                     (es. "digita l'ID per confermare")
 *   - onConfirm       (values) => void | Promise. Se ritorna una Promise il
 *                     dialogo mostra "Working…" e resta aperto fino al
 *                     termine; un errore (es. errore API) viene mostrato nel
 *                     dialogo stesso senza chiuderlo. Se ritorna undefined il
 *                     dialogo si chiude subito (operazioni fire-and-forget
 *                     gestite dal chiamante con i suoi toast).
 *
 * Tastiera: Enter conferma, Esc annulla (disabilitati mentre è busy).
 */
export default function ConfirmDialog({ config, onClose }) {
    const {
        title,
        message,
        fields = [],
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        danger = false,
        confirmEnabled,
        onConfirm,
    } = config;

    const [values, setValues] = useState(() =>
        Object.fromEntries(fields.map(f => [f.name, f.initial ?? '']))
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const overlayRef = useRef(null);

    const canConfirm = !busy && (confirmEnabled ? !!confirmEnabled(values) : true);

    // Senza input, il focus va sull'overlay così Enter/Esc funzionano subito
    // (i keydown arrivano solo se il focus è dentro il dialogo).
    useEffect(() => {
        if (fields.length === 0) overlayRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submit = async () => {
        if (!canConfirm) return;
        setError('');
        try {
            const result = onConfirm ? onConfirm(values) : undefined;
            if (result && typeof result.then === 'function') {
                setBusy(true);
                await result;
            }
            onClose();
        } catch (err) {
            setError(getApiErrorMessage(err, 'Operation failed.'));
            setBusy(false);
        }
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape' && !busy) {
            e.stopPropagation();
            onClose();
        }
        // Enter conferma solo se il focus NON è su un bottone: altrimenti
        // Tab su "Cancel" + Enter confermerebbe invece di annullare.
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            submit();
        }
    };

    return (
        <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9000,
                padding: '1rem',
            }}
        >
            <div
                className="card"
                style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: '8px',
                    maxWidth: '480px',
                    width: '100%',
                    maxHeight: '85vh',
                    overflowY: 'auto',
                    padding: '1.5rem',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                }}
            >
                <h3 style={{ marginTop: 0, marginBottom: '0.6rem', color: danger ? '#dc2626' : undefined }}>
                    {title}
                </h3>

                {message && (
                    <div className="small" style={{ marginBottom: fields.length > 0 ? '0.9rem' : '1.2rem' }}>
                        {message}
                    </div>
                )}

                {fields.map((f, i) => (
                    <label key={f.name} style={{ display: 'block', marginBottom: '0.8rem' }}>
                        <span style={{
                            display: 'block', fontSize: '0.72rem', fontWeight: 700,
                            textTransform: 'uppercase', letterSpacing: '0.5px',
                            color: 'var(--text-muted)', marginBottom: '0.25rem',
                        }}>
                            {f.label}
                        </span>
                        <input
                            type="text"
                            value={values[f.name]}
                            placeholder={f.placeholder || ''}
                            autoFocus={f.autoFocus ?? i === 0}
                            disabled={busy}
                            onChange={(e) => setValues(prev => ({ ...prev, [f.name]: e.target.value }))}
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </label>
                ))}

                {error && (
                    <div className="alert alert-error" style={{ marginBottom: '0.8rem' }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.4rem' }}>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
                        onClick={submit}
                        disabled={!canConfirm}
                        style={danger ? { color: '#dc2626' } : undefined}
                    >
                        {busy ? 'Working…' : confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
