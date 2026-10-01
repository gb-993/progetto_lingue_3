import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
    GitBranch, Globe, HelpCircle, GitCompare, ThumbsUp, ThumbsDown,
    MessageSquare, MinusCircle, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import Select from 'react-select';
import api from '../../api';
import reactSelectStyles from '../../utils/reactSelectStyles';
import usePersistentState from '../../utils/usePersistentState';
import BlameTable, { AnswersList } from './BlameTable';

const QUERIES_MENU_COLLAPSED_KEY = 'pcm-queries-menu-collapsed';

const QUERY_TABS = [
    { id: 'q1', label: 'Show implicational condition(s) (per parameter)',          Icon: GitBranch },
    { id: 'q2', label: 'Show parameter values for all languages (per parameter)',  Icon: Globe },
    { id: 'q3', label: 'Show why a parameter is neutralized (per language)',       Icon: HelpCircle },
    { id: 'q4', label: 'Parameters with value + (per language)',                   symbol: '+' },
    { id: 'q5', label: 'Parameters with value - (per language)',                   symbol: '−' },
    { id: 'q6', label: 'Parameters with value 0 (per language)',                   symbol: '0' },
    { id: 'q7', label: 'Comparable parameters (per pair of languages)',            Icon: GitCompare },
    { id: 'q8', label: 'Question with answer YES (per language)',                  Icon: ThumbsUp },
    { id: 'q9', label: 'Question with answer NO (per language)',                   Icon: ThumbsDown },
    { id: 'q11', label: 'Question without an answer (per language)',               Icon: MinusCircle },
    { id: 'q10', label: 'Show answers and examples (per question)',                Icon: MessageSquare },
];

