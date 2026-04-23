import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';

export default function BackupFolder() {
    const { timestamp } = useParams();
    const [submissions, setSubmissions] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchFolderContents = async () => {
            setLoading(true);
            try {
                // Passiamo il timestamp come parametro query all'API
                const res = await api.get(`/api/admin/backups/folder?timestamp=${encodeURIComponent(timestamp)}`);
                setSubmissions(res.data || []);
            } catch (err) {
                console.error('Errore nel recupero dei contenuti della cartella', err);
                setError('Impossibile caricare le lingue per questo backup.');
            } finally {
                setLoading(false);
            }
        };

        if (timestamp) {
            fetchFolderContents();
        }
    }, [timestamp]);

    // Filtro di ricerca per nome lingua o ID
    const filteredSubmissions = submissions.filter((sub) => {
        const term = search.toLowerCase().trim();
        if (!term) return true;
        return (
            String(sub.language_id || '').toLowerCase().includes(term) ||
            String(sub.language_name || '').toLowerCase().includes(term)
        );
    });

    // Formattiamo la data per renderla più leggibile nell'header
    const displayDate = new Date(timestamp).toLocaleString();

    return (
        <div className="container">
            <header className="dashboard-hero" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Link to="/admin/backups" className="btn btn-outline-secondary">← Back to all folders</Link>
                    <h1 className="m-0" style={{ margin: 0 }}>Backup: {displayDate}</h1>
                </div>
            </header>

            <section className="toolbar" style={{ marginBottom: '1.5rem' }}>
                <div className="toolbar__form">
                    <input
                        type="search"
                        className="form-control"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search languages in this backup..."
                        style={{ width: '100%', padding: '0.5rem' }}
                    />
                </div>
            </section>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="table-responsive card" style={{ padding: 0 }}>
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                    <tr>
                        <th>Language Name</th>
                        <th>ID</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Details</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredSubmissions.map(sub => (
                        <tr key={sub.id}>
                            <td><strong>{sub.language_name}</strong></td>
                            <td><code>{sub.language_id}</code></td>
                            <td><span className="badge bg-success" style={{ backgroundColor: '#28a745', color: 'white', padding: '0.25em 0.6em', borderRadius: '50px', fontSize: '0.85em' }}>Saved</span></td>
                            <td style={{ textAlign: 'right' }}>
                                <Link className="btn btn-sm btn-outline-primary" to={`/admin/backups/submissions/${sub.id}`}>
                                    View Data
                                </Link>
                            </td>
                        </tr>
                    ))}
                    {filteredSubmissions.length === 0 && !loading && (
                        <tr><td colSpan="4" className="text-center" style={{ textAlign: 'center', padding: '2rem' }}>No language found in this backup.</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}