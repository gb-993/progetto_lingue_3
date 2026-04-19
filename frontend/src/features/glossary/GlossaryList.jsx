import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function GlossaryList() {
    const [glossary, setGlossary] = useState([]);
    const [search, setSearch] = useState('');

    const fetchGlossary = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('http://localhost:8000/api/admin/glossary', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setGlossary(res.data);
        } catch (error) {
            console.error("Errore nel recupero del glossario", error);
        }
    };

    useEffect(() => {
        fetchGlossary();
    }, []);

    const handleDelete = async (id) => {
        if (!window.confirm('Sei sicuro di voler eliminare questo termine?')) return;

        try {
            const token = localStorage.getItem('token');
            await axios.delete(`http://localhost:8000/api/admin/glossary/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchGlossary();
        } catch (error) {
            alert('Errore durante l\'eliminazione');
            console.error(error);
        }
    };

    const filteredGlossary = glossary.filter(item =>
        item.word.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Glossary Management</h1>
                <p className="muted dashboard-copy">Gestisci i termini del glossario (Admin)</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input
                        type="search"
                        placeholder="Search term..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="toolbar__add">
                    <Link to="/admin/glossary/add" className="btn btn--primary">Add Term</Link>
                </div>
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Word</th>
                        <th>Description</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {filteredGlossary.map(item => (
                        <tr key={item.id}>
                            <td style={{fontWeight: 'bold'}}>{item.id}</td>
                            <td>{item.word}</td>
                            <td className="muted" style={{maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                {item.description}
                            </td>
                            <td className="row-actions">
                                <Link to={`/admin/glossary/${item.id}/edit`} className="btn">Edit</Link>
                                <button onClick={() => handleDelete(item.id)} className="btn btn--danger" style={{color: 'red'}}>Delete</button>
                            </td>
                        </tr>
                    ))}
                    {filteredGlossary.length === 0 && (
                        <tr>
                            <td colSpan="4" style={{textAlign: 'center', padding: '2rem'}}>Nessun termine trovato.</td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
