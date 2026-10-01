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

const formatExampleOption = (example) => {
    // la glossa aiuta a riconoscere l'esempio
    const primary = (example.gloss || example.textarea || '').trim();
    const snippet = primary.length > 70 ? `${primary.slice(0, 70)}…` : primary;
    return {
        value: example.id,
        label: `[${example.language_id} · ${example.question_id}] ${snippet}`,
        example: example,
    };
};

export default function QuestionRow({ question, value, onChange, isReadOnly, currentLangId, isHighlighted, isAdmin = false }) {
    const [localError, setLocalError] = useState('');

    const cardRef = useRef(null);
    useEffect(() => {
        if (!isHighlighted) return;
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [isHighlighted]);

    const { copied, copy: copyToClipboard, clear: clearClipboard } = useExampleClipboard();
    const [recentlyCopiedTempId, setRecentlyCopiedTempId] = useState(null);
    useEffect(() => {
        if (recentlyCopiedTempId == null) return;
        const timer = setTimeout(() => setRecentlyCopiedTempId(null), 1500);
        return () => clearTimeout(timer);
    }, [recentlyCopiedTempId]);
    const [copiedAllCount, setCopiedAllCount] = useState(0);
    useEffect(() => {
        if (!copiedAllCount) return;
        const timer = setTimeout(() => setCopiedAllCount(0), 1500);
        return () => clearTimeout(timer);
    }, [copiedAllCount]);

    useEffect(() => {
        if (value.response_text === 'yes' || value.response_text === 'unsure') {
            const validExamples = value.examples.filter(example => (example.textarea || '').trim() !== '');
            if (value.examples.length > 0 && validExamples.length < 2) {
                setLocalError('Reminder: If you select YES or UNSURE, you should provide at least two valid examples.');
            } else {
                setLocalError('');
            }
        } else {
            setLocalError('');
        }
    }, [value.response_text, value.examples]);

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
            examples: value.examples.filter(example => example.tempId !== tempId)
        });
    };

    const handleExampleChange = (tempId, field, newValue) => {
        onChange({
            examples: value.examples.map(example =>
                example.tempId === tempId ? { ...example, [field]: newValue } : example
            )
        });
    };

    const handleCopyExample = (example) => {
        copyToClipboard([example], currentLangId, question.id);
        setRecentlyCopiedTempId(example.tempId);
    };

    const exampleHasContent = (example) =>
        [example.textarea, example.transliteration, example.gloss, example.translation, example.reference]
            .some(fieldValue => (fieldValue || '').trim() !== '');

    const handleCopyAllExamples = () => {
        const nonEmpty = value.examples.filter(exampleHasContent);
        if (nonEmpty.length === 0) return;
        copyToClipboard(nonEmpty, currentLangId, question.id);
        setCopiedAllCount(nonEmpty.length);
    };

    // -1 = su, +1 = giù
    const handleMoveExample = (tempId, direction) => {
        const idx = value.examples.findIndex(example => example.tempId === tempId);
        const target = idx + direction;
        if (idx < 0 || target < 0 || target >= value.examples.length) return;
        const next = [...value.examples];
        [next[idx], next[target]] = [next[target], next[idx]];
        onChange({ examples: next });
    };

    // il clipboard resta pieno
    const handlePasteFromClipboard = () => {
        if (!copied || !copied.examples?.length) return;
        const baseTempId = Date.now();
        onChange({
            examples: [
                ...value.examples,
                ...copied.examples.map((example, index) => ({
                    tempId: baseTempId + index,
                    id: null,
                    textarea: example.textarea || '',
                    transliteration: example.transliteration || '',
                    gloss: example.gloss || '',
                    translation: example.translation || '',
                    reference: example.reference || '',
                    is_test: !!example.is_test,
                }))
            ]
        });
    };

    const debounceRef = useRef(null);

    const fetchExamples = useCallback(async (query) => {
        try {
            const res = await api.get('/api/languages/examples/search', {
                params: {
                    q: query || '',
                    language_id: currentLangId,
                },
            });
            return (res.data || []).map(formatExampleOption);
        } catch (err) {
            console.warn('Example search failed', err);
            return [];
        }
    }, [currentLangId]);

    // debounce: parte solo l'ultima ricerca
    const loadExampleOptions = useCallback((inputValue) => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current.timer);
            debounceRef.current.reject();
        }
        return new Promise((resolve) => {
            const timer = setTimeout(async () => {
                debounceRef.current = null;
                resolve(await fetchExamples(inputValue));
            }, 300);
            debounceRef.current = { timer, reject: () => resolve([]) };
        });
    }, [fetchExamples]);

    const handleImportExample = (selected) => {
        if (!selected) return;
        const example = selected.example;
        onChange({
            examples: [
                ...value.examples,
                {
                    tempId: Date.now(),
                    id: null,
                    textarea: example.textarea || '',
                    transliteration: example.transliteration || '',
                    gloss: example.gloss || '',
                    translation: example.translation || '',
                    reference: example.reference || ''
                }
            ]
        });
    };

    return (
        <div
            ref={cardRef}
            className={`card question-row${isHighlighted ? ' is-highlighted' : ''}`}
            style={{ padding: 'var(--form-box-pad-lg, 1.5rem)', background: 'var(--surface, #fff)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', marginBottom: 'var(--form-field-mb, 1rem)' }}
        >

            <div className="q-head" style={{ display: 'grid', gridTemplateColumns: '1fr auto', columnGap: '1rem', borderLeft: '3px solid var(--brand)', paddingLeft: '0.85rem', marginBottom: 'var(--form-col-gap, 1.5rem)' }}>
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

            {question.instruction && (
                <div className="info-row muted">
                    <div className="info-row__label">Instructions</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.instruction}</div>
                </div>
            )}

            {question.example_yes && (
                <div className="info-row muted">
                    <div className="info-row__label">Example YES</div>
                    <div className="info-row__content" style={{ whiteSpace: 'pre-wrap' }}>{question.example_yes}</div>
                </div>
            )}

            {(value.response_text === 'yes' || value.response_text === 'unsure' || value.response_text === 'missing') && question.instruction_yes && (
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

            <div className="info-row" style={{ marginTop: 'var(--form-col-gap, 1.5rem)', marginBottom: 'var(--form-col-gap, 1.5rem)' }}>
                <label className="info-row__label">Answer</label>
                <div className="info-row__content">
                    <select
                        value={value.response_text || ''}
                        onChange={(e) => onChange({ response_text: e.target.value })}
                        disabled={isReadOnly}
                        style={{ padding: 'var(--form-input-pad, 0.6rem)', width: '100%', maxWidth: '300px', borderRadius: '4px', border: '1px solid var(--border)' }}
                    >
                        <option value="">— select —</option>
                        <option value="yes">YES</option>
                        <option value="no">NO</option>
                        <option value="unsure">UNSURE</option>
                        <option value="missing">MISSING</option>
                    </select>
                </div>
            </div>

            {value.response_text === 'no' && (
                <div className="info-row">
                    <div className="info-row__label">Motivations</div>
                    <div className="info-row__content">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--surface-2)', padding: 'var(--form-box-pad, 1rem)', borderRadius: '6px' }}>
                            {question.allowed_motivations.length > 0 ? (
                                question.allowed_motivations.map(motivation => (
                                    <label key={motivation.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: isReadOnly ? 'not-allowed' : 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={value.motivation_ids.includes(motivation.id)}
                                            onChange={() => handleMotivationToggle(motivation.id)}
                                            disabled={isReadOnly}
                                        />
                                        <strong>{motivation.label}</strong>
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

            {(value.response_text === 'yes' || value.response_text === 'no' || value.response_text === 'unsure' || value.response_text === 'missing') && (
                <div className="info-row" style={{ marginTop: 'var(--form-col-gap, 1.5rem)' }}>
                    <div className="info-row__label">
                        Examples{(value.response_text === 'no' || value.response_text === 'missing') && ' (optional)'}
                    </div>
                    <div className="info-row__content">

                        {localError && <div className="alert alert-warning" style={{ marginBottom: 'var(--form-field-mb, 1rem)', fontWeight: 'bold' }}>{localError}</div>}

                        {/* examples-grid tiene allineate le card (vedi index.css) */}
                        <div className="examples-grid" style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                            gap: 'var(--form-grid-gap, 1rem)',
                            marginBottom: value.examples.length > 0 ? '1rem' : 0,
                        }}>
                            {value.examples.map((example, index) => (
                                <div key={example.tempId} className="card" style={{ padding: 'var(--form-box-pad, 1rem)', background: 'var(--surface-2)', position: 'relative' }}>
                                    <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', display: 'flex', gap: '0.25rem' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleMoveExample(example.tempId, -1)}
                                            disabled={isReadOnly || index === 0}
                                            className="btn btn--small"
                                            style={{ borderColor: 'transparent', padding: '0.2rem 0.45rem' }}
                                            title="Move this example up"
                                            aria-label="Move example up"
                                        >
                                            ▲
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleMoveExample(example.tempId, 1)}
                                            disabled={isReadOnly || index === value.examples.length - 1}
                                            className="btn btn--small"
                                            style={{ borderColor: 'transparent', padding: '0.2rem 0.45rem' }}
                                            title="Move this example down"
                                            aria-label="Move example down"
                                        >
                                            ▼
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleCopyExample(example)}
                                            disabled={isReadOnly}
                                            className="btn btn--small"
                                            style={{ borderColor: 'transparent', color: recentlyCopiedTempId === example.tempId ? '#16a34a' : 'inherit' }}
                                            title="Copy this example to the clipboard (paste it into any question of this language)"
                                        >
                                            {recentlyCopiedTempId === example.tempId ? '✓ Copied!' : 'Copy'}
                                        </button>
                                        <button type="button" onClick={() => handleRemoveExample(example.tempId)} disabled={isReadOnly} className="btn btn--small" style={{ color: 'red', borderColor: 'transparent' }}>Remove</button>
                                    </div>
                                    <h4 style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Example #{index + 1}</h4>

                                    {/* solo gli admin marcano gli esempi di test */}
                                    {isAdmin ? (
                                        <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem', cursor: isReadOnly ? 'not-allowed' : 'pointer', color: example.is_test ? '#a16207' : 'var(--text-muted)', fontWeight: example.is_test ? 700 : 400 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!example.is_test}
                                                onChange={e => handleExampleChange(example.tempId, 'is_test', e.target.checked)}
                                                disabled={isReadOnly}
                                            />
                                            Mark as test example 
                                        </label>
                                    ) : (example.is_test && (
                                        <div className="small" style={{ display: 'inline-block', marginBottom: '0.6rem', padding: '0.1rem 0.45rem', borderRadius: '4px', background: '#e8a317', color: '#3a2c00', fontWeight: 700 }}>
                                            TEST EXAMPLE
                                        </div>
                                    ))}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem' }}>
                                        <div>
                                            <label className="small">Example text</label>
                                            <textarea rows="1" value={example.textarea || ''} onChange={e => handleExampleChange(example.tempId, 'textarea', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical', minHeight: 'unset' }} />
                                        </div>
                                        <div>
                                            <label className="small">Transliteration</label>
                                            <textarea rows="1" value={example.transliteration || ''} onChange={e => handleExampleChange(example.tempId, 'transliteration', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical', minHeight: 'unset' }} />
                                        </div>
                                        <div>
                                            <label className="small">Gloss</label>
                                            <textarea rows="1" value={example.gloss || ''} onChange={e => handleExampleChange(example.tempId, 'gloss', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical', minHeight: 'unset' }} />
                                        </div>
                                        <div>
                                            <label className="small">English Translation</label>
                                            <textarea rows="1" value={example.translation || ''} onChange={e => handleExampleChange(example.tempId, 'translation', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical', minHeight: 'unset' }} />
                                        </div>
                                        <div>
                                            <label className="small">Reference</label>
                                            <input type="text" value={example.reference || ''} onChange={e => handleExampleChange(example.tempId, 'reference', e.target.value)} disabled={isReadOnly} style={{ width: '100%', padding: '0.4rem' }} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {copied && copied.langId === currentLangId && (
                            <div
                                className="card"
                                style={{
                                    marginBottom: 'var(--form-field-mb, 1rem)',
                                    padding: 'var(--form-box-pad, 1rem)',
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
                                        title="Paste the copied example(s) as new examples here (clipboard remains, you can paste into more questions)"
                                    >
                                        {copied.examples.length > 1 ? 'Paste all here' : 'Paste here'}
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
                                    {copied.examples.length > 1
                                        ? `${copied.examples.length} examples in clipboard`
                                        : 'Example in clipboard'}
                                    {copied.sourceQuestionId ? ` · from ${copied.sourceQuestionId}` : ''}
                                </h4>

                                {copied.examples.length === 1 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--form-grid-gap, 1rem)' }}>
                                        <div>
                                            <label className="small">Example text</label>
                                            <div style={clipboardFieldStyle}>{copied.examples[0].textarea || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                        </div>
                                        <div>
                                            <label className="small">Transliteration</label>
                                            <div style={clipboardFieldStyle}>{copied.examples[0].transliteration || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                        </div>
                                        <div>
                                            <label className="small">Gloss</label>
                                            <div style={clipboardFieldStyle}>{copied.examples[0].gloss || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                        </div>
                                        <div>
                                            <label className="small">English Translation</label>
                                            <div style={clipboardFieldStyle}>{copied.examples[0].translation || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                        </div>
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label className="small">Reference</label>
                                            <div style={{ ...clipboardFieldStyle, minHeight: 'auto' }}>{copied.examples[0].reference || <span className="muted" style={{ fontStyle: 'italic' }}>—</span>}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                        {copied.examples.map((example, index) => (
                                            <div key={index} style={{ ...clipboardFieldStyle, minHeight: 'auto', display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
                                                <span style={{ fontWeight: 700, color: '#dc2626', flex: '0 0 auto' }}>#{index + 1}</span>
                                                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                    {example.textarea || <span className="muted" style={{ fontStyle: 'italic' }}>(empty)</span>}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" onClick={handleAddExample} disabled={isReadOnly} className="btn">
                                + Add another example
                            </button>
                            {value.examples.some(exampleHasContent) && (
                                <button
                                    type="button"
                                    onClick={handleCopyAllExamples}
                                    disabled={isReadOnly}
                                    className="btn"
                                    style={{ color: copiedAllCount ? '#16a34a' : 'inherit', borderColor: copiedAllCount ? '#16a34a' : undefined }}
                                    title="Copy all examples of this question to the clipboard (paste them into another question of this language)"
                                >
                                    {copiedAllCount ? `✓ Copied ${copiedAllCount}` : 'Copy all'}
                                </button>
                            )}
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
                    </div>
                </div>
            )}

            <div className="info-row" style={{ marginTop: 'var(--form-col-gap, 1.5rem)' }}>
                <label className="info-row__label">Comments</label>
                <div className="info-row__content">
                    <textarea
                        rows="3"
                        value={value.comments || ''}
                        onChange={(e) => onChange({ comments: e.target.value })}
                        disabled={isReadOnly}
                        style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)', resize: 'vertical' }}
                    />
                </div>
            </div>

        </div>
    );
}