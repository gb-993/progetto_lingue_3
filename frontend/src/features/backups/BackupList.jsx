import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ==========================================
// Pagina "Backup History" con due tab:
//   - Languages  → cartelle di backup di tutte le lingue
//   - Parameters → cartelle di backup della *definizione* dei parametri
// I due flussi sono identici nella UI ma puntano a endpoint diversi.
// ==========================================

const TABS = {
    LANGUAGES: 'languages',
    PARAMETERS: 'parameters',
};

export default function BackupList() {
    const [tab, setTab] = useState(TABS.LANGUAGES);

    return (
        <div className="container">
            <header className="dashboard-hero" style={{ marginBottom: '2rem' }}>
                <h1>Backup History</h1>
            </header>

            {/* TAB SWITCHER */}
            <div role="tablist" style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <TabButton active={tab === TABS.LANGUAGES} onClick={() => setTab(TABS.LANGUAGES)}>
                    Languages
                </TabButton>
                <TabButton active={tab === TABS.PARAMETERS} onClick={() => setTab(TABS.PARAMETERS)}>
                    Parameters
                </TabButton>
            </div>

            {tab === TABS.LANGUAGES && <LanguagesBackupsTab />}
            {tab === TABS.PARAMETERS && <ParametersBackupsTab />}

            <style>{`
                @keyframes progress-loop {
                    0% { left: -30%; width: 30%; }
                    50% { left: 40%; width: 40%; }
                    100% { left: 100%; width: 30%; }
                }
            `}</style>
        </div>
    );
}

