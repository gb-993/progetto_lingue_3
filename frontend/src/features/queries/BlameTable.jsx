import { useState, useCallback, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

const MAX_DEPTH = 20;

// Cella di espansione: freccia L (verticale + orizzontale + arrowhead) a sinistra,
// contenuto annidato a destra. La freccia parte dal bordo superiore della cella, cosi'
// visivamente si aggancia alla riga padre.
function ExpandedCell({ children }) {
    const arrowColor = 'var(--text-muted, #888)';
    return (
        <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 28 }}>
            <div style={{ width: 26, flexShrink: 0, position: 'relative' }}>
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 11,
                    width: 14,
                    height: 22,
                    borderLeft: `1.5px solid ${arrowColor}`,
                    borderBottom: `1.5px solid ${arrowColor}`,
                    borderBottomLeftRadius: 6,
                }}>
                    <span style={{
                        position: 'absolute',
                        right: -3,
                        bottom: -5,
                        width: 0,
                        height: 0,
                        borderTop: '4px solid transparent',
                        borderBottom: '4px solid transparent',
                        borderLeft: `6px solid ${arrowColor}`,
                    }} />
                </div>
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 4, paddingBottom: 6, paddingRight: 6 }}>
                {children}
            </div>
        </div>
    );
}

const STATUS_META = {
    neutralized:        { label: 'NEUTRALIZED (0)',           bg: '#f8d7da', fg: '#721c24', border: '#dc3545' },
    active:             { label: 'ACTIVE',                    bg: '#d4edda', fg: '#155724', border: '#28a745' },
    set_directly:       { label: 'SET DIRECTLY (from answer)',bg: '#fff3cd', fg: '#856404', border: '#ffc107' },
    warning_propagated: { label: 'WARNING (?)',               bg: '#fff3cd', fg: '#856404', border: '#ffc107' },
    no_condition:       { label: 'NO CONDITION',              bg: '#e2e3e5', fg: '#383d41', border: '#6c757d' },
    parse_error:        { label: 'PARSE ERROR',               bg: '#f8d7da', fg: '#721c24', border: '#dc3545' },
    no_answers:         { label: 'NO ANSWERS',                bg: '#e2e3e5', fg: '#383d41', border: '#6c757d' },
};

