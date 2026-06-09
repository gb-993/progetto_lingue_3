import { useState, useEffect, useMemo } from 'react';
import Select from 'react-select';
import api, { getApiErrorMessage } from '../../api';

// Modale riutilizzabile per trasferire i dati linguistici di una question
// (sorgente) verso un'altra a scelta. Mostra i conflitti (destinazione gia'
// valorizzata) e per ognuno si sceglie tieni/sovrascrivi. Usa l'endpoint
// /transfer-preview e /transfer-data. Self-contained: si carica da solo la
// lista di parametri/question per il select di destinazione.
//
// Props:
//   sourceQuestionId : id della question da svuotare
//   onClose()        : chiusura senza azione
//   onTransferred(r) : chiamata dopo un POST riuscito (r = {moved, overwritten, kept, ...})

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

export default function TransferDataModal({ sourceQuestionId, onClose, onTransferred }) {
    const [parameters, setParameters] = useState([]);
    const [allQuestions, setAllQuestions] = useState([]);
    const [dest, setDest] = useState(null);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    // { [language_id]: 'keep' | 'overwrite' } — default 'keep' per ogni conflitto.
    const [choices, setChoices] = useState({});
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

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
        setChoices({});
        if (!d) return;
        setLoading(true);
        try {
            const res = await api.get(`/api/admin/questions/${sourceQuestionId}/transfer-preview`, {
                params: { dest_id: d.value },
            });
            setPreview(res.data);
            const c = {};
            (res.data.conflicts || []).forEach(x => { c[x.language_id] = 'keep'; });
            setChoices(c);
        } catch (err) {
            setPreview({ error: getApiErrorMessage(err, 'Could not load the transfer preview.') });
        } finally {
            setLoading(false);
        }
    };

    const setAll = (v) => {
        const c = {};
        (preview?.conflicts || []).forEach(x => { c[x.language_id] = v; });
        setChoices(c);
    };

    const handleConfirm = async () => {
        if (!dest || !preview || preview.error) return;
        const overwrite_language_ids = Object.entries(choices)
            .filter(([, v]) => v === 'overwrite')
            .map(([k]) => k);
        setSubmitting(true);
        try {
            const res = await api.post(`/api/admin/questions/${sourceQuestionId}/transfer-data`, {
                dest_id: dest.value,
                overwrite_language_ids,
                change_note: note,
            });
            onTransferred?.(res.data);
        } catch (err) {
            alert(getApiErrorMessage(err, 'Transfer failed.'));
        } finally {
            setSubmitting(false);
        }
    };

    const fmt = (s) => `${s.response_text || '—'} · ${s.examples_count} ex · ${s.motivations_count} mot`;

    return (
        <div style={modalOverlayStyle}>
            <div className="card" style={{ width: '640px', maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto' }}>
                <h3 style={{ marginTop: 0 }}>Transfer linked data to another question</h3>
                <p style={{ fontSize: '0.9rem', lineHeight: 1.45 }}>
                    Moves all answers, examples and motivations of <strong>{sourceQuestionId}</strong> (every language)
                    to the question you pick. A safety snapshot is first saved to the
                    <strong> Old Questions Archive</strong>, and the source question is left empty.
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
                        {preview.source_total === 0 ? (
                            <div className="alert alert-warning" style={{ fontSize: '0.85rem' }}>
                                This question has no linked data to transfer.
                            </div>
                        ) : (
                            <div style={{
                                background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border)',
                                borderRadius: '6px', padding: '0.6rem 0.85rem', marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.85rem',
                            }}>
                                <strong>{preview.transferable_count}</strong> language{preview.transferable_count === 1 ? '' : 's'} will be transferred directly
                                {preview.conflict_count > 0 && (
                                    <> · <strong>{preview.conflict_count}</strong> in conflict (destination already has an answer)</>
                                )}.
                            </div>
                        )}

                        {preview.conflict_count > 0 && (
                            <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                    <strong style={{ fontSize: '0.85rem' }}>Conflicts — choose per language</strong>
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <button type="button" className="btn btn--small" onClick={() => setAll('keep')}>All keep destination</button>
                                        <button type="button" className="btn btn--small" onClick={() => setAll('overwrite')}>All overwrite</button>
                                    </div>
                                </div>
                                <div style={{ border: '1px solid var(--border)', borderRadius: '6px', maxHeight: '260px', overflowY: 'auto' }}>
                                    {preview.conflicts.map((c, i) => {
                                        const choice = choices[c.language_id] || 'keep';
                                        return (
                                            <div key={c.language_id} style={{
                                                padding: '0.5rem 0.7rem',
                                                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                                                display: 'flex', flexDirection: 'column', gap: '0.3rem',
                                            }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                                                    {c.language_name || c.language_id} <span className="muted" style={{ fontWeight: 400 }}>({c.language_id})</span>
                                                </div>
                                                <div className="small muted" style={{ fontSize: '0.76rem' }}>
                                                    destination: {fmt(c.dest)} &nbsp;|&nbsp; source: {fmt(c.source)}
                                                </div>
                                                <div style={{ display: 'flex', gap: '1.2rem', fontSize: '0.8rem' }}>
                                                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                        <input type="radio" name={`conflict-${c.language_id}`} checked={choice === 'keep'}
                                                            onChange={() => setChoices(prev => ({ ...prev, [c.language_id]: 'keep' }))} />
                                                        Keep destination
                                                    </label>
                                                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                                                        <input type="radio" name={`conflict-${c.language_id}`} checked={choice === 'overwrite'}
                                                            onChange={() => setChoices(prev => ({ ...prev, [c.language_id]: 'overwrite' }))} />
                                                        Overwrite with source
                                                    </label>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                    <label className="small" style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>
                        Change note (required)
                    </label>
                    <textarea
                        rows="2"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Describe why you are transferring the data…"
                        style={{ width: '100%', padding: '0.4rem', borderColor: note.trim() ? 'var(--border)' : 'red', borderRadius: '4px' }}
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
                            || preview.source_total === 0 || !note.trim()
                        }
                    >
                        {submitting ? 'Transferring…' : 'Transfer data'}
                    </button>
                </div>
            </div>
        </div>
    );
}
