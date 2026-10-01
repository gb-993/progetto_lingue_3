import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';
import usePersistentState from '../../utils/usePersistentState';
import DeactivateQuestionDialog from './DeactivateQuestionDialog';
import DeleteQuestionDialog from './DeleteQuestionDialog';

function truncate(text, n = 70) {
    if (!text) return '';
    return text.length > n ? text.slice(0, n) + '…' : text;
}

export default function QuestionList() {
    const [questions, setQuestions] = useState([]);
    const [search, setSearch] = usePersistentState('questions:search', '');
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
        .filter(question => !hideInactive || question.is_active !== false)
        .filter(question => searchMatches(question, search));

    const [deactivateCandidate, setDeactivateCandidate] = useState(null);
    const [deleteCandidate, setDeleteCandidate] = useState(null);

    const doToggle = async (questionId) => {
        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            await fetchQuestions();
        } catch (err) {
            alert(err.response?.data?.detail || 'Operation failed.');
        }
    };

    const handleToggleActive = async (question) => {
        const isActive = question.is_active !== false;
        if (!isActive) {
            if (!window.confirm(`Restore question ${question.id}? The action is logged in the parameter change history.`)) return;
            await doToggle(question.id);
            return;
        }
        setDeactivateCandidate(question.id);
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

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Text Snippet</th>
                            <th className="hide-mobile">Type</th>
                            <th className="hide-mobile">
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
                        {filteredQuestions.map(question => {
                            const isActive = question.is_active !== false;
                            return (
                                <tr key={question.id} style={{ opacity: isActive ? 1 : 0.5 }}>
                                    <td style={{ fontWeight: 'bold' }}>{question.id}</td>
                                    <td>{truncate(question.text, 70)}</td>
                                    <td className="hide-mobile">
                                        {question.is_stop_question
                                            ? <span style={{ color: 'var(--bad, #d9534f)', fontWeight: 700 }}>Stop</span>
                                            : <span className="muted">Standard</span>}
                                    </td>
                                    <td className="hide-mobile">
                                        {isActive
                                            ? <span className="status ok">Yes</span>
                                            : <span className="status bad">No</span>}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
                                        <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
                                            <Link to={`/admin/questions/${question.id}/edit`} className="btn">Edit</Link>
                                            <button
                                                type="button"
                                                className={`btn ${isActive ? 'btn--danger' : ''}`}
                                                style={{ color: isActive ? 'red' : 'green' }}
                                                onClick={() => handleToggleActive(question)}
                                                title={isActive ? 'Deactivate (soft-delete: keeps the data, hides the question)' : 'Restore (reactivate)'}
                                            >
                                                {isActive ? 'Deactivate' : 'Restore'}
                                            </button>
                                            {!isActive && (
                                                <button
                                                    type="button"
                                                    className="btn btn--danger"
                                                    style={{ color: 'red' }}
                                                    onClick={() => setDeleteCandidate(question.id)}
                                                    title="Delete permanently (linked data is archived first)"
                                                    aria-label={`Delete question ${question.id} permanently`}
                                                >
                                                    🗑
                                                </button>
                                            )}
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

            {deactivateCandidate && (
                <DeactivateQuestionDialog
                    questionId={deactivateCandidate}
                    onClose={() => setDeactivateCandidate(null)}
                    onDeactivated={async () => { setDeactivateCandidate(null); await fetchQuestions(); }}
                />
            )}

            {deleteCandidate && (
                <DeleteQuestionDialog
                    questionId={deleteCandidate}
                    onClose={() => setDeleteCandidate(null)}
                    onDeleted={async () => { setDeleteCandidate(null); await fetchQuestions(); }}
                />
            )}
        </div>
    );
}
