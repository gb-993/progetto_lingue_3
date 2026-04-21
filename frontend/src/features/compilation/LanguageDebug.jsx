import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';

export default function LanguageDebug() {
    const { id } = useParams();
    const [debugData, setDebugData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isRunningDag, setIsRunningDag] = useState(false);
    const [error, setError] = useState('');

    const fetchDebugData = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/api/languages/${id}/debug`);
            setDebugData(res.data);
            setError('');
        } catch (err) {
            console.error(err);
            setError('Impossibile caricare i dati di debug.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDebugData(); }, [id]);

    const handleRunDag = async () => {
        if (!window.confirm("Attenzione: questo approverà tutte le risposte e forzerà il ricalcolo. Procedere?")) return;

        setIsRunningDag(true);
        try {
            const res = await api.post(`/api/languages/${id}/workflow/run_dag`);
            alert(res.data.detail);
            fetchDebugData(); // Ricarica la tabella per mostrare i nuovi valori ricalcolati
        } catch (err) {
            alert(err.response?.data?.detail || "Errore durante l'esecuzione del DAG");
        } finally {
            setIsRunningDag(false);
        }
    };

    if (loading) return <div className="container" style={{ marginTop: '2rem' }}>Caricamento...</div>;
    if (error) return <div className="container alert alert-error" style={{ marginTop: '2rem' }}>{error}</div>;
    if (!debugData) return null;

    return (
        <div className="container page-debug" style={{ marginTop: '2rem', paddingBottom: '10rem' }}>

            {/* Header Sospeso (Glass Effect) */}
            <div className="sticky-debug-header" style={{
                position: 'sticky', top: '1rem', zIndex: 1000, padding: '1.25rem 1.5rem', marginBottom: '2rem',
                borderRadius: '12px', border: '1px solid var(--border)',
                background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
            }}>
                <h1 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem', color: 'var(--text)' }}>
                    Parameters Debug — {debugData.language.name_full} ({debugData.language.id})
                </h1>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Link to={`/languages/${id}/data`} className="btn">Back to language data</Link>
                    <button
                        onClick={handleRunDag}
                        className="btn btn--primary"
                        disabled={isRunningDag}
                    >
                        {isRunningDag ? 'Elaborazione in corso...' : 'Apply implicational condition(s) & Approve'}
                    </button>
                </div>
            </div>

            {/* Tabella Dati */}
            <div className="table-responsive">
                <table className="table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                    <thead style={{ background: 'var(--surface-2)' }}>
                    <tr>
                        <th>#</th>
                        <th>Label</th>
                        <th>Questions</th>
                        <th>Answers</th>
                        <th>Initial value</th>
                        <th>Warn (init)</th>
                        <th>Condition(s)</th>
                        <th>Check</th>
                        <th>Final value</th>
                        <th>Warn (final)</th>
                    </tr>
                    </thead>
                    <tbody>
                    {debugData.rows.map(r => (
                        <tr key={r.param_id} id={`p-${r.param_id}`}>
                            <td>{r.position}</td>
                            <td>
                                <Link to={`/languages/${id}/data#p-${r.param_id}`} style={{ textDecoration: 'underline', fontWeight: 'bold' }}>
                                    {r.param_id}
                                </Link>
                            </td>
                            <td>{r.questions.map(q => <div key={q}><code>{q}</code></div>)}</td>
                            <td>{r.answers.map((a, idx) => <div key={idx}>{a || <span className="muted">—</span>}</div>)}</td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {r.initial || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }}>{r.warn_init && <span style={{ color: 'red', fontWeight: 'bold' }}>⚠</span>}</td>
                            <td>{r.cond ? <code>{r.cond}</code> : <span className="muted">—</span>}</td>
                            <td style={{ textAlign: 'center' }}>
                                {r.cond_true === true && <span style={{ background: '#d1e7dd', color: '#0f5132', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>TRUE</span>}
                                {r.cond_true === false && <span style={{ background: '#f8d7da', color: '#842029', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>FALSE</span>}
                                {r.cond_true === null && <span className="muted">—</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {r.final === '?' ? <span style={{ color: '#d63384' }}>?</span> : r.final || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }}>{r.warn_final && <span style={{ color: 'red', fontWeight: 'bold' }}>⚠</span>}</td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}