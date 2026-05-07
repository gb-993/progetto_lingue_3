import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';
import { formatBackendDate } from '../../utils/dateFormat';

// Lista parametri salvati in una cartella (timestamp) di backup parametri.
export default function ParameterBackupFolder() {
    const { timestamp } = useParams();
    const [submissions, setSubmissions] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchFolderContents = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/api/admin/backups/parameters/folder?timestamp=${encodeURIComponent(timestamp)}`);
                setSubmissions(res.data || []);
            } catch (err) {
                console.error('Errore nel recupero dei contenuti della cartella parametri', err);
                setError('Could not load the parameters for this backup.');
            } finally {
                setLoading(false);
            }
        };
        if (timestamp) fetchFolderContents();
    }, [timestamp]);

    const filteredSubmissions = submissions.filter((sub) => {
        const term = search.toLowerCase().trim();
        if (!term) return true;
        return (
            String(sub.parameter_id || '').toLowerCase().includes(term) ||
            String(sub.parameter_name || '').toLowerCase().includes(term) ||
            String(sub.schema || '').toLowerCase().includes(term) ||
            String(sub.param_type || '').toLowerCase().includes(term)
        );
    });

    const displayDate = formatBackendDate(timestamp);

    return (
        <div className="container">
            <header className="dashboard-hero" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Link to="/admin/history?tab=backups" className="btn btn-outline-secondary">← Back to all folders</Link>
                    <h1 className="m-0" style={{ margin: 0 }}>Parameters backup: {displayDate}</h1>
                </div>
            </header>

            <section className="toolbar" style={{ marginBottom: '1.5rem' }}>
                <div className="toolbar__form">
                    <input
                        type="search"
                        className="form-control"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search parameters in this backup..."
                        style={{ width: '100%', padding: '0.5rem' }}
                    />
                </div>
            </section>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="table-responsive card" style={{ padding: 0 }}>
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                    <tr>
                        <th>Parameter Name</th>
                        <th>ID</th>
                        <th>Schema</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>Details</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredSubmissions.map(sub => (
                        <tr key={sub.id}>
                            <td><strong>{sub.parameter_name || '—'}</strong></td>
                            <td><code>{sub.parameter_id}</code></td>
                            <td className="muted small">{sub.schema || '—'}</td>
                            <td>{sub.param_type ? <span className="badge">{sub.param_type}</span> : '—'}</td>
                            <td>
                                <span className={`status ${sub.is_active ? 'ok' : 'bad'}`}>
                                    {sub.is_active ? 'Active' : 'Disabled'}
                                </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                                <Link className="btn btn-sm btn-outline-primary" to={`/admin/backups/parameters/submissions/${sub.id}`}>
                                    View Data
                                </Link>
                            </td>
                        </tr>
                    ))}
                    {filteredSubmissions.length === 0 && !loading && (
                        <tr><td colSpan="6" className="text-center" style={{ textAlign: 'center', padding: '2rem' }}>No parameter found in this backup.</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
