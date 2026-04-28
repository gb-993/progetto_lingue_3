import React, { useState, useEffect, useMemo } from 'react';
import Select from 'react-select';

export default function QuestionRow({ question, value, onChange, isReadOnly, allExamples = [], currentLangId }) {
    const [localError, setLocalError] = useState('');

    // Validazione base in tempo reale per gli esempi
    useEffect(() => {
        if (value.response_text === 'yes') {
            // FIX: Aggiunto (ex.textarea || '') per evitare il crash su valori null dal database
            const validExamples = value.examples.filter(ex => (ex.textarea || '').trim() !== '');
            if (value.examples.length > 0 && validExamples.length < 2) {
                setLocalError('Reminder: If you select YES, you should provide at least two valid examples.');
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

    // --- IMPORT ESEMPI ---
    // Opzioni raggruppate per lingua: lingua corrente prima, poi le altre in ordine alfabetico
    const importExampleOptions = useMemo(() => {
        if (!allExamples || allExamples.length === 0) return [];

        const byLang = {};
        for (const ex of allExamples) {
            const k = ex.language_id;
            if (!byLang[k]) {
                byLang[k] = { language_id: ex.language_id, language_name: ex.language_name, items: [] };
            }
            byLang[k].items.push(ex);
        }

        Object.values(byLang).forEach(g => {
            g.items.sort((a, b) => {
                const c = String(a.question_id).localeCompare(String(b.question_id));
                return c !== 0 ? c : String(a.textarea).localeCompare(String(b.textarea));
            });
        });

        const groups = Object.values(byLang).sort((a, b) => {
            if (a.language_id === currentLangId) return -1;
            if (b.language_id === currentLangId) return 1;
            return String(a.language_name).localeCompare(String(b.language_name));
        });

        return groups.map(g => ({
            label: `${g.language_name} (${g.language_id})${g.language_id === currentLangId ? ' — this language' : ''}`,
            options: g.items.map(ex => {
                const txt = (ex.textarea || '').trim();
                const snippet = txt.length > 70 ? `${txt.slice(0, 70)}…` : txt;
                const sameQ = ex.question_id === question.id ? ' (same question)' : '';
                return {
                    value: ex.id,
                    label: `[${ex.question_id}${sameQ}] ${snippet}`,
                    example: ex
                };
            })
        }));
    }, [allExamples, currentLangId, question.id]);

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
        <div className="card" style={{ padding: '1.5rem', background: 'var(--surface, #fff)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', marginBottom: '1rem' }}>

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

            {/* Istruzione condizionale YES/NO */}
            {value.response_text === 'yes' && question.instruction_yes && (
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
                    </select>
                </div>
            </div>

            {/* BLOCCO NO: Motivazioni */}
            {value.response_text === 'no' && question.allowed_motivations.length > 0 && (
                <div className="info-row">
                    <div className="info-row__label">Motivations</div>
                    <div className="info-row__content">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--surface-2)', padding: '1rem', borderRadius: '6px' }}>
                            {question.allowed_motivations.map(m => (
                                <label key={m.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: isReadOnly ? 'not-allowed' : 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={value.motivation_ids.includes(m.id)}
                                        onChange={() => handleMotivationToggle(m.id)}
                                        disabled={isReadOnly}
                                    />
                                    <strong>{m.label}</strong>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* BLOCCO YES: Esempi */}
            {value.response_text === 'yes' && (
                <div className="info-row" style={{ marginTop: '1.5rem' }}>
                    <div className="info-row__label">Examples</div>
                    <div className="info-row__content">

                        {localError && <div className="alert alert-warning" style={{ marginBottom: '1rem', fontWeight: 'bold' }}>{localError}</div>}

                        {value.examples.map((ex, index) => (
                            <div key={ex.tempId} className="card" style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--surface-2)', position: 'relative' }}>
                                <div style={{ position: 'absolute', top: '0.5rem', right: '0.5rem' }}>
                                    <button type="button" onClick={() => handleRemoveExample(ex.tempId)} disabled={isReadOnly} className="btn btn--small" style={{ color: 'red', borderColor: 'transparent' }}>Remove</button>
                                </div>
                                <h4 style={{ marginTop: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Example #{index + 1}</h4>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label className="small">Example text</label>
                                        <textarea rows="2" value={ex.textarea || ''} onChange={e => handleExampleChange(ex.tempId, 'textarea', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                    </div>
                                    <div>
                                        <label className="small">Transliteration</label>
                                        <textarea rows="2" value={ex.transliteration || ''} onChange={e => handleExampleChange(ex.tempId, 'transliteration', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                    </div>
                                    <div>
                                        <label className="small">Gloss</label>
                                        <textarea rows="2" value={ex.gloss || ''} onChange={e => handleExampleChange(ex.tempId, 'gloss', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                    </div>
                                    <div>
                                        <label className="small">English Translation</label>
                                        <textarea rows="2" value={ex.translation || ''} onChange={e => handleExampleChange(ex.tempId, 'translation', e.target.value)} disabled={isReadOnly} style={{ width: '100%', resize: 'vertical' }} />
                                    </div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label className="small">Reference</label>
                                        <input type="text" value={ex.reference || ''} onChange={e => handleExampleChange(ex.tempId, 'reference', e.target.value)} disabled={isReadOnly} style={{ width: '100%', padding: '0.4rem' }} />
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" onClick={handleAddExample} disabled={isReadOnly} className="btn">
                                + Add another example
                            </button>
                            <div style={{ flex: '1 1 280px', minWidth: '260px' }}>
                                <Select
                                    isClearable
                                    isDisabled={isReadOnly}
                                    options={importExampleOptions}
                                    value={null}
                                    onChange={handleImportExample}
                                    placeholder="+ Import example from another answer..."
                                    noOptionsMessage={() => "No example available"}
                                />
                            </div>
                        </div>
                        <p className="small muted" style={{ marginTop: '0.4rem' }}>
                            Tip: "(same question)" marks examples of the same question in another language. The imported example is a copy, edit it freely.
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