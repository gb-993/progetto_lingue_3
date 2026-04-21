import { useState } from 'react';
import api from '../../api';
import QuestionRow from './QuestionRow';

export default function ParameterBlock({ parameter, langId, onSaved, isReadOnly }) {
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

    const updateAnswer = (qId, newData) => {
        setLocalAnswers(prev => ({ ...prev, [qId]: { ...prev[qId], ...newData } }));
    };

    const handleFinalSave = async (isUnsure) => {
        setIsSaving(true);
        try {
            const payload = {
                is_unsure: isUnsure,
                answers: Object.values(localAnswers)
            };
            await api.post(`/api/languages/${langId}/parameters/${parameter.id}/save_block`, payload);
            onSaved(); // Ricarica dati e vai avanti
        } catch (err) {
            alert("Errore nel salvataggio del blocco.");
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
                    />
                ))}
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
                    <span>Tutto pronto e verificato?</span>
                    <button className="btn btn--ok" onClick={() => handleFinalSave(false)} disabled={isSaving}>
                        {isSaving ? 'Salvataggio...' : `Confident -> Next ${parameter.id}`}
                    </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', background: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
                    <span>Hai dei dubbi? Segnala per dopo.</span>
                    <button className="btn btn--bad" onClick={() => handleFinalSave(true)} disabled={isSaving}>
                        {isSaving ? 'Salvataggio...' : 'Unsure -> Next'}
                    </button>
                </div>
            </div>
        </section>
    );
}