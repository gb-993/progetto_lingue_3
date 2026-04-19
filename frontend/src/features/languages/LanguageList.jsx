import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function LanguageList() {
    const [languages, setLanguages] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchLangs = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('http://localhost:8000/api/admin/languages', {
                    headers: { Authorization: `Bearer ${token}` }
                });
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
            String(lang.family || '').toLowerCase().includes(term) ||
            String(lang.top_level_family || '').toLowerCase().includes(term)
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
                <div className="toolbar__add">
                    <Link to="/languages/add" className="btn btn--primary">Add Language</Link>
                </div>
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
                            <td className="row-actions">
                                <Link to={`/languages/${lang.id}/data`} className="btn">Data</Link>
                                <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>
                            </td>
                        </tr>
                    ))}
                    {!loading && filteredLanguages.length === 0 && (
                        <tr>
                            <td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Nessuna lingua trovata.</td>
                        </tr>
                    )}
                    {loading && (
                        <tr>
                            <td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Caricamento lingue...</td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
