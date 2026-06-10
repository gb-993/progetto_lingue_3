import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';
import usePersistentState from '../../utils/usePersistentState';
import DeactivateQuestionDialog from './DeactivateQuestionDialog';

function truncate(text, n = 70) {
    if (!text) return '';
    return text.length > n ? text.slice(0, n) + '…' : text;
}

export default function QuestionList() {
    const [questions, setQuestions] = useState([]);
    const [search, setSearch] = usePersistentState('questions:search', '');
    // Spunta accanto all'header "Is Active": nasconde dall'elenco le domande
    // disattivate. Persistente come gli altri filtri della lista.
    const [hideInactive, setHideInactive] = usePersistentState('questions:hideInactive', false);

    const fetchQuestions = async () => {
        try {
            const res = await api.get('/api/admin/questions');
            setQuestions(res.data);
        } catch (error) {
            console.error("Errore nel recupero delle domande", error);
        }
    };

    useEffect(() => {
        fetchQuestions();
    }, []);

    const filteredQuestions = questions
        .filter(q => !hideInactive || q.is_active !== false)
        .filter(q => searchMatches(q, search));

    // Flusso di disattivazione: tutto delegato al dialogo condiviso
    // DeactivateQuestionDialog (stesso identico comportamento in ParameterForm).
    const [deactivateCandidate, setDeactivateCandidate] = useState(null);

    const doToggle = async (questionId) => {
        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            await fetchQuestions();
        } catch (err) {
            alert(err.response?.data?.detail || 'Operation failed.');
        }
    };

    const handleToggleActive = async (q) => {
        const isActive = q.is_active !== false;
        // Restore: conferma semplice.
        if (!isActive) {
            if (!window.confirm(`Restore question ${q.id}? The action is logged in the parameter change history.`)) return;
            await doToggle(q.id);
            return;
        }
        setDeactivateCandidate(q.id);
    };

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Questions</h1>
            </header>

            <section className="toolbar" style={{
                position: 'sticky',
                top: 'var(--topbar-height)',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: 'var(--filter-card-pad, 0.85rem 1rem)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                marginBottom: '1rem',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: '1rem',
            }}>
                <div className="toolbar__form" style={{ maxWidth: 'none', width: '100%' }}>
                    <input
                        type="search"
                        placeholder="Search every field (ID, parameter, text, instructions, template)..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="toolbar__add">
                    <Link to="/admin/questions/add" className="btn btn--primary">Add Question</Link>
                </div>
            </section>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Text Snippet</th>
                            <th>Type</th>
                            <th>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span>Is Active</span>
                                    <label
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 400, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                        title="Hide deactivated questions from the list"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={hideInactive}
                                            onChange={(e) => setHideInactive(e.target.checked)}
                                        />
                                        <span className="muted"></span>
                                    </label>
                                </div>
                            </th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredQuestions.map(q => {
                            const isActive = q.is_active !== false;
                            return (
                                <tr key={q.id} style={{ opacity: isActive ? 1 : 0.5 }}>
                                    <td style={{ fontWeight: 'bold' }}>{q.id}</td>
                                    <td>{truncate(q.text, 70)}</td>
                                    <td>
                                        {q.is_stop_question
                                            ? <span style={{ color: 'var(--bad, #d9534f)', fontWeight: 700 }}>Stop</span>
                                            : <span className="muted">Standard</span>}
                                    </td>
                                    <td>
                                        {isActive
                                            ? <span className="status ok">Yes</span>
                                            : <span className="status bad">No</span>}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
                                        <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
                                            <Link to={`/admin/questions/${q.id}/edit`} className="btn">Edit</Link>
                                            <button
                                                type="button"
                                                className={`btn ${isActive ? 'btn--danger' : ''}`}
                                                style={{ color: isActive ? 'red' : 'green' }}
                                                onClick={() => handleToggleActive(q)}
                                                title={isActive ? 'Soft-delete (deactivate)' : 'Restore (reactivate)'}
                                            >
                                                {isActive ? 'Delete' : 'Restore'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredQuestions.length === 0 && (
                            <tr>
                                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>No question found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Dialogo di disattivazione condiviso (identico in ParameterForm). */}
            {deactivateCandidate && (
                <DeactivateQuestionDialog
                    questionId={deactivateCandidate}
                    onClose={() => setDeactivateCandidate(null)}
                    onDeactivated={async () => { setDeactivateCandidate(null); await fetchQuestions(); }}
                />
            )}
        </div>
    );
}
