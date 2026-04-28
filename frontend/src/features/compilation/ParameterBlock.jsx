import { useState } from 'react';
import api from '../../api';
import QuestionRow from './QuestionRow';

export default function ParameterBlock({ parameter, langId, onSaved, isReadOnly, allExamples = [] }) {
    const [isSaving, setIsSaving] = useState(false);

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
            const res = await api.post(`/api/languages/${langId}/parameters/${parameter.id}/save_block`, payload);
            // Aggiorna il fingerprint locale (utile se l'utente continua senza onSaved che rimonta il componente)
            if (res.data && res.data.last_modified) {
                setBlockLastModified(res.data.last_modified);
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
        <section className="card" style={{ padding: '1.5rem', backgroundColor: '#f9f9f9' }}>
            <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                {parameter.id} — {parameter.name}
            </h3>
            <p className="muted">{parameter.short_description}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                {parameter.questions.map(q => (
                    <QuestionRow
                        key={q.id}
                        question={q}
                        value={localAnswers[q.id]}
                        onChange={(newData) => updateAnswer(q.id, newData)}
                        isReadOnly={isReadOnly}
                        allExamples={allExamples}
                        currentLangId={langId}
                    />
                ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {isReadOnly && (
                    <div style={{ padding: '0.75rem 1rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', color: '#475569', fontSize: '0.9rem' }}>
                        Form locked by the current language status. Changes cannot be saved.
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd', opacity: isReadOnly ? 0.6 : 1 }}>
                    <span>Everything ready and verified?</span>
                    <button className="btn btn--ok" onClick={() => handleFinalSave(false)} disabled={isSaving || isReadOnly}>
                        {isSaving ? 'Saving...' : `Confident -> Next ${parameter.id}`}
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd', opacity: isReadOnly ? 0.6 : 1 }}>
                    <span>Any doubts? Flag for later.</span>
                    <button className="btn btn--bad" onClick={() => handleFinalSave(true)} disabled={isSaving || isReadOnly}>
                        {isSaving ? 'Saving...' : 'Unsure -> Next'}
                    </button>
                </div>
            </div>
        </section>
    );
}