export default function QueriesDashboard() {
    const [activeTab, setActiveTab] = usePersistentState('queries:activeTab', 'q1');
    const [options, setOptions] = useState({ langs: [], params: [], questions: [] });
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [menuCollapsed, setMenuCollapsed] = useState(() =>
        typeof window !== 'undefined' && localStorage.getItem(QUERIES_MENU_COLLAPSED_KEY) === '1'
    );

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(QUERIES_MENU_COLLAPSED_KEY, menuCollapsed ? '1' : '0');
    }, [menuCollapsed]);

    const [paramId, setParamId] = usePersistentState('queries:paramId', '');
    const [langId, setLangId] = usePersistentState('queries:langId', '');
    const [langIdB, setLangIdB] = usePersistentState('queries:langIdB', '');
    const [questionId, setQuestionId] = usePersistentState('queries:questionId', '');

    // filtrano solo la lista delle question
    const [q10FilterLang, setQ10FilterLang] = usePersistentState('queries:q10FilterLang', '');
    const [q10FilterParam, setQ10FilterParam] = usePersistentState('queries:q10FilterParam', '');
    // null = nessun filtro lingua
    const [q10AnsweredQids, setQ10AnsweredQids] = useState(null);

    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const [langsRes, paramsRes, questionsRes] = await Promise.all([
                    api.get('/api/tablea/options'),
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/questions'),
                ]);

                const safeLangs = langsRes.data?.opt_all_languages || [];
                let safeParams = [];
                if (Array.isArray(paramsRes.data)) {
                    safeParams = paramsRes.data;
                } else if (paramsRes.data && Array.isArray(paramsRes.data.items)) {
                    safeParams = paramsRes.data.items;
                }
                const safeQuestions = Array.isArray(questionsRes.data) ? questionsRes.data : [];

                setOptions({
                    langs: safeLangs,
                    params: safeParams,
                    questions: safeQuestions,
                });
            } catch (err) {
                console.error("Errore nel caricamento delle opzioni", err);
                setOptions({ langs: [], params: [], questions: [] });
            }
        };
        fetchOptions();
    }, []);

    useEffect(() => {
        if (!q10FilterLang) {
            setQ10AnsweredQids(null);
            return;
        }
        let active = true;
        api.get(`/api/queries/options/questions-for-language?lang_id=${encodeURIComponent(q10FilterLang)}`)
            .then(res => { if (active) setQ10AnsweredQids(new Set(res.data || [])); })
            .catch(() => { if (active) setQ10AnsweredQids(new Set()); });
        return () => { active = false; };
    }, [q10FilterLang]);

    const q10FilteredQuestions = useMemo(() => {
        let questions = options.questions;
        if (q10FilterParam) questions = questions.filter(question => question.parameter_id === q10FilterParam);
        if (q10FilterLang && q10AnsweredQids) questions = questions.filter(question => q10AnsweredQids.has(question.id));
        return questions;
    }, [options.questions, q10FilterParam, q10FilterLang, q10AnsweredQids]);

    useEffect(() => {
        // aspetta che le question siano caricate
        if (options.questions.length === 0) return;
        if (questionId && !q10FilteredQuestions.some(question => question.id === questionId)) {
            setQuestionId('');
        }
    }, [q10FilteredQuestions, questionId, setQuestionId, options.questions.length]);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        setResults(null);
        setLangIdB('');
    };

    const goToQ3 = (langIdToUse, paramIdToUse) => {
        setActiveTab('q3');
        setLangId(langIdToUse);
        setParamId(paramIdToUse);
        setLangIdB('');
    };

    const executeQuery = async (e, tabOverride) => {
        if (e) e.preventDefault();
        const tab = tabOverride ?? activeTab;
        // react-select non ha required
        if (tab === 'q10' && !questionId) return;
        setLoading(true);
        setResults(null);
        try {
            let res;
            if (tab === 'q1') res = await api.get(`/api/queries/q1?param_id=${paramId}`);
            else if (tab === 'q2') res = await api.get(`/api/queries/q2?param_id=${paramId}`);
            else if (tab === 'q3') res = await api.get(`/api/queries/q3?lang_id=${langId}&param_id=${paramId}`);
            else if (tab === 'q4') res = await api.get(`/api/queries/q456?lang_id=${langId}&value=%2B`);
            else if (tab === 'q5') res = await api.get(`/api/queries/q456?lang_id=${langId}&value=-`);
            else if (tab === 'q6') res = await api.get(`/api/queries/q456?lang_id=${langId}&value=0`);
            else if (tab === 'q7') res = await api.get(`/api/queries/q7?lang_a=${langId}&lang_b=${langIdB}`);
            else if (tab === 'q8') res = await api.get(`/api/queries/q89?lang_id=${langId}&response_text=yes`);
            else if (tab === 'q9') res = await api.get(`/api/queries/q89?lang_id=${langId}&response_text=no`);
            else if (tab === 'q11') res = await api.get(`/api/queries/q11?lang_id=${langId}`);
            else if (tab === 'q10') res = await api.get(`/api/queries/by-question?q_id=${encodeURIComponent(questionId)}`);

            setResults(res.data);
        } catch (err) {
            console.error("Query fallita", err);
            setResults({ error: "Error while executing the query." });
        } finally {
            setLoading(false);
        }
    };

    // auto-run appena i campi sono compilati
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        const needsParam = ['q1', 'q2', 'q3'].includes(activeTab);
        const needsLang = ['q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q11'].includes(activeTab);
        const needsLangB = activeTab === 'q7';
        const needsQuestion = activeTab === 'q10';

        const ready =
            (!needsParam || !!paramId) &&
            (!needsLang || !!langId) &&
            (!needsLangB || !!langIdB) &&
            (!needsQuestion || !!questionId);

        if (ready) executeQuery(null, activeTab);
        else setResults(null);
        // executeQuery usa solo questi input
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, paramId, langId, langIdB, questionId]);
    /* eslint-enable react-hooks/set-state-in-effect */

    const renderForm = () => {
        const needsParam = ['q1', 'q2', 'q3'].includes(activeTab);
        const needsLang = ['q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q11'].includes(activeTab);
        const needsLangB = ['q7'].includes(activeTab);
        const needsQuestion = activeTab === 'q10';

        return (
            <form onSubmit={executeQuery} className="card" style={{ padding: 'var(--form-box-pad-lg, 1.5rem)', marginBottom: 'var(--form-col-gap, 2rem)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--form-grid-gap, 1rem)', alignItems: 'end' }}>
                    {needsLang && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                {activeTab === 'q7' ? 'First Language' : 'Language'}
                            </label>
                            <select className="form-control" value={langId} onChange={e => setLangId(e.target.value)} required>
                                <option value="">Select Language...</option>
                                {options.langs.map(lang => <option key={lang.id} value={lang.id}>{lang.name} ({lang.id})</option>)}
                            </select>
                        </div>
                    )}
                    {needsLangB && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                Second Language
                            </label>
                            <select className="form-control" value={langIdB} onChange={e => setLangIdB(e.target.value)} required>
                                <option value="">Select Language...</option>
                                {options.langs.map(lang => <option key={lang.id} value={lang.id}>{lang.name} ({lang.id})</option>)}
                            </select>
                        </div>
                    )}
                    {needsParam && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                Parameter
                            </label>
                            <select className="form-control" value={paramId} onChange={e => setParamId(e.target.value)} required>
                                <option value="">Select Parameter...</option>
                                {options.params.map(param => <option key={param.id} value={param.id}>{param.id} — {param.name}</option>)}
                            </select>
                        </div>
                    )}
                    {needsQuestion && (
                        <Q10QuestionPicker
                            allLangs={options.langs}
                            allParams={options.params}
                            filteredQuestions={q10FilteredQuestions}
                            totalQuestions={options.questions.length}
                            filterLang={q10FilterLang}
                            setFilterLang={setQ10FilterLang}
                            filterParam={q10FilterParam}
                            setFilterParam={setQ10FilterParam}
                            questionId={questionId}
                            setQuestionId={setQuestionId}
                            langFilterReady={!q10FilterLang || q10AnsweredQids !== null}
                        />
                    )}
                </div>
            </form>
        );
    };

    // px o %, mai fr: altrimenti l'animazione salta
    const isCompact = typeof document !== 'undefined'
        && document.documentElement.getAttribute('data-density') === 'compact';
    const gridCols = menuCollapsed
        ? '56px 1fr'
        : (isCompact ? '33.333% 1fr' : '350px 1fr');

    return (
        <div className="container">
            <header className="dashboard-hero" style={{ marginBottom: 'var(--form-col-gap, 2rem)' }}>
                <h1>Filters & Queries</h1>
            </header>

            <div style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 'var(--form-col-gap, 2rem)',
                alignItems: 'start',
                transition: 'grid-template-columns 0.13s ease',
            }}>

                <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: menuCollapsed ? 'center' : 'space-between',
                        padding: menuCollapsed ? '0 0' : '0 1rem',
                        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                        fontWeight: 'bold', height: 52, boxSizing: 'border-box',
                        overflow: 'hidden',
                    }}>
                        {!menuCollapsed && (
                            <span style={{
                                flex: '0 1 auto', minWidth: 0,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>Queries Configuration</span>
                        )}
                        <button
                            type="button"
                            className="sidebar-toggle"
                            onClick={() => setMenuCollapsed(collapsed => !collapsed)}
                            aria-label={menuCollapsed ? 'Expand queries menu' : 'Collapse queries menu'}
                            title={menuCollapsed ? 'Expand queries menu' : 'Collapse queries menu'}
                            aria-pressed={menuCollapsed}
                            style={{
                                flexShrink: 0,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                width: 28, height: 28, padding: 0,
                                background: 'transparent', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted, #666)', borderRadius: 4,
                            }}
                        >
                            {menuCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                        </button>
                    </div>
                    <nav style={{ display: 'flex', flexDirection: 'column' }}>
                        {QUERY_TABS.map(tab => {
                            const active = activeTab === tab.id;
                            const Icon = tab.Icon;
                            return (
                                <button
                                    key={tab.id}
                                    title={tab.label}
                                    aria-label={menuCollapsed ? tab.label : undefined}
                                    style={{
                                        display: 'flex', alignItems: 'center',
                                        justifyContent: 'flex-start',
                                        gap: 0,
                                        padding: 0,
                                        width: '100%',
                                        height: 'var(--queries-tab-h, 64px)',
                                        boxSizing: 'border-box',
                                        overflow: 'hidden',
                                        textAlign: 'left', border: 'none',
                                        borderBottom: '1px solid var(--border)',
                                        background: active ? 'var(--surface-2)' : 'transparent',
                                        fontWeight: active ? 'bold' : 'normal',
                                        color: active ? 'var(--brand)' : 'inherit',
                                        cursor: 'pointer', transition: 'background 0.2s',
                                        fontSize: '0.9rem',
                                    }}
                                    onClick={() => handleTabChange(tab.id)}
                                >
                                    <span style={{
                                        flex: '0 0 56px', width: 56, alignSelf: 'stretch',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        {Icon ? (
                                            <Icon size={18} />
                                        ) : (
                                            <span style={{ fontSize: '1.05rem', fontWeight: 700, lineHeight: 1 }}>
                                                {tab.symbol}
                                            </span>
                                        )}
                                    </span>
                                    <span style={{
                                        flex: '1 1 auto', minWidth: 0, paddingRight: '1rem',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        lineHeight: 1.2,
                                        opacity: menuCollapsed ? 0 : 1,
                                        transition: 'opacity 0.13s ease',
                                    }}>{tab.label}</span>
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <main>
                    {renderForm()}

                    {loading && (
                        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--brand)', fontWeight: 'bold' }}>
                            <span style={{ opacity: 0.7 }}>↻ Query elaboration...</span>
                        </div>
                    )}

                    {results && results.error && (
                        <div className="alert alert-error">{results.error}</div>
                    )}

                    {results && !results.error && (
                        <div className="query-results" style={{ animation: 'fadeIn 0.3s ease' }}>

                            {/* Q1: Implicational conditions */}
                            {activeTab === 'q1' && (
                                <div>
                                    <div className="alert alert-info" style={{ marginBottom: '1.5rem', justifyContent: 'flex-start', gap: '0.5rem' }}>
                                        <strong>Implicational condition:</strong>
                                        <code>{results.raw_condition || 'None (always active)'}</code>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}>
                                        <div>
                                            <h3 style={{ fontSize: '1rem', margin: '0 0 0.6rem' }}>Implicant</h3>
                                            {results.implicating.length > 0 ? (
                                                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                                    {results.implicating.map(param => (
                                                        <li key={param.id} style={{ marginBottom: '0.25rem' }}>
                                                            <Link to={`/admin/parameters/${param.id}/edit`}>{param.id}</Link>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : <p className="muted" style={{ margin: 0 }}>None</p>}
                                        </div>

                                        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', height: '1.2rem', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>→</div>

                                        <div>
                                            <h3 style={{ fontSize: '1rem', margin: '0 0 0.6rem' }}>Implicated</h3>
                                            {results.implicated.length > 0 ? (
                                                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                                    {results.implicated.map(param => (
                                                        <li key={param.id} style={{ marginBottom: '0.25rem' }}>
                                                            <Link to={`/admin/parameters/${param.id}/edit`}>{param.id}</Link>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : <p className="muted" style={{ margin: 0 }}>None</p>}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Q2: Values distribution */}
                            {activeTab === 'q2' && (
                                <div>
                                    <h3 style={{ marginBottom: '1.5rem' }}>Parameter: {results.parameter.id} — {results.parameter.name}</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
                                        <div className="card" style={{ padding: 0, border: '1px solid #28a745' }}>
                                            <div style={{ background: '#d4edda', padding: '0.75rem 1rem', fontWeight: 'bold', color: '#155724' }}>
                                                Value: + ({results.plus.length} languages)
                                            </div>
                                            <table className="table" style={{ margin: 0 }}>
                                                <thead className="table-light"><tr><th>ID</th><th>Language</th></tr></thead>
                                                <tbody>
                                                {results.plus.map(lang => (
                                                    <tr key={lang.id}>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}><strong>{lang.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}>{lang.name}</Link></td>
                                                    </tr>
                                                ))}
                                                {results.plus.length === 0 && <tr><td colSpan="2" className="muted text-center">None</td></tr>}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className="card" style={{ padding: 0, border: '1px solid #dc3545' }}>
                                            <div style={{ background: '#f8d7da', padding: '0.75rem 1rem', fontWeight: 'bold', color: '#721c24' }}>
                                                Value: - ({results.minus.length} languages)
                                            </div>
                                            <table className="table" style={{ margin: 0 }}>
                                                <thead className="table-light"><tr><th>ID</th><th>Language</th></tr></thead>
                                                <tbody>
                                                {results.minus.map(lang => (
                                                    <tr key={lang.id}>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}><strong>{lang.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}>{lang.name}</Link></td>
                                                    </tr>
                                                ))}
                                                {results.minus.length === 0 && <tr><td colSpan="2" className="muted text-center">None</td></tr>}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className="card" style={{ padding: 0, border: '1px solid #6c757d' }}>
                                            <div style={{ background: '#e2e3e5', padding: '0.75rem 1rem', fontWeight: 'bold', color: '#383d41' }}>
                                                Value: 0 (neutralized) ({results.zero.length} languages)
                                            </div>
                                            <table className="table" style={{ margin: 0 }}>
                                                <thead className="table-light"><tr><th>ID</th><th>Language</th></tr></thead>
                                                <tbody>
                                                {results.zero.map(lang => (
                                                    <tr key={lang.id}>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}><strong>{lang.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${lang.id}/data#p-${results.parameter.id}`}>{lang.name}</Link></td>
                                                    </tr>
                                                ))}
                                                {results.zero.length === 0 && <tr><td colSpan="2" className="muted text-center">None</td></tr>}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Q3: Neutralization Blame Analysis */}
                            {activeTab === 'q3' && (
                                <BlameTable q3Response={results} langId={langId} depth={0} />
                            )}

                            {/* Q4, Q5, Q6: Parameters with value +, -, 0 */}
                            {['q4', 'q5', 'q6'].includes(activeTab) && (
                                <div>
                                    <h3 style={{ marginBottom: '1rem' }}><Link to={`/languages/${results.language.id}/data`}>{results.language.id} — {results.language.name}</Link></h3>
                                    <ParamValueRowsTable
                                        key={`${activeTab}-${results.language.id}`}
                                        params={results.params}
                                        language={results.language}
                                        activeTab={activeTab}
                                        onJumpToQ3={goToQ3}
                                    />
                                </div>
                            )}

                            {/* Q7: Comparable parameters */}
                            {activeTab === 'q7' && (
                                <div>
                                    <h3 style={{ marginBottom: '1rem' }}>
                                        <Link to={`/languages/${langId}/data`}>{langId}</Link> ⇄ <Link to={`/languages/${langIdB}/data`}>{langIdB}</Link>
                                    </h3>
                                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                                        <table className="table table-hover" style={{ margin: 0 }}>
                                            <thead className="table-light">
                                            <tr>
                                                <th>Parameter</th>
                                                <th style={{ textAlign: 'center' }}>{langId}</th>
                                                <th style={{ textAlign: 'center' }}>{langIdB}</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {results.rows.map(row => (
                                                <tr key={row.id}>
                                                    <td><Link to={`/languages/${langId}/data#p-${row.id}`}>{row.id} — {row.name}</Link></td>
                                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{row.val_a}</td>
                                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{row.val_b}</td>
                                                </tr>
                                            ))}
                                            {results.rows.length === 0 && <tr><td colSpan="3" className="muted text-center">No comparable parameters found</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Q10: Answers and examples per question (cross-language) */}
                            {activeTab === 'q10' && (
                                <ByQuestionTable result={results} />
                            )}

                            {/* Q8, Q9, Q11: Questions with YES / NO / unanswered */}
                            {['q8', 'q9', 'q11'].includes(activeTab) && (
                                <div>
                                    <h3 style={{ marginBottom: '1rem' }}><Link to={`/languages/${results.language.id}/data`}>{results.language.id} — {results.language.name}</Link></h3>
                                    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                                        <table className="table table-hover" style={{ margin: 0 }}>
                                            <thead className="table-light">
                                            <tr>
                                                <th style={{ width: '80px', textAlign: 'center' }}>Answer</th>
                                                <th>Question Text</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {results.answers.map(answer => (
                                                <tr key={answer.q_id}>
                                                    <td style={{
                                                        textAlign: 'center', fontWeight: 'bold',
                                                        color: activeTab === 'q8' ? '#28a745'
                                                            : activeTab === 'q9' ? '#dc3545'
                                                            : 'var(--text-muted, #888)',
                                                    }}>
                                                        {activeTab === 'q8' ? 'YES' : activeTab === 'q9' ? 'NO' : '—'}
                                                    </td>
                                                    <td>
                                                        <Link to={`/languages/${results.language.id}/data#p-${answer.p_id}`}>
                                                            <span className="muted small" style={{ marginRight: '0.5rem' }}>[{answer.q_id}]</span>
                                                            {answer.text}
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                            {results.answers.length === 0 && (
                                                <tr><td colSpan="2" className="muted text-center">
                                                    {activeTab === 'q11' ? 'No unanswered questions: every active question of every active parameter has an answer.' : 'No answers found'}
                                                </td></tr>
                                            )}
                                            </tbody>
                                        </table>
                                    </div>
                                    {activeTab === 'q11' && (
                                        <div className="small muted" style={{ marginTop: '0.5rem', fontStyle: 'italic' }}>
                                            Inactive questions and questions belonging to inactive parameters are not shown.
                                            Answers marked as “unsure” or “missing” count as given and are not listed here either.
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>
                    )}
                </main>
            </div>

            <style>{`
                .q6-row .q6-action-btn { opacity: 0; transition: opacity 0.15s; }
                .q6-row:hover .q6-action-btn,
                .q6-action-btn:focus-visible { opacity: 1; }
                .pv-toggle { background: transparent; border: none; cursor: pointer; padding: 0 0.4rem; color: var(--text-muted, #888); font-size: 0.85rem; }
                .pv-toggle:hover { color: var(--text, inherit); }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

// Q4/Q5/Q6: righe espandibili con le risposte
function ParamValueRowsTable({ params, language, activeTab, onJumpToQ3 }) {
    const [expanded, setExpanded] = useState({});
    const [answers, setAnswers] = useState({});
    const [rowLoading, setRowLoading] = useState({});
    const [rowError, setRowError] = useState({});

    const toggleRow = async (paramId) => {
        if (expanded[paramId]) {
            setExpanded(prev => { const next = { ...prev }; delete next[paramId]; return next; });
            return;
        }
        if (answers[paramId] !== undefined) {
            setExpanded(prev => ({ ...prev, [paramId]: true }));
            return;
        }
        setRowLoading(prev => ({ ...prev, [paramId]: true }));
        setRowError(prev => ({ ...prev, [paramId]: null }));
        try {
            const res = await api.get(`/api/queries/q3?lang_id=${language.id}&param_id=${paramId}`);
            const fetched = res.data?.explanation?.answers || [];
            setAnswers(prev => ({ ...prev, [paramId]: fetched }));
            setExpanded(prev => ({ ...prev, [paramId]: true }));
        } catch {
            setRowError(prev => ({ ...prev, [paramId]: 'Failed to load answers.' }));
        } finally {
            setRowLoading(prev => ({ ...prev, [paramId]: false }));
        }
    };

    const valueColor = activeTab === 'q4' ? '#28a745' : activeTab === 'q5' ? '#dc3545' : '#6c757d';
    const valueLabel = activeTab === 'q4' ? '+' : activeTab === 'q5' ? '-' : '0';
    const colCount = activeTab === 'q6' ? 5 : 3;

    return (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table table-hover" style={{ margin: 0 }}>
                <thead className="table-light">
                    <tr>
                        <th style={{ width: 36 }}></th>
                        <th>Parameter</th>
                        {activeTab === 'q6' && <th>Implicational Condition(s)</th>}
                        <th style={{ textAlign: 'center' }}>Value</th>
                        {activeTab === 'q6' && <th style={{ width: 130, textAlign: 'center' }}>Action</th>}
                    </tr>
                </thead>
                <tbody>
                    {params.map(param => {
                        const isOpen = !!expanded[param.id];
                        const isLoading = !!rowLoading[param.id];
                        const errorMessage = rowError[param.id];
                        const rowAnswers = answers[param.id];
                        return (
                            <Fragment key={param.id}>
                                <tr className={activeTab === 'q6' ? 'q6-row' : undefined}>
                                    <td style={{ textAlign: 'center' }}>
                                        <button
                                            type="button"
                                            className="pv-toggle"
                                            onClick={() => toggleRow(param.id)}
                                            disabled={isLoading}
                                            title={isOpen ? 'Collapse' : 'Show answers'}
                                            aria-expanded={isOpen}
                                        >
                                            {isLoading ? '…' : (isOpen ? '▾' : '▸')}
                                        </button>
                                    </td>
                                    <td><Link to={`/languages/${language.id}/debug#param-${param.id}`}><strong>{param.id}</strong> — {param.name}</Link></td>
                                    {activeTab === 'q6' && <td><code>{param.condition}</code></td>}
                                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: valueColor }}>{valueLabel}</td>
                                    {activeTab === 'q6' && (
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                type="button"
                                                className="btn btn--primary q6-action-btn"
                                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                                                onClick={() => onJumpToQ3(language.id, param.id)}
                                            >
                                                Why is 0?
                                            </button>
                                        </td>
                                    )}
                                </tr>
                                {isOpen && (
                                    <tr>
                                        <td colSpan={colCount} style={{ padding: '0.5rem 1rem 1rem 2.25rem', background: 'var(--surface-2)' }}>
                                            {errorMessage ? (
                                                <div className="alert alert-error" style={{ margin: 0 }}>{errorMessage}</div>
                                            ) : rowAnswers && rowAnswers.length > 0 ? (
                                                <AnswersList answers={rowAnswers} languageId={language.id} />
                                            ) : (
                                                <div className="muted small">No answers recorded for this parameter.</div>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                    {params.length === 0 && (
                        <tr><td colSpan={colCount} className="muted text-center">No parameters found</td></tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function Q10QuestionPicker({
    allLangs, allParams, filteredQuestions, totalQuestions,
    filterLang, setFilterLang, filterParam, setFilterParam,
    questionId, setQuestionId, langFilterReady,
}) {
    const labelStyle = {
        display: 'block', fontSize: '0.75rem', fontWeight: 700,
        marginBottom: '0.3rem', color: 'var(--text-muted)',
        textTransform: 'uppercase',
    };
    const questionOptions = useMemo(
        () => filteredQuestions.map(question => {
            const text = question.text || '';
            const truncated = text.length > 110 ? text.slice(0, 110) + '…' : text;
            return { value: question.id, label: `${question.id} — ${truncated}` };
        }),
        [filteredQuestions],
    );
    const selectedOption = questionOptions.find(option => option.value === questionId) || null;
    const filtered = !!(filterLang || filterParam);

    return (
        <div style={{ gridColumn: '1 / -1' }}>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '0.75rem', alignItems: 'end',
            }}>
                <div>
                    <label style={labelStyle}>Filter by language (optional)</label>
                    <select
                        className="form-control"
                        value={filterLang}
                        onChange={e => setFilterLang(e.target.value)}
                    >
                        <option value="">All languages</option>
                        {allLangs.map(lang => (
                            <option key={lang.id} value={lang.id}>{lang.name} ({lang.id})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label style={labelStyle}>Filter by parameter (optional)</label>
                    <select
                        className="form-control"
                        value={filterParam}
                        onChange={e => setFilterParam(e.target.value)}
                    >
                        <option value="">All parameters</option>
                        {allParams.map(param => (
                            <option key={param.id} value={param.id}>{param.id} — {param.name}</option>
                        ))}
                    </select>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                    <label style={labelStyle}>
                        Question
                        <span className="muted" style={{ marginLeft: '0.5rem', textTransform: 'none', fontWeight: 400 }}>
                            ({filteredQuestions.length}{filtered ? ` of ${totalQuestions}` : ''})
                        </span>
                    </label>
                    <Select
                        value={selectedOption}
                        onChange={option => setQuestionId(option?.value || '')}
                        options={questionOptions}
                        isClearable
                        isSearchable
                        placeholder={langFilterReady ? 'Type to search by ID or text…' : 'Loading…'}
                        noOptionsMessage={() =>
                            filterLang && !langFilterReady
                                ? 'Loading…'
                                : 'No questions match the filters'
                        }
                        styles={{
                            ...reactSelectStyles,
                            control: (base, state) => ({
                                ...reactSelectStyles.control(base, state),
                                minHeight: 38,
                            }),
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

function ByQuestionTable({ result }) {
    const [onlyAnswered, setOnlyAnswered] = useState(true);
    const rows = result.rows || [];
    const visibleRows = onlyAnswered ? rows.filter(row => row.response) : rows;
    const answeredCount = rows.filter(row => row.response).length;
    const responseColor = (response) => response === 'yes' ? '#15803d' : response === 'no' ? '#b91c1c' : (response === 'unsure' || response === 'missing') ? '#a16207' : 'var(--text-muted, #888)';

    return (
        <div>
            <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ margin: '0 0 0.25rem 0' }}>
                    Question: <code>{result.question.id}</code>
                </h3>
                <div className="small muted" style={{ marginBottom: '0.5rem' }}>
                    Parameter: <strong>{result.question.parameter_id}</strong>
                    {result.question.parameter_name ? ` — ${result.question.parameter_name}` : ''}
                    {!result.question.is_active && <span style={{ marginLeft: '0.75rem', color: '#b91c1c' }}>(inactive)</span>}
                </div>
                <div style={{ padding: '0.75rem 1rem', background: 'var(--surface-2)', borderRadius: 6, marginBottom: '0.75rem' }}>
                    {result.question.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div className="small muted">
                        <strong>{answeredCount}</strong> / {rows.length} languages answered
                    </div>
                    <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={onlyAnswered}
                            onChange={e => setOnlyAnswered(e.target.checked)}
                        />
                        Show only languages with an answer
                    </label>
                </div>
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="table" style={{ margin: 0 }}>
                    <thead className="table-light">
                        <tr>
                            <th style={{ width: '220px' }}>Language</th>
                            <th style={{ width: '90px', textAlign: 'center' }}>Answer</th>
                            <th>Examples</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map(row => (
                            <tr key={row.language.id}>
                                <td style={{ verticalAlign: 'top' }}>
                                    <Link to={`/languages/${row.language.id}/data#p-${result.question.parameter_id}`}>
                                        <strong>{row.language.id}</strong> — {row.language.name}
                                    </Link>
                                </td>
                                <td style={{
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    color: responseColor(row.response),
                                    verticalAlign: 'top',
                                    textTransform: 'uppercase',
                                }}>
                                    {row.response || '—'}
                                </td>
                                <td>
                                    {row.examples.length === 0 ? (
                                        <span className="muted small">—</span>
                                    ) : (
                                        <ol style={{ margin: 0, paddingLeft: '1.4rem' }}>
                                            {row.examples.map(example => (
                                                <li key={example.id} style={{ marginBottom: '0.5rem' }}>
                                                    {example.textarea && <div>{example.textarea}</div>}
                                                    {example.transliteration && <div className="small muted" style={{ fontStyle: 'italic' }}>{example.transliteration}</div>}
                                                    {example.gloss && <div className="small muted">{example.gloss}</div>}
                                                    {example.translation && <div className="small">‘{example.translation}’</div>}
                                                    {example.reference && <div className="small muted">[{example.reference}]</div>}
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {visibleRows.length === 0 && (
                            <tr><td colSpan="3" className="muted text-center">
                                {onlyAnswered ? 'No languages have answered yet.' : 'No languages found.'}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}