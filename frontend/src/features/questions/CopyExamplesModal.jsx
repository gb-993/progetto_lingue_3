import { useState, useEffect, useMemo } from 'react';
import Select from 'react-select';
import api, { getApiErrorMessage } from '../../api';

// Modale "Copy examples only" (richiesta linguisti 2026-06): DUPLICA gli
// esempi della question sorgente sulle risposte gia' presenti nella
// destinazione, lingua per lingua. Risposte, motivazioni e testi non vengono
// toccati; la sorgente resta intatta. Le lingue per cui la destinazione non
// ha una risposta vengono saltate e segnalate (un esempio deve essere
// agganciato a una risposta). Endpoint: /copy-examples-preview + /copy-examples.
//
// A copia eseguita il riepilogo (copiati/duplicati/saltati) resta nel modale:
// l'utente lo legge e chiude. A differenza del Move, la change note e'
// OPZIONALE: la copia non e' distruttiva e il log in History viene scritto
// comunque.
//
// Props:
//   sourceQuestionId : id della question da cui copiare gli esempi
//   onClose()        : chiusura senza copia (Cancel)
//   onCopied(r)      : chiamata quando l'utente chiude DOPO una copia
//                      riuscita (r = {examples_copied, languages_skipped, ...}).
//                      Usata dai flussi delete/deactivate per proseguire.

const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000,
};

const reactSelectStyles = {
    control: (base, state) => ({
        ...base,
        background: 'var(--surface)',
        borderColor: state.isFocused ? 'var(--brand, var(--link))' : 'var(--border)',
        boxShadow: state.isFocused ? '0 0 0 1px var(--brand, var(--link))' : 'none',
        ':hover': { borderColor: 'var(--border)' },
    }),
    menu: (base) => ({ ...base, background: 'var(--surface)', border: '1px solid var(--border)' }),
    menuList: (base) => ({ ...base, background: 'var(--surface)' }),
    option: (base, state) => ({
        ...base,
        background: state.isSelected ? 'var(--surface-2)' : state.isFocused ? 'var(--surface-alt, var(--surface-2))' : 'var(--surface)',
        color: 'var(--text)', cursor: 'pointer',
    }),
    singleValue: (base) => ({ ...base, color: 'var(--text)' }),
    input: (base) => ({ ...base, color: 'var(--text)' }),
    placeholder: (base) => ({ ...base, color: 'var(--text-muted)' }),
    groupHeading: (base) => ({ ...base, color: 'var(--text-muted)' }),
    dropdownIndicator: (base) => ({ ...base, color: 'var(--text-muted)' }),
    indicatorSeparator: (base) => ({ ...base, background: 'var(--border)' }),
    noOptionsMessage: (base) => ({ ...base, color: 'var(--text-muted)' }),
};

