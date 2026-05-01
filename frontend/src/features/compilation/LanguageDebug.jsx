import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';

const SHOW_INACTIVE_KEY = 'language-debug.show-inactive-questions';

export default function LanguageDebug() {
    const { id } = useParams();
    const [debugData, setDebugData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isRunningDag, setIsRunningDag] = useState(false);
    const [error, setError] = useState('');
    const [showInactive, setShowInactive] = useState(() => {
        try { return localStorage.getItem(SHOW_INACTIVE_KEY) === '1'; } catch { return false; }
    });

    const toggleShowInactive = (val) => {
        setShowInactive(val);
        try { localStorage.setItem(SHOW_INACTIVE_KEY, val ? '1' : '0'); } catch {}
    };

    const fetchDebugData = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/api/languages/${id}/debug`);
            setDebugData(res.data);
            setError('');
        } catch (err) {
            console.error(err);
            setError('Could not load the debug data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchDebugData(); }, [id]);

    const handleRunDag = async () => {
        setIsRunningDag(true);
        try {
            await api.post(`/api/languages/${id}/workflow/run_dag`);
            fetchDebugData();
        } catch (err) {
            setError(err.response?.data?.detail || "Error while running the DAG");
        } finally {
            setIsRunningDag(false);
        }
    };

    if (loading) return <div className="container" style={{ marginTop: '2rem' }}>Loading...</div>;
    if (error) return <div className="container alert alert-error" style={{ marginTop: '2rem' }}>{error}</div>;
    if (!debugData) return null;

    return (
        <div className="container page-debug" style={{ marginTop: '2rem', paddingBottom: '10rem' }}>

            {/* Header Sospeso (Glass Effect) */}
            <div className="sticky-debug-header" style={{
                position: 'sticky', top: '1rem', zIndex: 1000, padding: '1.25rem 1.5rem', marginBottom: '2rem',
                borderRadius: '12px', border: '1px solid var(--border)',
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08)'
            }}>
                <h1 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem', color: 'var(--text)' }}>
                    Parameters Debug — {debugData.language.name_full} ({debugData.language.id})
                </h1>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Link to={`/languages/${id}/data`} className="btn">Back to language data</Link>
                    <button
                        onClick={handleRunDag}
                        className="btn btn--primary"
                        disabled={isRunningDag}
                    >
                        {isRunningDag ? 'Processing...' : 'Apply implicational condition(s)'}
                    </button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}>
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => toggleShowInactive(e.target.checked)}
                        />
                        Show inactive questions
                    </label>
                </div>

                <div style={{ marginTop: '0.85rem', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{
                            display: 'inline-block', width: '0.9rem', height: '0.9rem',
                            background: 'color-mix(in oklab, var(--warn) 18%, transparent)',
                            borderLeft: '3px solid var(--warn)'
                        }} />
                        <span style={{ color: 'var(--warn)', fontWeight: 'bold' }}>!</span>
                        <span>Input warning — conflict on answers (informational, does not block the result)</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ color: 'red', fontWeight: 'bold' }}>!</span>
                        <span>Eval warning — uncertain final value (propagates downstream)</span>
                    </span>
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
                    {debugData.rows.map(r => {
                        const visibleQs = showInactive ? r.questions : r.questions.filter(q => q.is_active);
                        return (
                        <tr key={r.param_id} id={`p-${r.param_id}`}>
                            <td>{r.position}</td>
                            <td>
                                <Link to={`/languages/${id}/data#p-${r.param_id}`} style={{ textDecoration: 'underline', fontWeight: 'bold' }}>
                                    {r.param_id}
                                </Link>
                            </td>
                            <td>{visibleQs.map(q => (
                                <div key={q.id} style={{ opacity: q.is_active ? 1 : 0.5 }} title={q.is_active ? undefined : 'Inactive question'}>
                                    <code>{q.id}</code>
                                </div>
                            ))}</td>
                            <td>{visibleQs.map(q => (
                                <div key={q.id} style={{ opacity: q.is_active ? 1 : 0.5 }}>
                                    {q.answer || <span className="muted">—</span>}
                                </div>
                            ))}</td>
                            <td
                                style={{
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    background: r.warn_init ? 'color-mix(in oklab, var(--warn) 18%, transparent)' : undefined,
                                    borderLeft: r.warn_init ? '3px solid var(--warn)' : undefined,
                                }}
                                title={r.warn_init ? 'Conflict between question/stop-question answers' : undefined}
                            >
                                {r.initial || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }} title={r.warn_init ? 'Conflict on the input answers (informational)' : undefined}>
                                {r.warn_init && <span style={{ color: 'var(--warn)', fontWeight: 'bold' }}>!</span>}
                            </td>
                            <td>{r.cond ? <code>{r.cond}</code> : <span className="muted">—</span>}</td>
                            <td style={{ textAlign: 'center' }}>
                                {r.cond_true === true && <span style={{ background: '#d1e7dd', color: '#0f5132', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>TRUE</span>}
                                {r.cond_true === false && <span style={{ background: '#f8d7da', color: '#842029', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>FALSE</span>}
                                {r.cond_true === null && <span className="muted">—</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {r.final === '?' ? <span style={{ color: '#d63384' }}>?</span> : r.final || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }} title={r.warn_final ? 'Eval is uncertain (warning propagated or unresolved condition)' : undefined}>
                                {r.warn_final && <span style={{ color: 'red', fontWeight: 'bold' }}>!</span>}
                            </td>
                        </tr>
                        );
                    })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}