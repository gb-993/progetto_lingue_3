import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';

function truncate(text, n = 70) {
    if (!text) return '';
    return text.length > n ? text.slice(0, n) + '…' : text;
}

export default function QuestionList() {
    const [questions, setQuestions] = useState([]);
    const [search, setSearch] = useState('');

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

    const filteredQuestions = questions.filter(q => searchMatches(q, search));

    const handleToggleActive = async (q) => {
        const isActive = q.is_active !== false;
        const actionText = isActive ? 'deactivate (soft-delete)' : 'restore';
        if (!window.confirm(`Are you sure you want to ${actionText} question ${q.id}? The action is logged in the parameter change history.`)) return;
        try {
            await api.patch(`/api/admin/questions/${q.id}/toggle-active`);
            await fetchQuestions();
        } catch (err) {
            alert(err.response?.data?.detail || 'Operation failed.');
        }
    };

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Questions</h1>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
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
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredQuestions.map(q => {
                            const isActive = q.is_active !== false;
                            return (
                                <tr key={q.id} style={{ opacity: isActive ? 1 : 0.5 }}>
                                    <td style={{ fontWeight: 'bold' }}>{q.id}</td>
                                    <td>
                                        {truncate(q.text, 70)}
                                        {!isActive && <> <span className="status bad">Inactive</span></>}
                                    </td>
                                    <td>
                                        {q.is_stop_question
                                            ? <span style={{ color: 'var(--bad, #d9534f)', fontWeight: 700 }}>Stop</span>
                                            : <span className="muted">Standard</span>}
                                    </td>
                                    <td className="row-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                                        <Link to={`/admin/questions/${q.id}/edit`} className="btn">Edit</Link>
                                        <button
                                            type="button"
                                            className={`btn ${isActive ? 'btn--bad' : ''}`}
                                            onClick={() => handleToggleActive(q)}
                                            title={isActive ? 'Soft-delete (deactivate)' : 'Restore (reactivate)'}
                                        >
                                            {isActive ? 'Delete' : 'Restore'}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredQuestions.length === 0 && (
                            <tr>
                                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem' }}>No question found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
