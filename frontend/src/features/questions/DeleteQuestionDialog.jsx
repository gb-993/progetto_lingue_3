import { useState, useEffect } from 'react';
import api from '../../api';

/**
 * Dialogo UNICO di ELIMINAZIONE DEFINITIVA di una question gia' disattivata,
 * condiviso da QuestionList e ParameterForm (gemello di DeactivateQuestionDialog:
 * stesso comportamento ovunque). Mostra i dati collegati che verranno archiviati
 * e poi rimossi, e chiede conferma esplicita. Qualunque modifica futura va fatta
 * SOLO qui.
 *
 * Props:
 *   questionId  : id della question da eliminare
 *   onClose()   : annulla, nessuna eliminazione
 *   onDeleted() : chiamata DOPO l'eliminazione riuscita
 *                 (il chiamante chiude e ricarica la sua lista)
 */
export default function DeleteQuestionDialog({ questionId, onClose, onDeleted }) {
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await api.get(`/api/admin/questions/${questionId}/data-stats`);
                if (!cancelled) setStats(res.data || { answers: 0, examples: 0, languages: 0 });
            } catch {
                if (!cancelled) setStats({ answers: 0, examples: 0, languages: 0, error: true });
            } finally {
                if (!cancelled) setStatsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [questionId]);

    const doDelete = async () => {
        setBusy(true);
        try {
            await api.delete(`/api/admin/questions/${questionId}`);
            onDeleted();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error while deleting the question.');
            setBusy(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
            <div className="card" style={{ width: '480px', maxWidth: '92vw' }}>
                <h3 style={{ marginTop: 0 }}>Permanently delete question {questionId}?</h3>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem 0.85rem', margin: '0.75rem 0', fontSize: '0.85rem' }}>
                    {statsLoading && <span>Loading linked data…</span>}
                    {!statsLoading && stats && (
                        stats.answers > 0
                            ? <span><strong>{stats.answers}</strong> answer(s), <strong>{stats.examples}</strong> example(s) in <strong>{stats.languages}</strong> language(s) will be <strong>archived</strong> (kept in Archived Questions), then this question will be removed.</span>
                            : <span>No linked data on this question. It will be removed.</span>
                    )}
                </div>
                <p className="small muted" style={{ marginTop: 0 }}>
                    This is permanent and cannot be undone. A snapshot is kept in History.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' }}
                        onClick={doDelete}
                        disabled={busy || statsLoading}
                    >
                        {busy ? 'Deleting…' : 'Delete permanently'}
                    </button>
                </div>
            </div>
        </div>
    );
}
