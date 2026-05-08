import React, { useState, useEffect, useRef, useCallback } from 'react';
import AsyncSelect from 'react-select/async';
import api from '../../api';
import useExampleClipboard from '../../utils/exampleClipboard';

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
    loadingMessage: (base) => ({ ...base, color: 'var(--text-muted)' }),
    clearIndicator: (base) => ({ ...base, color: 'var(--text-muted)' }),
};

// Stile per i "campi" read-only del banner clipboard: imitano l'aspetto dei
// textarea degli esempi reali (stesso padding, sfondo, bordo) ma senza essere
// editabili — sono solo un'anteprima.
const clipboardFieldStyle = {
    width: '100%',
    minHeight: '3.4rem',
    padding: '0.4rem 0.5rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '0.9rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--text)',
};

const formatExampleOption = (ex) => {
    const txt = (ex.textarea || '').trim();
    const snippet = txt.length > 70 ? `${txt.slice(0, 70)}…` : txt;
    return {
        value: ex.id,
        label: `[${ex.language_id} · ${ex.question_id}] ${snippet}`,
        example: ex,
    };
};

export default function QuestionRow({ question, value, onChange, isReadOnly, currentLangId, isHighlighted }) {
    const [localError, setLocalError] = useState('');

    // Card della question: serve il ref per scrollare in vista quando il
    // backend segnala "missing_examples" su questa specifica question.
    const cardRef = useRef(null);
    useEffect(() => {
        if (!isHighlighted) return;
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [isHighlighted]);

    // Clipboard interno per copia/incolla esempi tra question (anche di parametri
    // diversi) della stessa lingua. Persistente in localStorage e cross-tab.
    const { copied, copy: copyToClipboard, clear: clearClipboard } = useExampleClipboard();
    // Flash "Copied!" temporaneo sul bottone Copy dell'esempio cliccato.
    const [recentlyCopiedTempId, setRecentlyCopiedTempId] = useState(null);
    useEffect(() => {
        if (recentlyCopiedTempId == null) return;
        const t = setTimeout(() => setRecentlyCopiedTempId(null), 1500);
        return () => clearTimeout(t);
    }, [recentlyCopiedTempId]);

    // Validazione base in tempo reale per gli esempi: anche 'unsure' richiede 2 esempi.
    useEffect(() => {
        if (value.response_text === 'yes' || value.response_text === 'unsure') {
            // FIX: Aggiunto (ex.textarea || '') per evitare il crash su valori null dal database
            const validExamples = value.examples.filter(ex => (ex.textarea || '').trim() !== '');
            if (value.examples.length > 0 && validExamples.length < 2) {
                setLocalError('Reminder: If you select YES or UNSURE, you should provide at least two valid examples.');
            } else {
                setLocalError('');
            }
        } else {
            setLocalError('');
        }
    }, [value.response_text, value.examples]);

    // --- GESTORI DI EVENTI ---

    const handleMotivationToggle = (motivationId) => {
        const newIds = value.motivation_ids.includes(motivationId)
            ? value.motivation_ids.filter(id => id !== motivationId)
            : [...value.motivation_ids, motivationId];
        onChange({ motivation_ids: newIds });
    };

    const handleAddExample = () => {
        onChange({
            examples: [
                ...value.examples,
                { tempId: Date.now(), id: null, textarea: '', transliteration: '', gloss: '', translation: '', reference: '' }
            ]
        });
    };

    const handleRemoveExample = (tempId) => {
        onChange({
            examples: value.examples.filter(ex => ex.tempId !== tempId)
        });
    };

    const handleExampleChange = (tempId, field, val) => {
        onChange({
            examples: value.examples.map(ex =>
                ex.tempId === tempId ? { ...ex, [field]: val } : ex
            )
        });
    };

    const handleCopyExample = (ex) => {
        copyToClipboard(ex, currentLangId, question.id);
        setRecentlyCopiedTempId(ex.tempId);
    };

    // Incolla l'esempio copiato come nuovo esempio in questa question. Non
    // svuota il clipboard: il linguista può fare paste in più question di fila.
    const handlePasteFromClipboard = () => {
        if (!copied) return;
        onChange({
            examples: [
                ...value.examples,
                {
                    tempId: Date.now(),
                    id: null,
                    textarea: copied.textarea || '',
                    transliteration: copied.transliteration || '',
                    gloss: copied.gloss || '',
                    translation: copied.translation || '',
                    reference: copied.reference || ''
                }
            ]
        });
    };

    // --- IMPORT ESEMPI (server-side search) ---
    // Ricerca sempre ristretta alla lingua corrente: gli esempi delle altre
    // lingue non sono utili per la compilazione. Nessun limite frontend → il
    // backend restituisce tutti gli esempi della lingua, filtrati lato server
    // anche su translation/gloss (campi non presenti nel label).
    const debounceRef = useRef(null);

    const fetchExamples = useCallback(async (q) => {
        try {
            const res = await api.get('/api/languages/examples/search', {
                params: {
                    q: q || '',
                    language_id: currentLangId,
                },
            });
            return (res.data || []).map(formatExampleOption);
        } catch (err) {
            console.warn('Example search failed', err);
            return [];
        }
    }, [currentLangId]);

    // Debounce 300ms su loadOptions: AsyncSelect chiama loadOptions a ogni keystroke
    // ma noi accumuliamo in un timer e risolviamo solo l'ultima richiesta.
    const loadExampleOptions = useCallback((inputValue) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current.timer);
            debounceRef.current.reject();
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(async () => {
                debounceRef.current = null;
                resolve(await fetchExamples(inputValue));
            }, 300);
            debounceRef.current = { timer, reject: () => resolve([]) };
        });
    }, [fetchExamples]);

    const handleImportExample = (selected) => {
        if (!selected) return;
        const ex = selected.example;
        onChange({
            examples: [
                ...value.examples,
                {
                    tempId: Date.now(),
                    id: null, // nuovo esempio (verrà inserito al save)
                    textarea: ex.textarea || '',
                    transliteration: ex.transliteration || '',
                    gloss: ex.gloss || '',
                    translation: ex.translation || '',
                    reference: ex.reference || ''
                }
            ]
        });
    };

    // --- RENDER ---

    return (
        <div
            ref={cardRef}
            className={`card question-row${isHighlighted ? ' is-highlighted' : ''}`}
            style={{ padding: '1.5rem', background: 'var(--surface, #fff)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', marginBottom: '1rem' }}
        >

            {/* Header Domanda */}
            <div className="q-head" style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: '1rem', borderLeft: '3px solid var(--brand)', paddingLeft: '0.85rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <strong className="q-id" style={{ color: 'var(--brand)', fontSize: '1.1rem' }}>{question.id}</strong>
                    <div className="q-text" style={{ fontSize: '1.05rem', fontWeight: 600 }}>{question.text}</div>
                </div>
                {question.help_info && (
                    <details style={{ alignSelf: 'flex-start' }}>
                        <summary style={{
                            cursor: 'pointer', padding: '0.3rem 0.6rem', background: 'var(--surface-2, #f1f3f5)',
                            border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.85rem',
                            fontWeight: 600, listStyle: 'none', userSelect: 'none'
                        }}>
                            More info
                        </summary>
                        <div style={{
                            marginTop: '0.5rem', padding: '0.6rem 0.85rem', background: 'var(--surface-2, #fafafa)',
                            border: '1px solid var(--border)', borderRadius: '4px',
                            fontSize: '0.9rem', whiteSpace: 'pre-wrap', maxWidth: '500px'
                        }}>
                            {question.help_info}
                        </div>
                    </details>
                )}
            </div>

            {/* Istruzione Generale */}
            {question.instruction && (
                <div className="info-row muted">
                    <div className="info-row__label">Instructions</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.instruction}</div>
                </div>
            )}

            {/* Example YES (illustrativo, sempre visibile) */}
            {question.example_yes && (
                <div className="info-row muted">
                    <div className="info-row__label">Example YES</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.example_yes}</div>
                </div>
            )}

            {/* Istruzione condizionale YES/NO. instruction_yes mostrato anche per
                'unsure' perché il flusso esempi è identico a YES. */}
            {(value.response_text === 'yes' || value.response_text === 'unsure') && question.instruction_yes && (
                <div className="info-row instructions-yn instructions-yn--yes">
                    <div className="info-row__label">Instructions (YES)</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.instruction_yes}</div>
                </div>
            )}

            {value.response_text === 'no' && question.instruction_no && (
                <div className="info-row instructions-yn instructions-yn--no">
                    <div className="info-row__label">Instructions (NO)</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.instruction_no}</div>
                </div>
            )}

            {/* Select Risposta */}
            <div className="info-row" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                <label className="info-row__label">Answer</label>
                <div className="info-row__content">
                    <select
                        value={value.response_text || ''}
                        onChange={(e) => onChange({ response_text: e.target.value })}
                        disabled={isReadOnly}
                        style={{ padding: '0.6rem', width: '100%', maxWidth: '300px', borderRadius: '4px', border: '1px solid var(--border)' }}
                    >
                        <option value="">— select —</option>
                        <option value="yes">YES</option>
                        <option value="no">NO</option>
                        <option value="unsure">UNSURE</option>
                    </select>
                </div>
            </div>

            {/* BLOCCO NO: Motivazioni */}
            {value.response_text === 'no' && (
                <div className="info-row">
                    <div className="info-row__label">Motivations</div>
                    <div className="info-row__content">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--surface-2)', padding: '1rem', borderRadius: '6px' }}>
                            {question.allowed_motivations.length > 0 ? (
                                question.allowed_motivations.map(m => (
                                    <label key={m.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: isReadOnly ? 'not-allowed' : 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={value.motivation_ids.includes(m.id)}
                                            onChange={() => handleMotivationToggle(m.id)}
                                            disabled={isReadOnly}
                                        />
                                        <strong>{m.label}</strong>
                                    </label>
                                ))
                            ) : (
                                <span className="muted small" style={{ fontStyle: 'italic' }}>
                                    No motivations available for this question.
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* BLOCCO Esempi: visibile per yes/no/unsure. La validazione "≥2 esempi"
                vale solo per yes/unsure; per 'no' sono facoltativi (zero o più). */}
            {(value.response_text === 'yes' || value.response_text === 'no' || value.response_text === 'unsure') && (
                <div className="info-row" style={{ marginTop: '1.5rem' }}>
                    <div className="info-row__label">
                        Examples{value.response_text === 'no' && ' (optional)'}
                    </div>
                    <div className="info-row__content">

                        {localError && <div className="alert alert-warning" style={{ marginBottom: '1rem', fontWeight: 'bold' }}>{localError}</div>}

                        {/*
                            Layout responsive: su schermi larghi (≥ ~880px) gli esempi
                            stanno a coppie affiancati; sotto si impilano in verticale.
                            Lo `gap` sul grid genera spaziatura simmetrica orizzontale +
                            verticale, evitando il classico disallineamento da
                            margin-bottom quando le card vanno a finire su due colonne.
                        */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                            gap: '1rem',
                            marginBottom: value.examples.length > 0 ? '1rem' : 0,
                        }}>
                            {value.examples.map((ex, index) => (
                                <div key={ex.tempId} className="card" style={{ padding: '1rem', background: 'var(--surface-2)', position: 'relative' }}>
                                    <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.25rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyExample(ex)}
                                            disabled={isReadOnly}
                                            className="btn btn--small"
                                            style={{ borderColor: 'transparent', color: recentlyCopiedTempId === ex.tempId ? '#16a34a' : 'inherit' }}
                                            title="Copy this example to the clipboard (paste it into any question of this language)"
                                        >
                                            {recentlyCopiedTempId === ex.tempId ? '✓ Copied!' : 'Copy'}
                                        </button>
                                        <button type="button" onClick={() => handleRemoveExample(ex.tempId)} disabled={isReadOnly} className="btn btn--small" style={{ color: 'red', borderColor: 'transparent' }}>Remove</button>
                                    </div>
                                    <h4 style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Example #{index + 1}</h4>

                                    {/* In modalità appaiata ogni card occupa metà larghezza,
                                        quindi i 5 campi sono impilati verticalmente per non
                                        comprimere i textarea. `rows={1}` parte compatto: chi
                                        ha esempi lunghi può comunque ingrandire col drag
                                        (resize: vertical). */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem' }}>
                                        <div>
                                            <label className="small">Example text</label>
                                            <textarea rows="1" value={ex.textarea || ''} onChange={e => handleExampleChange(ex.tempId, 'textarea', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                        </div>
                                        <div>
                                            <label className="small">Transliteration</label>
                                            <textarea rows="1" value={ex.transliteration || ''} onChange={e => handleExampleChange(ex.tempId, 'transliteration', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                        </div>
                                        <div>
                                            <label className="small">Gloss</label>
                                            <textarea rows="1" value={ex.gloss || ''} onChange={e => handleExampleChange(ex.tempId, 'gloss', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                        </div>
                                        <div>
                                            <label className="small">English Translation</label>
                                            <textarea rows="1" value={ex.translation || ''} onChange={e => handleExampleChange(ex.tempId, 'translation', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                        </div>
                                        <div>
                                            <label className="small">Reference</label>
                                            <input type="text" value={ex.reference || ''} onChange={e => handleExampleChange(ex.tempId, 'reference', e.target.value)} disabled={isReadOnly} style={{ width: '100%', padding: '0.4rem' }} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {copied && copied.langId === currentLangId && (
                            <div
                                className="card"
                                style={{
                                    marginBottom: '1rem',
                                    padding: '1rem',
                                    background: 'color-mix(in oklab, #dc2626 7%, var(--surface-2))',
                                    border: '1px dashed #dc2626',
                                    boxShadow: '0 0 0 3px color-mix(in oklab, #dc2626 10%, transparent)',
                                    position: 'relative',
                                }}
                            >
                                <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.25rem' }}>
                                    <button
                                        type="button"
                                        onClick={handlePasteFromClipboard}
                                        disabled={isReadOnly}
                                        className="btn btn--small"
                                        style={{ borderColor: 'transparent', color: '#16a34a', fontWeight: 600 }}
                                        title="Paste the copied example as a new example here (clipboard remains, you can paste into more questions)"
                                    >
                                        Paste here
                                    </button>
                                    <button
                                        type="button"
                                        onClick={clearClipboard}
                                        className="btn btn--small"
                                        style={{ color: '#dc2626', borderColor: 'transparent' }}
                                        title="Clear the clipboard"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <h4 style={{ marginTop: 0, marginBottom: '0.85rem', fontSize: '0.9rem', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Example in clipboard{copied.sourceQuestionId ? ` · from ${copied.sourceQuestionId}` : ''}
                                </h4>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label className="small">Example text</label>
                                        <div style={clipboardFieldStyle}>{copied.textarea || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                    </div>
                                    <div>
                                        <label className="small">Transliteration</label>
                                        <div style={clipboardFieldStyle}>{copied.transliteration || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                    </div>
                                    <div>
                                        <label className="small">Gloss</label>
                                        <div style={clipboardFieldStyle}>{copied.gloss || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                    </div>
                                    <div>
                                        <label className="small">English Translation</label>
                                        <div style={clipboardFieldStyle}>{copied.translation || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label className="small">Reference</label>
                                        <div style={{ ...clipboardFieldStyle, minHeight: 'auto' }}>{copied.reference || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" onClick={handleAddExample} disabled={isReadOnly} className="btn">
                                + Add another example
                            </button>
                            <div style={{ flex: '1 1 280px', minWidth: '260px' }}>
                                <AsyncSelect
                                    isClearable
                                    isDisabled={isReadOnly}
                                    cacheOptions
                                    defaultOptions
                                    loadOptions={loadExampleOptions}
                                    value={null}
                                    onChange={handleImportExample}
                                    placeholder="+ Import example from another answer..."
                                    noOptionsMessage={({ inputValue }) => inputValue ? "No matching example" : "Type to search..."}
                                    loadingMessage={() => "Searching..."}
                                    styles={reactSelectStyles}
                                />
                            </div>
                        </div>
                        <p className="small muted" style={{ marginTop: '0.4rem' }}>
                            <strong>The imported example is a copy — edit it freely.</strong>
                        </p>
                    </div>
                </div>
            )}

            {/* Commenti liberi */}
            <div className="info-row" style={{ marginTop: '1.5rem' }}>
                <label className="info-row__label">Comments</label>
                <div className="info-row__content">
                    <textarea
                        rows="3"
                        value={value.comments || ''}
                        onChange={(e) => onChange({ comments: e.target.value })}
                        disabled={isReadOnly}
                        style={{ width: '100%', padding: '0.5rem', resize: 'vertical' }}
                    />
                </div>
            </div>

        </div>
    );
}