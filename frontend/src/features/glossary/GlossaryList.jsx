import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

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
        if (!window.confirm('Sei sicuro di voler eliminare questo termine?')) return;

        try {
            await api.delete(`/api/admin/glossary/${id}`);
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
                <h1>Glossario</h1>
                <p className="muted dashboard-copy">Consulta i termini e le definizioni</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form" style={{ width: '100%', maxWidth: '500px' }}>
                    <input
                        type="search"
                        placeholder="Cerca un termine..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                </div>
                {isAdmin && (
                    <div className="toolbar__add">
                        <Link to="/admin/glossary/add" className="btn btn--primary">Aggiungi Termine</Link>
                    </div>
                )}
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden', marginTop: '1.5rem'}}>
                {/* Aggiunto tableLayout: 'fixed' per stabilizzare le larghezze */}
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead style={{ backgroundColor: '#f9f9f9', textAlign: 'left' }}>
                    <tr>
                        {isAdmin && <th style={{ padding: '1rem', borderBottom: '2px solid #eee', width: '8%' }}>ID</th>}
                        <th style={{ padding: '1rem', width: '25%', borderBottom: '2px solid #eee' }}>Termine</th>
                        <th style={{ padding: '1rem', width: isAdmin ? '45%' : '75%', borderBottom: '2px solid #eee' }}>Descrizione</th>
                        {isAdmin && <th style={{ padding: '1rem', width: '22%', textAlign: 'right', borderBottom: '2px solid #eee' }}>Azioni</th>}
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
                                    <Link to={`/admin/glossary/${item.id}/edit`} className="btn">Modifica</Link>
                                    <button onClick={() => handleDelete(item.id)} className="btn btn--danger" style={{color: 'red', marginLeft: '0.5rem'}}>Elimina</button>
                                </td>
                            )}
                        </tr>
                    ))}
                    {filteredGlossary.length === 0 && (
                        <tr>
                            <td colSpan={isAdmin ? "4" : "2"} style={{textAlign: 'center', padding: '2rem', color: '#666'}}>
                                Nessun termine trovato.
                            </td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}