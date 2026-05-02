import { useState, useEffect, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
    GitBranch, Globe, HelpCircle, GitCompare, ThumbsUp, ThumbsDown,
    MessageSquare, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import Select from 'react-select';
import api from '../../api';
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
    { id: 'q10', label: 'Show answers and examples (per question)',                Icon: MessageSquare },
];

export default function QueriesDashboard() {
    const [activeTab, setActiveTab] = useState('q1');
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

    // Stati per i form
    const [paramId, setParamId] = useState('');
    const [langId, setLangId] = useState('');
    const [langIdB, setLangIdB] = useState('');
    const [questionId, setQuestionId] = useState('');

    // Filtri Q10: restringono SOLO il dropdown delle question, non il risultato.
    // Lasciandoli vuoti, il dropdown mostra tutte le ~N centinaia di question.
    const [q10FilterLang, setQ10FilterLang] = useState('');
    const [q10FilterParam, setQ10FilterParam] = useState('');
    // Set di question_id risposte dalla lingua filtrata. null = filtro non
    // applicato, Set vuoto = filtro applicato ma la lingua non ha risposte.
    const [q10AnsweredQids, setQ10AnsweredQids] = useState(null);

    // Caricamento opzioni iniziali per le tendine
    // Caricamento opzioni iniziali per le tendine
    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const [langsRes, paramsRes, questionsRes] = await Promise.all([
                    api.get('/api/tablea/options'),
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/questions'),
                ]);

                // Difesa assoluta contro formati dati inattesi (previene lo schermo bianco)
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

    // Quando l'utente seleziona una lingua nel filtro Q10, scarichiamo gli
    // id delle question risposte da quella lingua. Se la deseleziona, reset.
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

    // Lista question filtrata in base ai due filtri Q10. Se la question
    // attualmente selezionata sparisce dalla lista filtrata, la deselezioniamo.
    const q10FilteredQuestions = useMemo(() => {
        let qs = options.questions;
        if (q10FilterParam) qs = qs.filter(q => q.parameter_id === q10FilterParam);
        if (q10FilterLang && q10AnsweredQids) qs = qs.filter(q => q10AnsweredQids.has(q.id));
        return qs;
    }, [options.questions, q10FilterParam, q10FilterLang, q10AnsweredQids]);

    useEffect(() => {
        if (questionId && !q10FilteredQuestions.some(q => q.id === questionId)) {
            setQuestionId('');
        }
    }, [q10FilteredQuestions, questionId]);

    // Cambio tab: langId e paramId persistono (il linguista tipicamente lavora su un
    // singolo (lingua, parametro) per sessione). langIdB e' specifico di Q7, lo resettiamo.
    // Se tutti i campi richiesti dal nuovo tab sono gia' compilati, lanciamo automaticamente
    // la ricerca, cosi' lo switch tab equivale a un nuovo "Search" senza altri click.
    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        setResults(null);
        setLangIdB('');

        const needsParam = ['q1', 'q2', 'q3'].includes(tabId);
        const needsLang = ['q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'].includes(tabId);
        const needsLangB = tabId === 'q7';
        const needsQuestion = tabId === 'q10';
        if (needsLangB) return;                  // langIdB appena resettato
        if (needsLang && !langId) return;
        if (needsParam && !paramId) return;
        if (needsQuestion && !questionId) return;
        executeQuery(null, tabId);
    };

    // Switch to Q3 with prefilled language + parameter and run the query immediately.
    const goToQ3 = async (langIdToUse, paramIdToUse) => {
        setActiveTab('q3');
        setLangId(langIdToUse);
        setParamId(paramIdToUse);
        setLangIdB('');
        setLoading(true);
        setResults(null);
        try {
            const res = await api.get(`/api/queries/q3?lang_id=${langIdToUse}&param_id=${paramIdToUse}`);
            setResults(res.data);
        } catch {
            setResults({ error: "Error while executing the query." });
        } finally {
            setLoading(false);
        }
    };

    const executeQuery = async (e, tabOverride) => {
        if (e) e.preventDefault();
        const tab = tabOverride ?? activeTab;
        // Guardia per Q10: react-select non supporta `required` come il native
        // select, validiamo qui per non sparare 404 al backend.
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
            else if (tab === 'q10') res = await api.get(`/api/queries/by-question?q_id=${encodeURIComponent(questionId)}`);

            setResults(res.data);
        } catch (err) {
            console.error("Query fallita", err);
            setResults({ error: "Error while executing the query." });
        } finally {
            setLoading(false);
        }
    };

    const renderForm = () => {
        const needsParam = ['q1', 'q2', 'q3'].includes(activeTab);
        const needsLang = ['q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'].includes(activeTab);
        const needsLangB = ['q7'].includes(activeTab);
        const needsQuestion = activeTab === 'q10';

        return (
            <form onSubmit={executeQuery} className="card" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end' }}>
                    {needsLang && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                                {activeTab === 'q7' ? 'First Language' : 'Language'}
                            </label>
                            <select className="form-control" value={langId} onChange={e => setLangId(e.target.value)} required>
                                <option value="">Select Language...</option>
                                {options.langs.map(l => <option key={l.id} value={l.id}>{l.name} ({l.id})</option>)}
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
                                {options.langs.map(l => <option key={l.id} value={l.id}>{l.name} ({l.id})</option>)}
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
                                {options.params.map(p => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
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
                    <div>
                        <button type="submit" className="btn btn--primary" style={{ width: '100%' }} disabled={loading}>
                            {loading ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                </div>
            </form>
        );
    };

    return (
        <div className="container" style={{ maxWidth: '1200px' }}>
            <header className="dashboard-hero" style={{ marginBottom: '2rem' }}>
                <h1>Filters & Queries</h1>
            </header>

            <div style={{
                display: 'grid',
                gridTemplateColumns: `${menuCollapsed ? '56px' : '350px'} 1fr`,
                gap: '2rem',
                alignItems: 'start',
                transition: 'grid-template-columns 0.2s',
            }}>

                {/* SIDEBAR NAVIGATION */}
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: menuCollapsed ? 'center' : 'space-between',
                        padding: menuCollapsed ? '0.6rem 0' : '0.75rem 1rem',
                        background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                        fontWeight: 'bold', minHeight: 44,
                    }}>
                        {!menuCollapsed && <span>Queries Configuration</span>}
                        <button
                            type="button"
                            className="sidebar-toggle"
                            onClick={() => setMenuCollapsed(c => !c)}
                            aria-label={menuCollapsed ? 'Expand queries menu' : 'Collapse queries menu'}
                            title={menuCollapsed ? 'Expand queries menu' : 'Collapse queries menu'}
                            aria-pressed={menuCollapsed}
                            style={{
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
                        {QUERY_TABS.map(t => {
                            const active = activeTab === t.id;
                            const Icon = t.Icon;
                            return (
                                <button
                                    key={t.id}
                                    title={menuCollapsed ? t.label : undefined}
                                    aria-label={menuCollapsed ? t.label : undefined}
                                    style={{
                                        display: 'flex', alignItems: 'center',
                                        justifyContent: menuCollapsed ? 'center' : 'flex-start',
                                        gap: menuCollapsed ? 0 : '0.6rem',
                                        padding: menuCollapsed ? '0 0' : '0.85rem 1rem',
                                        minHeight: 64,
                                        textAlign: 'left', border: 'none',
                                        borderBottom: '1px solid var(--border)',
                                        background: active ? 'var(--surface-2)' : 'transparent',
                                        fontWeight: active ? 'bold' : 'normal',
                                        color: active ? 'var(--brand)' : 'inherit',
                                        cursor: 'pointer', transition: 'background 0.2s',
                                        fontSize: '0.9rem',
                                    }}
                                    onClick={() => handleTabChange(t.id)}
                                >
                                    {Icon ? (
                                        <Icon size={18} style={{ flexShrink: 0 }} />
                                    ) : (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            width: 18, height: 18, flexShrink: 0,
                                            fontSize: '1.05rem', fontWeight: 700, lineHeight: 1,
                                        }}>
                                            {t.symbol}
                                        </span>
                                    )}
                                    {!menuCollapsed && <span>{t.label}</span>}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                {/* MAIN CONTENT AREA */}
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

                    {/* RENDERIZZAZIONE RISULTATI */}
                    {results && !results.error && (
                        <div className="query-results" style={{ animation: 'fadeIn 0.3s ease' }}>

                            {/* Q1: Implicational conditions */}
                            {activeTab === 'q1' && (
                                <div>
                                    <div className="alert alert-info" style={{ marginBottom: '1.5rem' }}>
                                        <strong>Implicational Condition:</strong> <br/>
                                        <code>{results.raw_condition || "None (Always active)"}</code>
                                        {results.pretty_condition && <><br/><small>{results.pretty_condition}</small></>}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Implicating parameters</h3>
                                            <div className="card" style={{ padding: 0 }}>
                                                <table className="table" style={{ margin: 0 }}>
                                                    <thead className="table-light"><tr><th>ID</th><th>Name</th></tr></thead>
                                                    <tbody>
                                                    {results.implicating.map(p => <tr key={p.id}><td><strong>{p.id}</strong></td><td>{p.name}</td></tr>)}
                                                    {results.implicating.length === 0 && <tr><td colSpan="2" style={{ textAlign: 'center', padding: '1rem' }} className="muted">None</td></tr>}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                        <div>
                                            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Implicated parameters</h3>
                                            <div className="card" style={{ padding: 0 }}>
                                                <table className="table" style={{ margin: 0 }}>
                                                    <thead className="table-light"><tr><th>ID</th><th>Name</th></tr></thead>
                                                    <tbody>
                                                    {results.implicated.map(p => <tr key={p.id}><td><strong>{p.id}</strong></td><td>{p.name}</td></tr>)}
                                                    {results.implicated.length === 0 && <tr><td colSpan="2" style={{ textAlign: 'center', padding: '1rem' }} className="muted">None</td></tr>}
                                                    </tbody>
                                                </table>
                                            </div>
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
                                                {results.plus.map(l => (
                                                    <tr key={l.id}>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}><strong>{l.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}>{l.name}</Link></td>
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
                                                {results.minus.map(l => (
                                                    <tr key={l.id}>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}><strong>{l.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}>{l.name}</Link></td>
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
                                                {results.zero.map(l => (
                                                    <tr key={l.id}>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}><strong>{l.id}</strong></Link></td>
                                                        <td><Link to={`/languages/${l.id}/data#p-${results.parameter.id}`}>{l.name}</Link></td>
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
                                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                        <table className="table table-hover" style={{ margin: 0 }}>
                                            <thead className="table-light">
                                            <tr>
                                                <th>Parameter</th>
                                                <th style={{ textAlign: 'center' }}>{langId}</th>
                                                <th style={{ textAlign: 'center' }}>{langIdB}</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {results.rows.map(r => (
                                                <tr key={r.id}>
                                                    <td><Link to={`/languages/${langId}/data#p-${r.id}`}>{r.id} — {r.name}</Link></td>
                                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{r.val_a}</td>
                                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{r.val_b}</td>
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

                            {/* Q8, Q9: Questions with YES / NO */}
                            {['q8', 'q9'].includes(activeTab) && (
                                <div>
                                    <h3 style={{ marginBottom: '1rem' }}><Link to={`/languages/${results.language.id}/data`}>{results.language.id} — {results.language.name}</Link></h3>
                                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                        <table className="table table-hover" style={{ margin: 0 }}>
                                            <thead className="table-light">
                                            <tr>
                                                <th style={{ width: '80px', textAlign: 'center' }}>Answer</th>
                                                <th>Question Text</th>
                                            </tr>
                                            </thead>
                                            <tbody>
                                            {results.answers.map(ans => (
                                                <tr key={ans.q_id}>
                                                    <td style={{
                                                        textAlign: 'center', fontWeight: 'bold',
                                                        color: activeTab === 'q8' ? '#28a745' : '#dc3545'
                                                    }}>
                                                        {activeTab === 'q8' ? 'YES' : 'NO'}
                                                    </td>
                                                    <td>
                                                        <Link to={`/languages/${results.language.id}/data#p-${ans.p_id}`}>
                                                            <span className="muted small" style={{ marginRight: '0.5rem' }}>[{ans.q_id}]</span>
                                                            {ans.text}
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                            {results.answers.length === 0 && <tr><td colSpan="2" className="muted text-center">No answers found</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
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

// Tabella per Q4/Q5/Q6: ogni riga e' espandibile per mostrare le risposte
// che hanno determinato il valore corrente del parametro per la lingua selezionata.
function ParamValueRowsTable({ params, language, activeTab, onJumpToQ3 }) {
    const [expanded, setExpanded] = useState({});
    const [answers, setAnswers] = useState({});
    const [rowLoading, setRowLoading] = useState({});
    const [rowError, setRowError] = useState({});

    const toggleRow = async (paramId) => {
        if (expanded[paramId]) {
            setExpanded(prev => { const c = { ...prev }; delete c[paramId]; return c; });
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                    {params.map(p => {
                        const isOpen = !!expanded[p.id];
                        const isLoading = !!rowLoading[p.id];
                        const err = rowError[p.id];
                        const rowAnswers = answers[p.id];
                        return (
                            <Fragment key={p.id}>
                                <tr className={activeTab === 'q6' ? 'q6-row' : undefined}>
                                    <td style={{ textAlign: 'center' }}>
                                        <button
                                            type="button"
                                            className="pv-toggle"
                                            onClick={() => toggleRow(p.id)}
                                            disabled={isLoading}
                                            title={isOpen ? 'Collapse' : 'Show answers'}
                                            aria-expanded={isOpen}
                                        >
                                            {isLoading ? '…' : (isOpen ? '▾' : '▸')}
                                        </button>
                                    </td>
                                    <td><Link to={`/languages/${language.id}/debug#p-${p.id}`}><strong>{p.id}</strong> — {p.name}</Link></td>
                                    {activeTab === 'q6' && <td><code>{p.condition}</code></td>}
                                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: valueColor }}>{valueLabel}</td>
                                    {activeTab === 'q6' && (
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                type="button"
                                                className="btn btn--primary q6-action-btn"
                                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
                                                onClick={() => onJumpToQ3(language.id, p.id)}
                                            >
                                                Why is 0?
                                            </button>
                                        </td>
                                    )}
                                </tr>
                                {isOpen && (
                                    <tr>
                                        <td colSpan={colCount} style={{ padding: '0.5rem 1rem 1rem 2.25rem', background: 'var(--surface-2)' }}>
                                            {err ? (
                                                <div className="alert alert-error" style={{ margin: 0 }}>{err}</div>
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


// Q10: picker della question con due filtri opzionali (language + parameter)
// e dropdown searchable (react-select). Spans full row del form.
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
        () => filteredQuestions.map(q => {
            const text = q.text || '';
            const truncated = text.length > 110 ? text.slice(0, 110) + '…' : text;
            return { value: q.id, label: `${q.id} — ${truncated}` };
        }),
        [filteredQuestions],
    );
    const selectedOption = questionOptions.find(o => o.value === questionId) || null;
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
                        {allLangs.map(l => (
                            <option key={l.id} value={l.id}>{l.name} ({l.id})</option>
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
                        {allParams.map(p => (
                            <option key={p.id} value={p.id}>{p.id} — {p.name}</option>
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
                        onChange={opt => setQuestionId(opt?.value || '')}
                        options={questionOptions}
                        isClearable
                        isSearchable
                        placeholder={langFilterReady ? 'Type to search by ID or text…' : 'Loading…'}
                        noOptionsMessage={() =>
                            filterLang && !langFilterReady
                                ? 'Loading…'
                                : 'No questions match the filters'
                        }
                        styles={{ control: (base) => ({ ...base, minHeight: 38 }) }}
                    />
                </div>
            </div>
        </div>
    );
}


// Q10: tabella cross-language di una singola question.
// Per default nasconde le lingue senza risposta (toggle in alto a destra).
function ByQuestionTable({ result }) {
    const [onlyAnswered, setOnlyAnswered] = useState(true);
    const rows = result.rows || [];
    const visibleRows = onlyAnswered ? rows.filter(r => r.response) : rows;
    const answeredCount = rows.filter(r => r.response).length;
    const responseColor = (r) => r === 'yes' ? '#15803d' : r === 'no' ? '#b91c1c' : r === 'unsure' ? '#a16207' : 'var(--text-muted, #888)';

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

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table" style={{ margin: 0 }}>
                    <thead className="table-light">
                        <tr>
                            <th style={{ width: '220px' }}>Language</th>
                            <th style={{ width: '90px', textAlign: 'center' }}>Answer</th>
                            <th>Examples</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleRows.map(r => (
                            <tr key={r.language.id}>
                                <td style={{ verticalAlign: 'top' }}>
                                    <Link to={`/languages/${r.language.id}/data#p-${result.question.parameter_id}`}>
                                        <strong>{r.language.id}</strong> — {r.language.name}
                                    </Link>
                                </td>
                                <td style={{
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    color: responseColor(r.response),
                                    verticalAlign: 'top',
                                    textTransform: 'uppercase',
                                }}>
                                    {r.response || '—'}
                                </td>
                                <td>
                                    {r.examples.length === 0 ? (
                                        <span className="muted small">—</span>
                                    ) : (
                                        <ol style={{ margin: 0, paddingLeft: '1.4rem' }}>
                                            {r.examples.map(ex => (
                                                <li key={ex.id} style={{ marginBottom: '0.5rem' }}>
                                                    {ex.textarea && <div>{ex.textarea}</div>}
                                                    {ex.transliteration && <div className="small muted" style={{ fontStyle: 'italic' }}>{ex.transliteration}</div>}
                                                    {ex.gloss && <div className="small muted">{ex.gloss}</div>}
                                                    {ex.translation && <div className="small">‘{ex.translation}’</div>}
                                                    {ex.reference && <div className="small muted">[{ex.reference}]</div>}
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