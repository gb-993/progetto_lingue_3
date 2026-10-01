import { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import QuestionRow from './QuestionRow';
import usePresence from '../../utils/usePresence';

const buildInitialAnswers = (parameter) => {
    const initial = {};
    parameter.questions.forEach(question => {
        const answer = question.answer || {};
        initial[question.id] = {
            question_id: question.id,
            response_text: answer.response_text || '',
            comments: answer.comments || '',
            motivation_ids: answer.motivation_ids || [],
            examples: answer.examples ? answer.examples.map(example => ({ ...example, tempId: example.id || Math.random() })) : []
        };
    });
    return initial;
};

// JSON stabile per capire se ci sono modifiche
const stableStringify = (value) => JSON.stringify(value, (key, val) => {
    if (key === 'tempId') return undefined;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        const sorted = {};
        Object.keys(val).sort().forEach(nestedKey => { sorted[nestedKey] = val[nestedKey]; });
        return sorted;
    }
    return val;
});

export default function ParameterBlock({
    parameter, langId, onSaved, isReadOnly,
    isAdmin = false, onAdminNoteDirtyChange, onBlockDirtyChange,
}) {
    const [isSaving, setIsSaving] = useState(false);

    const othersEditing = usePresence(
        'language_parameter', `${langId}:${parameter.id}`, !isReadOnly
    );

    // si salva insieme al blocco
    const initialAdminNote = parameter.admin_note || '';
    const [adminNote, setAdminNote] = useState(initialAdminNote);
    const [savedAdminNote, setSavedAdminNote] = useState(initialAdminNote);
    const [adminNoteOpen, setAdminNoteOpen] = useState(initialAdminNote.length > 0);
    const adminNoteDirty = isAdmin && adminNote !== savedAdminNote;

    useEffect(() => {
        onAdminNoteDirtyChange && onAdminNoteDirtyChange(adminNoteDirty);
    }, [adminNoteDirty, onAdminNoteDirtyChange]);

    const [localAnswers, setLocalAnswers] = useState(() => buildInitialAnswers(parameter));

    const [initialAnswersStr, setInitialAnswersStr] = useState(() =>
        stableStringify(buildInitialAnswers(parameter))
    );
    const blockDirty = useMemo(
        () => stableStringify(localAnswers) !== initialAnswersStr,
        [localAnswers, initialAnswersStr]
    );

    useEffect(() => {
        onBlockDirtyChange && onBlockDirtyChange(blockDirty);
    }, [blockDirty, onBlockDirtyChange]);

    // rileva salvataggi concorrenti
    const [blockLastModified, setBlockLastModified] = useState(parameter.last_modified || null);

    const [highlightedQuestionId, setHighlightedQuestionId] = useState(null);
    useEffect(() => {
        if (!highlightedQuestionId) return;
        const timer = setTimeout(() => setHighlightedQuestionId(null), 3000);
        return () => clearTimeout(timer);
    }, [highlightedQuestionId]);

    const updateAnswer = (questionId, newData) => {
        setLocalAnswers(prev => ({ ...prev, [questionId]: { ...prev[questionId], ...newData } }));
    };

    const handleFinalSave = async (isUnsure) => {
        setIsSaving(true);
        try {
            const payload = {
                is_unsure: isUnsure,
                answers: Object.values(localAnswers),
                expected_last_modified: blockLastModified,
            };
            if (isAdmin) {
                payload.admin_note = adminNote;
            }
            const res = await api.post(`/api/languages/${langId}/parameters/${parameter.id}/save_block`, payload);
            if (res.data && res.data.last_modified) {
                setBlockLastModified(res.data.last_modified);
            }
            if (isAdmin) {
                setSavedAdminNote(adminNote);
            }
            // ora il blocco non ha più modifiche
            setInitialAnswersStr(stableStringify(localAnswers));
            onSaved();
        } catch (err) {
            // 409 = modificato da un'altra sessione
            if (err.response?.status === 409) {
                const detail = err.response?.data?.detail;
                const msg = (detail && typeof detail === 'object' && detail.message)
                    ? detail.message
                    : (typeof detail === 'string' ? detail : null);
                if (msg && (msg.toLowerCase().includes('modificat') || msg.toLowerCase().includes('modified'))) {
                    alert(msg + "\n\nYour local changes have NOT been saved. The page will be reloaded.");
                    onSaved(); // forza il refetch upstream
                    return;
                }
                alert(detail?.message || detail || "Conflict: reload the page.");
                return;
            }
            const detail = err.response?.data?.detail;
            if (err.response?.status === 400 && detail && typeof detail === 'object' && detail.code === 'missing_examples') {
                alert(detail.message);
                setHighlightedQuestionId(detail.question_id);
                return;
            }
            alert(typeof detail === 'string' ? detail : "Error while saving the block.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="card parameter-block" style={{ padding: 'var(--form-box-pad-lg, 1.5rem)' }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '1rem', flexWrap: 'wrap',
                borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem',
                ...(othersEditing > 0 ? {
                    position: 'sticky',
                    top: 'var(--topbar-height)',
                    zIndex: 5,
                    paddingTop: '0.5rem',
                    background: 'var(--surface, #fff)',
                    boxShadow: '0 4px 8px -6px rgba(0,0,0,0.35)',
                } : {}),
            }}>
                <h3 style={{ margin: 0 }}>
                    {parameter.id} — {parameter.name}
                </h3>
                {othersEditing > 0 && (
                    <span
                        title="Another user is working on this parameter for this language right now. If you both save, one of you will be asked to reload — coordinate to avoid losing work."
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                            fontSize: '0.76rem', color: '#664d03',
                            background: '#fff3cd', border: '1px solid #ffe69c',
                            borderRadius: '999px', padding: '0.2rem 0.6rem', whiteSpace: 'nowrap',
                        }}
                    >
                        <span className="presence-dot" aria-hidden="true" />
                        {othersEditing > 1 ? `${othersEditing} others editing` : 'Another user editing'}
                    </span>
                )}
            </div>
            <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{parameter.short_description}</p>

            {isAdmin && (
                <div style={{
                    marginTop: 'var(--form-field-mb, 1rem)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--surface-alt, var(--surface-2))',
                }}>
                    <button
                        type="button"
                        onClick={() => setAdminNoteOpen(open => !open)}
                        style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            padding: '0.55rem 0.85rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            color: 'var(--text)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                        }}
                        aria-expanded={adminNoteOpen}
                    >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{
                                fontSize: '0.7rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px',
                                color: 'var(--text-muted)',
                            }}>
                                Admin notes
                            </span>
                            {savedAdminNote && !adminNoteDirty && (
                                <span className="status ok" style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem' }}>
                                    saved
                                </span>
                            )}
                            {adminNoteDirty && (
                                <span className="status warn" style={{ fontSize: '0.7rem', padding: '0.1rem 0.45rem' }}>
                                    unsaved
                                </span>
                            )}
                        </span>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                            {adminNoteOpen ? '▴' : '▾'}
                        </span>
                    </button>
                    {adminNoteOpen && (
                        <div style={{ padding: '0 0.85rem 0.85rem 0.85rem' }}>
                            <textarea
                                rows={3}
                                value={adminNote}
                                onChange={(e) => setAdminNote(e.target.value)}
                                disabled={isSaving}
                                placeholder="Free-text note visible only to admins. Not exported to users."
                                style={{
                                    width: '100%',
                                    padding: 'var(--form-input-pad, 0.5rem)',
                                    fontSize: '0.85rem',
                                    resize: 'vertical',
                                    fontFamily: 'inherit',
                                }}
                            />

                        </div>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-grid-gap, 1rem)', marginTop: 'var(--form-col-gap, 1.5rem)' }}>
                {parameter.questions.map(question => (
                    <QuestionRow
                        key={question.id}
                        question={question}
                        value={localAnswers[question.id]}
                        onChange={(newData) => updateAnswer(question.id, newData)}
                        isReadOnly={isReadOnly}
                        currentLangId={langId}
                        isHighlighted={highlightedQuestionId === question.id}
                        isAdmin={isAdmin}
                    />
                ))}
            </div>

            <div
                className="card parameter-finalize-sticky"
                style={{
                    marginTop: 'var(--form-col-gap, 2rem)',
                    marginLeft: 'auto',
                    width: 'fit-content',
                    maxWidth: '100%',
                    padding: '0.85rem 1rem',
                    border: '1px solid var(--border)',
                    position: 'sticky',
                    bottom: '0.75rem',
                    zIndex: 10,
                    background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                    backdropFilter: 'blur(10px)',
                    WebkitBackdropFilter: 'blur(10px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.6rem',
                    opacity: isReadOnly ? 0.6 : 1,
                }}
            >
                {isReadOnly && (
                    <div className="form-locked-banner">
                        Form locked by the current language status. Changes cannot be saved.
                    </div>
                )}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                }}>
                    <span>Everything ready and verified?</span>
                    <button
                        className="btn btn--ok"
                        onClick={() => handleFinalSave(false)}
                        disabled={isSaving || isReadOnly}
                        style={{ minWidth: '180px', background: '#16a34a', borderColor: '#15803d', color: '#fff' }}
                    >
                        {isSaving ? 'Saving...' : 'Confident -> Next'}
                    </button>
                </div>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                }}>
                    <span>Any doubts? Save for later.</span>
                    <button
                        className="btn btn--bad"
                        onClick={() => handleFinalSave(true)}
                        disabled={isSaving || isReadOnly}
                        style={{ minWidth: '180px' }}
                    >
                        {isSaving ? 'Saving...' : 'Unsure -> Next'}
                    </button>
                </div>
            </div>
        </section>
    );
}