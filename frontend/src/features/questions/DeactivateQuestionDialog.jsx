import { useState, useEffect } from 'react';
import api from '../../api';
import CopyExamplesModal from './CopyExamplesModal';

/**
 * Dialogo UNICO di disattivazione di una question, condiviso da QuestionList
 * e ParameterForm: la disattivazione deve comportarsi allo stesso modo
 * ovunque (stesse opzioni, stesso testo). Qualunque modifica futura va fatta
 * SOLO qui.
 *
 * Si occupa di tutto da solo: carica le stats dei dati collegati, offre
 * "Copy examples, then deactivate…" (solo se ci sono esempi), esegue la
 * PATCH di disattivazione.
 *
 * Props:
 *   questionId      : id della question da disattivare
 *   onClose()       : annulla, nessuna disattivazione
 *   onDeactivated() : chiamata DOPO la disattivazione riuscita
 *                     (il chiamante chiude e ricarica la sua lista)
 */
export default function DeactivateQuestionDialog({ questionId, onClose, onDeactivated }) {
    const [stats, setStats] = useState(null);
    const [statsLoading, setStatsLoading] = useState(true);
    const [copyOpen, setCopyOpen] = useState(false);
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

    const doDeactivate = async () => {
        setBusy(true);
        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            onDeactivated();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error while changing the question status.');
            setBusy(false);
        }
    };

    // Copia esempi scelta dal dialogo: a copia confermata e riepilogo chiuso
    // si disattiva; Cancel a metà copia = nessuna disattivazione.
    if (copyOpen) {
        return (
            <CopyExamplesModal
                sourceQuestionId={questionId}
                onClose={onClose}
                onCopied={doDeactivate}
            />
        );
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
            <div className="card" style={{ width: '480px', maxWidth: '92vw' }}>
                <h3 style={{ marginTop: 0 }}>Deactivate question {questionId}?</h3>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.6rem 0.85rem', margin: '0.75rem 0', fontSize: '0.85rem' }}>
                    {statsLoading && <span>Loading linked data…</span>}
                    {!statsLoading && stats && (
                        stats.answers > 0
                            ? <span><strong>{stats.answers}</strong> answer(s), <strong>{stats.examples}</strong> example(s) in <strong>{stats.languages}</strong> language(s) are linked to this question.</span>
                            : <span>No linked data on this question.</span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    {!statsLoading && stats && stats.examples > 0 && (
                        <button
                            type="button"
                            className="btn"
                            title="Copy only the examples to another question (answers and motivations stay here), then deactivate"
                            onClick={() => setCopyOpen(true)}
                            disabled={busy}
                        >
                            Copy examples, then deactivate…
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#d9534f', borderColor: '#d9534f', color: '#fff' }}
                        onClick={doDeactivate}
                        disabled={busy || statsLoading}
                    >
                        {busy ? 'Deactivating…' : 'Deactivate'}
                    </button>
                </div>
            </div>
        </div>
    );
}
