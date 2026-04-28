import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';

export default function GlossaryList() {
    const [glossary, setGlossary] = useState([]);
    const [search, setSearch] = useState('');

    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    const fetchGlossary = async () => {
        try {
            const res = await api.get('/api/glossary');
            setGlossary(res.data);
        } catch (error) {
            console.error("Errore nel recupero del glossario", error);
        }
    };

    useEffect(() => {
        fetchGlossary();
    }, []);

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this term?')) return;

        try {
            await api.delete(`/api/admin/glossary/${id}`);
            fetchGlossary();
        } catch (error) {
            alert('Error during deletion');
            console.error(error);
        }
    };

    // Cerca su word + description (e ogni altro campo)
    const filteredGlossary = glossary.filter(item => searchMatches(item, search));

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Glossary</h1>
                <p className="muted dashboard-copy">Browse terms and definitions</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form" style={{ width: '100%', maxWidth: '500px' }}>
                    <input
                        type="search"
                        placeholder="Search by term or description..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                </div>
                {isAdmin && (
                    <div className="toolbar__add">
                        <Link to="/admin/glossary/add" className="btn btn--primary">Add Term</Link>
                    </div>
                )}
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden', marginTop: '1.5rem'}}>
                {/* Aggiunto tableLayout: 'fixed' per stabilizzare le larghezze */}
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead style={{ backgroundColor: '#f9f9f9', textAlign: 'left' }}>
                    <tr>
                        {isAdmin && <th style={{ padding: '1rem', borderBottom: '2px solid #eee', width: '8%' }}>ID</th>}
                        <th style={{ padding: '1rem', width: '25%', borderBottom: '2px solid #eee' }}>Term</th>
                        <th style={{ padding: '1rem', width: isAdmin ? '45%' : '75%', borderBottom: '2px solid #eee' }}>Description</th>
                        {isAdmin && <th style={{ padding: '1rem', width: '22%', textAlign: 'right', borderBottom: '2px solid #eee' }}>Actions</th>}
                    </tr>
                    </thead>
                    <tbody>
                    {filteredGlossary.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #eee' }}>
                            {isAdmin && (
                                <td style={{ fontWeight: 'bold', padding: '1rem', verticalAlign: 'top' }}>{item.id}</td>
                            )}
                            <td style={{ fontWeight: 'bold', padding: '1rem', verticalAlign: 'top', wordWrap: 'break-word' }}>
                                {item.word}
                            </td>
                            <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                                {/* DIV CON TRONCAMENTO A 3 RIGHE */}
                                <div style={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,           /* Cambia questo numero per mostrare più o meno righe */
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: '1.5',
                                    whiteSpace: 'pre-wrap'
                                }}>
                                    {item.description}
                                </div>
                            </td>
                            {isAdmin && (
                                <td className="row-actions" style={{ padding: '1rem', textAlign: 'right', verticalAlign: 'top' }}>
                                    <Link to={`/admin/glossary/${item.id}/edit`} className="btn">Edit</Link>
                                    <button onClick={() => handleDelete(item.id)} className="btn btn--danger" style={{color: 'red', marginLeft: '0.5rem'}}>Delete</button>
                                </td>
                            )}
                        </tr>
                    ))}
                    {filteredGlossary.length === 0 && (
                        <tr>
                            <td colSpan={isAdmin ? "4" : "2"} style={{textAlign: 'center', padding: '2rem', color: 'var(--text-muted)'}}>
                                No term found.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}