export default function CopyExamplesModal({ sourceQuestionId, onClose, onCopied }) {
    const [parameters, setParameters] = useState([]);
    const [allQuestions, setAllQuestions] = useState([]);
    const [dest, setDest] = useState(null);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // Esito della copia: quando valorizzato, il modale mostra il riepilogo.
    const [result, setResult] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [p, q] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/questions'),
                ]);
                if (cancelled) return;
                setParameters(p.data || []);
                setAllQuestions(q.data || []);
            } catch { /* ignore: il select di destinazione resta vuoto */ }
        })();
        return () => { cancelled = true; };
    }, []);

    // Opzioni destinazione raggruppate per parametro, senza la question sorgente.
    const destOptions = useMemo(() => parameters
        .map(p => ({
            label: `${p.id} - ${p.name}`,
            options: allQuestions
                .filter(x => x.parameter_id === p.id && x.id !== sourceQuestionId)
                .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                .map(x => {
                    const t = (x.text || '').trim();
                    return { value: x.id, label: `${x.id} — ${t.length > 70 ? t.slice(0, 70) + '…' : t}` };
                }),
        }))
        .filter(g => g.options.length > 0), [parameters, allQuestions, sourceQuestionId]);

    const handleDestChange = async (d) => {
        setDest(d);
        setPreview(null);
        if (!d) return;
        setLoading(true);
        try {
            const res = await api.get(`/api/admin/questions/${sourceQuestionId}/copy-examples-preview`, {
                params: { dest_id: d.value },
            });
            setPreview(res.data);
        } catch (err) {
            setPreview({ error: getApiErrorMessage(err, 'Could not load the copy preview.') });
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (!dest || !preview || preview.error) return;
        setSubmitting(true);
        try {
            const res = await api.post(`/api/admin/questions/${sourceQuestionId}/copy-examples`, {
                dest_id: dest.value,
                change_note: note,
            });
            setResult(res.data);
        } catch (err) {
            alert(getApiErrorMessage(err, 'Copy failed.'));
        } finally {
            setSubmitting(false);
        }
    };

    // ==== RIEPILOGO POST-COPIA ====
    if (result) {
        return (
            <div style={modalOverlayStyle}>
                <div className="card" style={{ width: '560px', maxWidth: '94vw' }}>
                    <h3 style={{ marginTop: 0 }}>Examples copied</h3>
                    <div style={{
                        background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border)',
                        borderRadius: '6px', padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.88rem', lineHeight: 1.5,
                    }}>
                        <div>
                            <strong>{result.examples_copied}</strong> example{result.examples_copied === 1 ? '' : 's'} copied
                            {' '}from <strong>{sourceQuestionId}</strong> to <strong>{dest?.value}</strong>
                            {' '}across <strong>{result.languages_processed}</strong> language{result.languages_processed === 1 ? '' : 's'}.
                        </div>
                        {result.duplicates_skipped > 0 && (
                            <div className="muted">{result.duplicates_skipped} identical example(s) were already present and were skipped.</div>
                        )}
                        {(result.languages_skipped || []).length > 0 && (
                            <div style={{ marginTop: '0.4rem' }}>
                                ⚠ Skipped (no answer in destination): <strong>{result.languages_skipped.join(', ')}</strong>
                            </div>
                        )}
                    </div>
                    <p className="small muted" style={{ marginTop: 0 }}>
                        The source question was not modified: answers, motivations and its own examples are untouched.
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                            type="button"
                            className="btn btn--primary"
                            onClick={() => (onCopied ? onCopied(result) : onClose())}
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ==== FORM ====
    return (
        <div style={modalOverlayStyle}>
            <div className="card" style={{ width: '640px', maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto' }}>
                <h3 style={{ marginTop: 0 }}>Copy examples to another question</h3>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>
                    Copies the examples of <strong>{sourceQuestionId}</strong> into the destination question,
                    language by language. </p>
                <p>Languages where the destination has no answer are
                    skipped (an example must be attached to an answer).
                </p>

                <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                    <label className="small" style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>
                        Destination question
                    </label>
                    <Select
                        isClearable
                        options={destOptions}
                        value={dest}
                        onChange={handleDestChange}
                        placeholder="Pick the destination question…"
                        noOptionsMessage={() => "No other question available"}
                        styles={reactSelectStyles}
                    />
                </div>

                {loading && <p className="small muted">Loading preview…</p>}

                {!loading && preview && preview.error && (
                    <div className="alert alert-error" style={{ fontSize: '0.85rem' }}>{preview.error}</div>
                )}

                {!loading && preview && !preview.error && (
                    <>
                        {(preview.copyable || []).length === 0 && (preview.skipped || []).length === 0 ? (
                            <div className="alert alert-warning" style={{ fontSize: '0.85rem' }}>
                                This question has no examples to copy.
                            </div>
                        ) : (
                            <div style={{
                                background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border)',
                                borderRadius: '6px', padding: '0.6rem 0.85rem', marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.85rem',
                            }}>
                                <strong>{preview.copyable_examples_total}</strong> example{preview.copyable_examples_total === 1 ? '' : 's'} will be copied
                                {preview.duplicates_total > 0 && (
                                    <> · {preview.duplicates_total} already present (skipped)</>
                                )}.
                            </div>
                        )}

                        {(preview.copyable || []).length > 0 && (
                            <div style={{ border: '1px solid var(--border)', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto', marginBottom: 'var(--form-field-mb, 1rem)' }}>
                                {preview.copyable.map((c, i) => (
                                    <div key={c.language_id} style={{
                                        padding: '0.45rem 0.7rem', fontSize: '0.82rem',
                                        borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                                        display: 'flex', justifyContent: 'space-between', gap: '0.5rem',
                                    }}>
                                        <span>{c.language_name || c.language_id} <span className="muted">({c.language_id})</span></span>
                                        <span className="muted">
                                            {c.examples_count - c.duplicates_count} to copy
                                            {c.duplicates_count > 0 && <> · {c.duplicates_count} duplicate(s) skipped</>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {(preview.skipped || []).length > 0 && (
                            <div className="alert alert-warning" style={{ fontSize: '0.82rem', marginBottom: 'var(--form-field-mb, 1rem)' }}>
                                <strong>Skipped languages</strong> (the destination has no answer to attach the examples to):{' '}
                                {preview.skipped.map(s => `${s.language_name || s.language_id} (${s.examples_count} ex)`).join(', ')}.
                            </div>
                        )}
                    </>
                )}

                <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                    <label className="small" style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>
                        Change note (optional)
                    </label>
                    <textarea
                        rows="2"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Optional note for the change history…"
                        style={{ width: '100%', padding: '0.4rem', borderColor: 'var(--border)', borderRadius: '4px' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn" onClick={onClose} disabled={submitting}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handleConfirm}
                        disabled={
                            submitting || loading || !dest
                            || !preview || !!preview.error
                            || (preview.copyable_examples_total || 0) === 0
                        }
                    >
                        {submitting ? 'Copying…' : 'Copy examples'}
                    </button>
                </div>
            </div>
        </div>
    );
}
