import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function QuestionList() {
    const [questions, setQuestions] = useState([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        const fetchQuestions = async () => {
            try {
                // Chiamata centralizzata: non serve più l'header di autorizzazione manuale
                const res = await api.get('/api/admin/questions');
                setQuestions(res.data);
            } catch (error) {
                console.error("Errore nel recupero delle domande", error);
            }
        };
        fetchQuestions();
    }, []);

    const filteredQuestions = questions.filter(q =>
        q.id.toLowerCase().includes(search.toLowerCase()) ||
        q.text.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Question Management</h1>
                <p className="muted dashboard-copy">Gestione delle domande per i parametri (Admin)</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input
                        type="search"
                        placeholder="Cerca per ID o testo..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="toolbar__add">
                    <Link to="/admin/questions/add" className="btn btn--primary">Add Question</Link>
                </div>
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Param ID</th>
                        <th>Text</th>
                        <th>Stop Question</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {filteredQuestions.map(q => (
                        <tr key={q.id}>
                            <td style={{fontWeight: 'bold'}}>{q.id}</td>
                            <td>{q.parameter_id}</td>
                            <td style={{maxWidth: '400px'}}>{q.text}</td>
                            <td>{q.is_stop_question ? '✅' : '❌'}</td>
                            <td className="row-actions">
                                <Link to={`/admin/questions/${q.id}/edit`} className="btn">Edit</Link>
                            </td>
                        </tr>
                    ))}
                    {filteredQuestions.length === 0 && (
                        <tr>
                            <td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Nessuna domanda trovata.</td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}