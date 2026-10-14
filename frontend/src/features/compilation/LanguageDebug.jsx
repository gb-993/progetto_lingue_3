import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';
import LegendPopover, { LegendGroup, LegendItem } from '../../components/LegendPopover';

const SHOW_INACTIVE_KEY = 'language-debug.show-inactive-questions';

// '0+' solo a schermo: nei calcoli resta 0
const displayFinalValue = (initial, final) => (initial === '+' && final === '0' ? '0+' : final);

const conflictCellStyle = {
    background: 'color-mix(in oklab, var(--warn) 18%, transparent)',
    borderLeft: '3px solid var(--warn)',
};
const badgeStyle = { padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' };

const ConflictMark = () => <span style={{ color: 'var(--warn)', fontWeight: 'bold' }}>!</span>;
const UncertainMark = () => <span style={{ color: 'var(--brand)', fontWeight: 'bold' }}>!</span>;
const UncertainValue = () => <span style={{ color: 'var(--brand)', fontWeight: 'bold' }}>?</span>;
const TrueBadge = () => <span style={{ ...badgeStyle, background: '#d1e7dd', color: '#0f5132' }}>TRUE</span>;
const FalseBadge = () => <span style={{ ...badgeStyle, background: 'var(--pill-bad-bg)', color: 'var(--brand)' }}>FALSE</span>;
const ConflictCellSample = () => <span style={{ display: 'inline-block', width: '0.9rem', height: '0.9rem', ...conflictCellStyle }} />;

function SymbolLegend() {
    return (
        <LegendPopover>
            <LegendGroup title="Initial value" />
            <LegendItem symbol="+">A regular question is YES</LegendItem>
            <LegendItem symbol="-">A stop question is YES, or all questions are NO</LegendItem>
            <LegendItem symbol={<span className="muted" style={{ fontWeight: 'normal' }}>empty</span>}>Not decidable yet</LegendItem>
            <LegendItem symbol={<><ConflictCellSample /><ConflictMark /></>}>Conflict: a question and a stop question are both YES</LegendItem>

            <LegendGroup title="Final value" />
            <LegendItem symbol="0+">0, but the answers alone give + </LegendItem>
            <LegendItem symbol={<><UncertainValue /><UncertainMark /></>}>
                Uncertain: answers missing or in conflict, or condition uncertain or broken. Passed on to dependent parameters
            </LegendItem>
        </LegendPopover>
    );
}

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
        try { localStorage.setItem(SHOW_INACTIVE_KEY, val ? '1' : '0'); } catch { /* storage non disponibile: preferenza non persistita */ }
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

    const formulaErrors = debugData.formula_errors || [];

    return (
        <div className="container page-debug" style={{ marginTop: '2rem', paddingBottom: '10rem' }}>

            <div className="sticky-debug-header" style={{
                position: 'sticky', top: 'calc(var(--topbar-height) + 1rem)', zIndex: 10, padding: '1.25rem 1.5rem', marginBottom: '2rem',
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
                    <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={showInactive}
                                onChange={(e) => toggleShowInactive(e.target.checked)}
                            />
                            Show inactive questions
                        </label>
                        <SymbolLegend />
                    </div>
                </div>
            </div>

            {formulaErrors.length > 0 && (
                <div className="alert alert-error" role="alert" style={{ marginBottom: '1.5rem' }}>
                    <strong>
                        {formulaErrors.length === 1
                            ? '1 implicational condition cannot be used.'
                            : `${formulaErrors.length} implicational conditions cannot be used.`}
                    </strong>{' '}
                    The final value of these parameters, and of the parameters that depend on them, is set
                    to “?” in every language until the condition is fixed.
                    <ul style={{ margin: '0.5rem 0 0 1.2rem' }}>
                        {formulaErrors.map(formulaError => (
                            <li key={formulaError.param_id}>
                                <Link to={`/admin/parameters/${formulaError.param_id}/edit`} style={{ textDecoration: 'underline', fontWeight: 'bold' }}>
                                    {formulaError.param_id}
                                </Link>
                                {' '}<code>{formulaError.condition}</code> — {formulaError.reason}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

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
                        <th>Implicational condition(s)</th>
                        <th>Check</th>
                        <th>Final value</th>
                        <th>Warn (final)</th>
                    </tr>
                    </thead>
                    <tbody>
                    {debugData.rows.map(row => {
                        const visibleQuestions = showInactive ? row.questions : row.questions.filter(question => question.is_active);
                        return (
                        <tr key={row.param_id} id={`p-${row.param_id}`}>
                            <td>{row.position}</td>
                            <td>
                                <Link to={`/languages/${id}/data#p-${row.param_id}`} style={{ textDecoration: 'underline', fontWeight: 'bold' }}>
                                    {row.param_id}
                                </Link>
                            </td>
                            <td>{visibleQuestions.map(question => (
                                <div key={question.id} style={{ opacity: question.is_active ? 1 : 0.5 }} title={question.is_active ? undefined : 'Inactive question'}>
                                    <code>{question.id}</code>
                                </div>
                            ))}</td>
                            <td>{visibleQuestions.map(question => (
                                <div key={question.id} style={{ opacity: question.is_active ? 1 : 0.5 }}>
                                    {question.answer || <span className="muted">—</span>}
                                </div>
                            ))}</td>
                            <td
                                style={{
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    ...(row.warn_init ? conflictCellStyle : {}),
                                }}
                                title={row.warn_init ? 'Answer conflict: a question and a stop question are both YES' : undefined}
                            >
                                {row.initial || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }} title={row.warn_init ? 'Answer conflict: a question and a stop question are both YES' : undefined}>
                                {row.warn_init && <ConflictMark />}
                            </td>
                            <td>{row.cond ? <code>{row.cond}</code> : <span className="muted">—</span>}</td>
                            <td style={{ textAlign: 'center' }}>
                                {row.cond_true === true && <TrueBadge />}
                                {row.cond_true === false && <FalseBadge />}
                                {row.cond_true === null && <span className="muted">—</span>}
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                {row.final === '?'
                                    ? <UncertainValue />
                                    : displayFinalValue(row.initial, row.final) || <span className="muted"> </span>}
                            </td>
                            <td style={{ textAlign: 'center' }} title={row.warn_final ? 'Uncertain final value' : undefined}>
                                {row.warn_final && <UncertainMark />}
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
