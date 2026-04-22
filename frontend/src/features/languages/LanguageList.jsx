import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function LanguageList() {
    const [languages, setLanguages] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Recuperiamo il ruolo per la gestione della UI
    const role = localStorage.getItem('role');

    useEffect(() => {
        const fetchLangs = async () => {
            try {
                // Questa chiamata ora restituirà dati diversi in base al ruolo (filtrati dal backend)
                const res = await api.get('/api/admin/languages');
                setLanguages(res.data || []);
            } catch (err) {
                console.error('Errore nel recupero delle lingue', err);
                setError('Impossibile caricare le lingue.');
            } finally {
                setLoading(false);
            }
        };
        fetchLangs();
    }, []);

    const filteredLanguages = languages.filter((lang) => {
        const term = search.toLowerCase().trim();
        if (!term) return true;
        return (
            String(lang.id || '').toLowerCase().includes(term) ||
            String(lang.name_full || '').toLowerCase().includes(term) ||
            String(lang.family || '').toLowerCase().includes(term)
        );
    });

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Languages</h1>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input
                        type="search"
                        placeholder="Search languages..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                {/* Bottone Add visibile solo ad Admin */}
                {role === 'admin' && (
                    <div className="toolbar__add">
                        <Link to="/languages/add" className="btn btn--primary">Add Language</Link>
                    </div>
                )}
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                {error && <div style={{color: 'red', padding: '1rem'}}>{error}</div>}
                <table className="table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Family</th>
                        <th>Geography</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredLanguages.map(lang => (
                        <tr key={lang.id}>
                            <td style={{fontWeight: 'bold'}}>{lang.id}</td>
                            <td>{lang.name_full}</td>
                            <td className="muted">{lang.family}</td>
                            <td className="small">
                                {lang.latitude ? `${lang.latitude}, ${lang.longitude}` : "No coords"}
                            </td>
                            <td className="row-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <Link to={`/languages/${lang.id}/data`} className="btn btn--primary">Data</Link>

                                {/* Azioni amministrative visibili solo ad Admin */}
                                {role === 'admin' && (
                                    <>
                                        <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>
                                        <Link to={`/languages/${lang.id}/debug`} className="btn">Debug</Link>
                                    </>
                                )}
                            </td>
                        </tr>
                    ))}
                    {filteredLanguages.length === 0 && !loading && (
                        <tr>
                            <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>Nessuna lingua trovata.</td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}