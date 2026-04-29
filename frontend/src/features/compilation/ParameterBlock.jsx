import { useState, useEffect } from 'react';
import api from '../../api';
import QuestionRow from './QuestionRow';

export default function ParameterBlock({
    parameter, langId, onSaved, isReadOnly,
    isAdmin = false, onAdminNoteDirtyChange,
}) {
    const [isSaving, setIsSaving] = useState(false);

    // Admin-only: nota libera per (lingua, parametro). Il valore originale viene
    // dal payload /compilation (solo se admin). Viene persistita insieme al
    // save_block: il backend riceve `admin_note` nel payload e aggiorna la riga
    // LanguageParameterStatus. Niente endpoint dedicato.
    const initialAdminNote = parameter.admin_note || '';
    const [adminNote, setAdminNote] = useState(initialAdminNote);
    const [savedAdminNote, setSavedAdminNote] = useState(initialAdminNote);
    const [adminNoteOpen, setAdminNoteOpen] = useState(initialAdminNote.length > 0);
    const adminNoteDirty = isAdmin && adminNote !== savedAdminNote;

    useEffect(() => {
        onAdminNoteDirtyChange && onAdminNoteDirtyChange(adminNoteDirty);
    }, [adminNoteDirty, onAdminNoteDirtyChange]);

    // Stato locale: mappa { [questionId]: { response_text, comments, motivation_ids, examples } }
    const [localAnswers, setLocalAnswers] = useState(() => {
        const initial = {};
        parameter.questions.forEach(q => {
            const ans = q.answer || {};
            initial[q.id] = {
                question_id: q.id,
                response_text: ans.response_text || '',
                comments: ans.comments || '',
                motivation_ids: ans.motivation_ids || [],
                examples: ans.examples ? ans.examples.map(ex => ({ ...ex, tempId: ex.id || Math.random() })) : []
            };
        });
        return initial;
    });

    // Fingerprint del blocco al caricamento — usato per optimistic concurrency.
    // Aggiornato dopo ogni save riuscito così salvataggi consecutivi non triggerano falsi conflitti.
    const [blockLastModified, setBlockLastModified] = useState(parameter.last_modified || null);

    const updateAnswer = (qId, newData) => {
        setLocalAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], ...newData } }));
    };

    const handleFinalSave = async (isUnsure) => {
        setIsSaving(true);
        try {
            const payload = {
                is_unsure: isUnsure,
                answers: Object.values(localAnswers),
                expected_last_modified: blockLastModified,
            };
            // Includi la admin_note solo se admin: il backend la ignora per gli
            // utenti normali, ma evitiamo di mandarla del tutto per sicurezza.
            if (isAdmin) {
                payload.admin_note = adminNote;
            }
            const res = await api.post(`/api/languages/${langId}/parameters/${parameter.id}/save_block`, payload);
            // Aggiorna il fingerprint locale (utile se l'utente continua senza onSaved che rimonta il componente)
            if (res.data && res.data.last_modified) {
                setBlockLastModified(res.data.last_modified);
            }
            // Allinea lo stato saved della admin-note: dopo un save_block andato a
            // buon fine la nota è persistita in DB ed equivale a quella locale.
            if (isAdmin) {
                setSavedAdminNote(adminNote);
            }
            onSaved();
        } catch (err) {
            // 409 = blocco modificato da un'altra sessione (es. admin in parallelo)
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
            alert(typeof detail === 'string' ? detail : "Error while saving the block.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <section className="card parameter-block" style={{ padding: '1.5rem' }}>
            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                {parameter.id} — {parameter.name}
            </h3>
            <p className="muted">{parameter.short_description}</p>

            {isAdmin && (
                <div style={{
                    marginTop: '1rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--surface-alt, var(--surface-2))',
                }}>
                    <button
                        type="button"
                        onClick={() => setAdminNoteOpen(o => !o)}
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
                                    padding: '0.5rem',
                                    fontSize: '0.85rem',
                                    resize: 'vertical',
                                    fontFamily: 'inherit',
                                }}
                            />
                            <div className="small muted" style={{ marginTop: '0.35rem' }}>
                                Saved together with the block when you click <em>Confident</em> or <em>Unsure</em> below.
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                {parameter.questions.map(q => (
                    <QuestionRow
                        key={q.id}
                        question={q}
                        value={localAnswers[q.id]}
                        onChange={(newData) => updateAnswer(q.id, newData)}
                        isReadOnly={isReadOnly}
                        currentLangId={langId}
                    />
                ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {isReadOnly && (
                    <div className="form-locked-banner">
                        Form locked by the current language status. Changes cannot be saved.
                    </div>
                )}
                <div className="parameter-finalize-row" style={{ opacity: isReadOnly ? 0.6 : 1 }}>
                    <span>Everything ready and verified?</span>
                    <button className="btn btn--ok" onClick={() => handleFinalSave(false)} disabled={isSaving || isReadOnly}>
                        {isSaving ? 'Saving...' : `Confident -> Next ${parameter.id}`}
                    </button>
                </div>
                <div className="parameter-finalize-row" style={{ opacity: isReadOnly ? 0.6 : 1 }}>
                    <span>Any doubts? Flag for later.</span>
                    <button className="btn btn--bad" onClick={() => handleFinalSave(true)} disabled={isSaving || isReadOnly}>
                        {isSaving ? 'Saving...' : 'Unsure -> Next'}
                    </button>
                </div>
            </div>
        </section>
    );
}