export default function BlameTable({ q3Response, langId, depth = 0, cache: parentCache }) {
    // Stable Map that survives re-renders; shared with nested instances when passed as prop.
    const cache = useMemo(() => parentCache ?? new Map(), [parentCache]);

    const [nested, setNested] = useState({});
    const [loading, setLoading] = useState({});
    const [error, setError] = useState({});
    const [showOther, setShowOther] = useState(false);
    const [showAnswers, setShowAnswers] = useState(false);

    const handleExpand = useCallback(async (paramId) => {
        if (nested[paramId]) {
            setNested(prev => { const copy = { ...prev }; delete copy[paramId]; return copy; });
            return;
        }
        if (cache.has(paramId)) {
            setNested(prev => ({ ...prev, [paramId]: cache.get(paramId) }));
            return;
        }
        setLoading(prev => ({ ...prev, [paramId]: true }));
        setError(prev => ({ ...prev, [paramId]: null }));
        try {
            const res = await api.get(`/api/queries/q3?lang_id=${langId}&param_id=${paramId}`);
            cache.set(paramId, res.data);
            setNested(prev => ({ ...prev, [paramId]: res.data }));
        } catch {
            setError(prev => ({ ...prev, [paramId]: 'Failed to load.' }));
        } finally {
            setLoading(prev => ({ ...prev, [paramId]: false }));
        }
    }, [nested, langId, cache]);

    if (!q3Response) return null;

    const { parameter, language, current_value, value_orig, condition, status, explanation } = q3Response;
    const meta = STATUS_META[status] || STATUS_META.no_answers;
    const canExpand = depth < MAX_DEPTH;
    const compact = depth > 0;

    return (
        <div className="card" style={{
            padding: compact ? '0.55rem 0.7rem' : '1.25rem',
            border: `1px solid ${meta.border}`,
            marginTop: 0,
            background: compact ? 'var(--surface-2)' : 'var(--surface)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: compact ? '0.5rem' : '0.75rem', flexWrap: 'wrap', marginBottom: compact ? '0.35rem' : '0.75rem' }}>
                {status !== 'active' && (
                    <div style={{
                        padding: compact ? '0.2rem 0.5rem' : '0.4rem 0.75rem',
                        borderRadius: 4, fontWeight: 700,
                        background: meta.bg, color: meta.fg,
                        fontSize: compact ? '0.72rem' : '0.85rem',
                    }}>
                        {meta.label}
                    </div>
                )}
                <div style={{ fontWeight: 600, fontSize: compact ? '0.85rem' : 'inherit' }}>
                    <Link to={`/languages/${language.id}/debug#${parameter.id}`}>{parameter.id}</Link>
                    <span className="muted"> — {parameter.name}</span>
                </div>
                <div className="muted small">
                    in <Link to={`/languages/${language.id}/data`}>{language.name}</Link>
                </div>
            </div>

            <div style={{ display: 'flex', gap: compact ? '1rem' : '1.5rem', flexWrap: 'wrap', marginBottom: compact ? '0.45rem' : '1rem', fontSize: compact ? '0.82rem' : '0.9rem' }}>
                <div>
                    <span className="muted">Current:</span>{' '}
                    <strong>{current_value ?? '—'}</strong>
                    {value_orig != null && value_orig !== current_value && (
                        <span className="muted small"> (orig: {value_orig})</span>
                    )}
                </div>
                {condition && (
                    <div>
                        <span className="muted">Condition:</span>{' '}
                        <code>{condition}</code>
                    </div>
                )}
            </div>

            {(status === 'neutralized' || status === 'active') && (
                <>
                    <BlameLeavesView
                        explanation={explanation}
                        canExpand={canExpand}
                        nested={nested}
                        loading={loading}
                        error={error}
                        onExpand={handleExpand}
                        showOther={showOther}
                        setShowOther={setShowOther}
                        langId={langId}
                        depth={depth}
                        cache={cache}
                    />
                    {explanation?.answers?.length > 0 && (
                        <div style={{ marginTop: compact ? '0.5rem' : '1rem' }}>
                            <button
                                type="button"
                                className="btn"
                                style={{ background: 'transparent', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                                onClick={() => setShowAnswers(s => !s)}
                            >
                                {showAnswers ? '▾' : '▸'} Answers given for this parameter ({explanation.answers.length})
                            </button>
                            {showAnswers && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    <AnswersList
                                        answers={explanation.answers}
                                        languageId={language.id}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {status === 'set_directly' && (
                <AnswersList
                    answers={explanation?.answers || []}
                    languageId={language.id}
                    title="Answers that set this parameter"
                />
            )}

            {status === 'no_answers' && (
                <AnswersList
                    answers={explanation?.answers || []}
                    languageId={language.id}
                    title="No answers recorded — questions for this parameter:"
                    emptyMessage="No questions recorded for this parameter."
                />
            )}

            {status === 'warning_propagated' && (
                <ParentsList
                    parents={explanation?.parents || []}
                    canExpand={canExpand}
                    nested={nested}
                    loading={loading}
                    error={error}
                    onExpand={handleExpand}
                    langId={langId}
                    depth={depth}
                    cache={cache}
                />
            )}

            {status === 'no_condition' && (
                <div className="alert alert-info" style={{ margin: 0 }}>
                    This parameter has no implicational condition. Its value depends only on the answers given.
                    {explanation?.answers?.length > 0 && (
                        <AnswersList
                            answers={explanation.answers}
                            languageId={language.id}
                            embedded
                        />
                    )}
                </div>
            )}

            {status === 'parse_error' && (
                <div className="alert alert-error" style={{ margin: 0 }}>
                    Cannot parse the implicational condition: <code>{explanation?.message}</code>
                </div>
            )}
        </div>
    );
}

function BlameLeavesView({ explanation, canExpand, nested, loading, error, onExpand, showOther, setShowOther, langId, depth, cache }) {
    const responsible = explanation?.responsible || [];
    const other = explanation?.other_tokens || [];
    const isFailed = explanation?.type === 'implication_failed';

    return (
        <div>
            <h4 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>
                {isFailed
                    ? 'Parameters responsible for the neutralization'
                    : 'Parameters that satisfy the condition'}
            </h4>
            <div className="card" style={{ padding: 0, marginBottom: '0.75rem' }}>
                <table className="table" style={{ margin: 0 }}>
                    <thead className="table-light">
                        <tr>
                            <th>Token</th>
                            <th>Parameter</th>
                            <th style={{ width: 80, textAlign: 'center' }}>Required</th>
                            <th style={{ width: 80, textAlign: 'center' }}>Current</th>
                            <th style={{ width: 110, textAlign: 'center' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {responsible.length === 0 && (
                            <tr><td colSpan={5} className="muted text-center">No parameters to show</td></tr>
                        )}
                        {responsible.map((leaf, idx) => (
                            <LeafRow
                                key={`r-${idx}-${leaf.param_id}`}
                                leaf={leaf}
                                canExpand={canExpand}
                                isOpen={!!nested[leaf.param_id]}
                                isLoading={!!loading[leaf.param_id]}
                                onClick={() => onExpand(leaf.param_id)}
                                error={error[leaf.param_id]}
                                nestedResp={nested[leaf.param_id]}
                                langId={langId}
                                depth={depth}
                                cache={cache}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {other.length > 0 && (
                <div>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: 'transparent', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                        onClick={() => setShowOther(s => !s)}
                    >
                        {showOther ? '▾' : '▸'} Other tokens in condition ({other.length})
                    </button>
                    {showOther && (
                        <div className="card" style={{ padding: 0, marginTop: '0.5rem' }}>
                            <table className="table" style={{ margin: 0 }}>
                                <thead className="table-light">
                                    <tr>
                                        <th>Token</th>
                                        <th>Parameter</th>
                                        <th style={{ width: 80, textAlign: 'center' }}>Required</th>
                                        <th style={{ width: 80, textAlign: 'center' }}>Current</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {other.map((leaf, idx) => {
                                        const effectivePass = leaf.leaf_eval !== leaf.negated;
                                        return (
                                            <tr key={`o-${idx}-${leaf.param_id}`} style={{ background: !effectivePass ? 'rgba(220,53,69,0.05)' : 'transparent' }}>
                                                <td><code>{leaf.negated ? 'not ' : ''}{leaf.sign}{leaf.param_id}</code></td>
                                                <td>{leaf.param_name || ''}</td>
                                                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                                                    {leaf.negated ? <span style={{ fontWeight: 400 }}>not </span> : null}{leaf.sign}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>{leaf.current ?? '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function LeafRow({ leaf, canExpand, isOpen, isLoading, onClick, error, nestedResp, langId, depth, cache }) {
    // Effective satisfaction takes the NOT context into account: a leaf "passes" when its
    // boolean eval matches its required polarity (i.e., XOR with negated).
    const effectivePass = leaf.leaf_eval !== leaf.negated;
    const rowBg = !effectivePass ? 'rgba(220,53,69,0.05)' : 'transparent';
    return (
        <Fragment>
            <tr style={{ background: rowBg }}>
                <td><code>{leaf.negated ? 'not ' : ''}{leaf.sign}{leaf.param_id}</code></td>
                <td>{leaf.param_name || ''}</td>
                <td style={{ textAlign: 'center', fontWeight: 700 }}>
                    {leaf.negated ? <span style={{ fontWeight: 400 }}>not </span> : null}{leaf.sign}
                </td>
                <td style={{ textAlign: 'center' }}>{leaf.current ?? <span className="muted">—</span>}</td>
                <td style={{ textAlign: 'center' }}>
                    {canExpand ? (
                        <button
                            type="button"
                            className="btn btn--primary"
                            style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={onClick}
                            disabled={isLoading}
                        >
                            {isLoading ? '...' : isOpen ? 'Hide' : 'Explore'}
                        </button>
                    ) : (
                        <span className="muted small" title="Max recursion depth reached">—</span>
                    )}
                </td>
            </tr>
            {isOpen && (
                <tr>
                    <td colSpan={5} style={{ padding: 0 }}>
                        <ExpandedCell>
                            {error ? (
                                <div className="alert alert-error" style={{ margin: 0 }}>{error}</div>
                            ) : nestedResp ? (
                                <BlameTable
                                    q3Response={nestedResp}
                                    langId={langId}
                                    depth={depth + 1}
                                    cache={cache}
                                />
                            ) : (
                                <span className="muted">Loading...</span>
                            )}
                        </ExpandedCell>
                    </td>
                </tr>
            )}
        </Fragment>
    );
}

function AnswersList({ answers, languageId, title, emptyMessage, embedded }) {
    if (!answers || answers.length === 0) {
        if (embedded) return null;
        return <div className="muted small" style={{ marginTop: embedded ? '0.5rem' : 0 }}>{emptyMessage || 'No answers recorded.'}</div>;
    }
    return (
        <div style={{ marginTop: embedded ? '0.75rem' : 0 }}>
            {title && <h4 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>{title}</h4>}
            <div className="card" style={{ padding: 0 }}>
                <table className="table" style={{ margin: 0 }}>
                    <thead className="table-light">
                        <tr>
                            <th style={{ width: 80, textAlign: 'center' }}>Answer</th>
                            <th>Question</th>
                        </tr>
                    </thead>
                    <tbody>
                        {answers.map(a => (
                            <tr key={a.q_id}>
                                <td style={{
                                    textAlign: 'center', fontWeight: 700,
                                    color: a.response === 'yes' ? '#28a745' : a.response === 'no' ? '#dc3545' : '#6c757d'
                                }}>
                                    {(a.response || '—').toUpperCase()}
                                </td>
                                <td>
                                    <Link to={`/languages/${languageId}/data#q-${a.q_id}`}>
                                        <span className="muted small" style={{ marginRight: '0.4rem' }}>[{a.q_id}]</span>
                                        {a.q_text}
                                    </Link>
                                    {a.is_stop_question && <span className="muted small" style={{ marginLeft: '0.5rem' }}>(stop)</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ParentsList({ parents, canExpand, nested, loading, error, onExpand, langId, depth, cache }) {
    if (!parents || parents.length === 0) {
        return <div className="muted small">No parent parameters with active warnings.</div>;
    }
    return (
        <div>
            <h4 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem 0' }}>Parent parameters with warnings</h4>
            <div className="card" style={{ padding: 0 }}>
                <table className="table" style={{ margin: 0 }}>
                    <thead className="table-light">
                        <tr>
                            <th>Parameter</th>
                            <th style={{ width: 110, textAlign: 'center' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parents.map(p => (
                            <Fragment key={p.id}>
                                <tr>
                                    <td><strong>{p.id}</strong> — {p.name}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        {canExpand ? (
                                            <button
                                                type="button"
                                                className="btn btn--primary"
                                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                                                onClick={() => onExpand(p.id)}
                                                disabled={!!loading[p.id]}
                                            >
                                                {loading[p.id] ? '...' : nested[p.id] ? 'Hide' : 'Why?'}
                                            </button>
                                        ) : (
                                            <span className="muted small">—</span>
                                        )}
                                    </td>
                                </tr>
                                {nested[p.id] && (
                                    <tr>
                                        <td colSpan={2} style={{ padding: 0 }}>
                                            <ExpandedCell>
                                                {error[p.id] ? (
                                                    <div className="alert alert-error" style={{ margin: 0 }}>{error[p.id]}</div>
                                                ) : (
                                                    <BlameTable q3Response={nested[p.id]} langId={langId} depth={depth + 1} cache={cache} />
                                                )}
                                            </ExpandedCell>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