function TabButton({ active, onClick, children }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            style={{
                padding: '0.6rem 1.1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--brand, #ff4500)' : 'transparent'}`,
                color: active ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                marginBottom: '-1px',
            }}
        >
            {children}
        </button>
    );
}

// ------------------------------------------
// Tab "Languages" — comportamento originale
// ------------------------------------------
function LanguagesBackupsTab() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [backupNote, setBackupNote] = useState('');
    const [error, setError] = useState('');

    const fetchFolders = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/admin/backups');
            setFolders(res.data || []);
        } catch (err) {
            console.error('Errore nel recupero dei backup', err);
            setError('Could not load the backup history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchFolders(); }, []);

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        if (!window.confirm('Are you sure you want to start a global backup of every language? This may take a while.')) return;
        setIsBackingUp(true);
        setError('');
        try {
            await api.post('/api/admin/backups/create-all', { note: backupNote });
            setBackupNote('');
            await fetchFolders();
        } catch (err) {
            console.error(err);
            setError('Error while creating the backup: ' + (err.response?.data?.detail || err.message));
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleDelete = async (timestamp) => {
        if (!window.confirm('Are you sure you want to delete this entire languages backup? The operation is irreversible.')) return;
        try {
            await api.delete(`/api/admin/backups/${timestamp}`);
            await fetchFolders();
        } catch (err) {
            console.error(err);
            setError('Error while deleting the backup.');
        }
    };

    return (
        <>
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: '2rem', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '2rem' }}>
                {isBackingUp ? (
                    <BackupProgress label="Languages backup creation in progress…" />
                ) : (
                    <form onSubmit={handleCreateBackup}>
                        <div className="form-row">
                            <label htmlFor="lang-note" style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
                                Optional note for a new Global Languages Backup
                            </label>
                            <input
                                id="lang-note"
                                type="text"
                                className="form-control"
                                value={backupNote}
                                onChange={(e) => setBackupNote(e.target.value)}
                                placeholder="Example: Before the v2.0 release"
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div className="toolbar" style={{ marginTop: '1rem' }}>
                            <button type="submit" className="btn btn--primary" style={{ backgroundColor: '#ff4500', color: 'white', border: 'none' }}>
                                + Start Full Languages Backup
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <div className="table-responsive card" style={{ padding: 0 }}>
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                    <tr>
                        <th>Date</th>
                        <th>Notes</th>
                        <th>Languages</th>
                        <th>Admin</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && folders.map((f, idx) => (
                        <tr key={idx}>
                            <td><strong>{new Date(f.timestamp).toLocaleString()}</strong></td>
                            <td>{f.note || "-"}</td>
                            <td><span className="badge rounded-pill bg-secondary">{f.lang_count}</span></td>
                            <td><small>{f.user_email}</small></td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                                    <Link className="btn btn-sm btn-primary" to={`/admin/backups/${encodeURIComponent(f.timestamp)}`}>
                                        Open folder
                                    </Link>
                                    <button
                                        onClick={() => handleDelete(f.timestamp)}
                                        className="btn btn-sm btn-danger"
                                        style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}>
                                        Delete
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {folders.length === 0 && !loading && (
                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>No languages backup found.</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ------------------------------------------
// Tab "Parameters" — backup della definizione dei parametri
// ------------------------------------------
function ParametersBackupsTab() {
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [backupNote, setBackupNote] = useState('');
    const [error, setError] = useState('');

    const fetchFolders = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/admin/backups/parameters');
            setFolders(res.data || []);
        } catch (err) {
            console.error('Errore nel recupero dei backup parametri', err);
            setError('Could not load the parameters backup history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchFolders(); }, []);

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        if (!window.confirm('Are you sure you want to start a global backup of every parameter? This may take a while.')) return;
        setIsBackingUp(true);
        setError('');
        try {
            await api.post('/api/admin/backups/parameters/create-all', { note: backupNote });
            setBackupNote('');
            await fetchFolders();
        } catch (err) {
            console.error(err);
            setError('Error while creating the parameters backup: ' + (err.response?.data?.detail || err.message));
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleDelete = async (timestamp) => {
        if (!window.confirm('Are you sure you want to delete this entire parameters backup? The operation is irreversible.')) return;
        try {
            await api.delete(`/api/admin/backups/parameters/${encodeURIComponent(timestamp)}`);
            await fetchFolders();
        } catch (err) {
            console.error(err);
            setError('Error while deleting the parameters backup.');
        }
    };

    return (
        <>
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: '2rem', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '2rem' }}>
                {isBackingUp ? (
                    <BackupProgress label="Parameters backup creation in progress…" />
                ) : (
                    <form onSubmit={handleCreateBackup}>
                        <div className="form-row">
                            <label htmlFor="param-note" style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
                                Optional note for a new Global Parameters Backup
                            </label>
                            <input
                                id="param-note"
                                type="text"
                                className="form-control"
                                value={backupNote}
                                onChange={(e) => setBackupNote(e.target.value)}
                                placeholder="Example: Before the questions revision"
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div className="toolbar" style={{ marginTop: '1rem' }}>
                            <button type="submit" className="btn btn--primary" style={{ backgroundColor: '#ff4500', color: 'white', border: 'none' }}>
                                + Start Full Parameters Backup
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <div className="table-responsive card" style={{ padding: 0 }}>
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                    <tr>
                        <th>Date</th>
                        <th>Notes</th>
                        <th>Parameters</th>
                        <th>Admin</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && folders.map((f, idx) => (
                        <tr key={idx}>
                            <td><strong>{new Date(f.timestamp).toLocaleString()}</strong></td>
                            <td>{f.note || "-"}</td>
                            <td><span className="badge rounded-pill bg-secondary">{f.param_count}</span></td>
                            <td><small>{f.user_email}</small></td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-end' }}>
                                    <Link className="btn btn-sm btn-primary" to={`/admin/backups/parameters/${encodeURIComponent(f.timestamp)}`}>
                                        Open folder
                                    </Link>
                                    <button
                                        onClick={() => handleDelete(f.timestamp)}
                                        className="btn btn-sm btn-danger"
                                        style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}>
                                        Delete
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    {folders.length === 0 && !loading && (
                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>No parameters backup found.</td></tr>
                    )}
                    </tbody>
                </table>
            </div>
        </>
    );
}

function BackupProgress({ label }) {
    return (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <h3 className="h4" style={{ color: '#ff4500', marginBottom: '0.5rem' }}>{label}</h3>
            <div style={{ width: '100%', background: '#e9ecef', height: '12px', borderRadius: '6px', overflow: 'hidden', margin: '1.5rem 0', position: 'relative' }}>
                <div className="progress-bar-moving" style={{ height: '100%', background: '#ff4500', borderRadius: '6px', position: 'absolute', width: '30%', animation: 'progress-loop 2s infinite linear' }}></div>
            </div>
            <div className="alert" style={{ backgroundColor: '#f8d7da', color: '#721c24', padding: '0.75rem', display: 'inline-block', borderRadius: '4px', fontWeight: '600' }}>
                WARNING: Do NOT close this window or refresh the page until the process is complete!
            </div>
        </div>
    );
}
