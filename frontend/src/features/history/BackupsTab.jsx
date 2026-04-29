/*
  Tab "Full backups" della pagina History — due sotto-tab:
    - Languages   → snapshot di tutte le lingue (con risposte/esempi)
    - Parameters  → snapshot della *definizione* di ogni parametro (questions
                    + motivations ammesse). Niente sovrapposizione coi backup
                    delle lingue.
  La logica è identica per i due flussi, gli endpoint cambiano.
*/
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

const SUBTABS = {
    LANGUAGES: 'languages',
    PARAMETERS: 'parameters',
};

export default function BackupsTab() {
    const [subtab, setSubtab] = useState(SUBTABS.LANGUAGES);

    return (
        <div>
            {/* Sotto-tab switcher (stile coerente coi tab principali di History) */}
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.25rem' }}>
                <SubTabButton active={subtab === SUBTABS.LANGUAGES} onClick={() => setSubtab(SUBTABS.LANGUAGES)}>
                    Languages
                </SubTabButton>
                <SubTabButton active={subtab === SUBTABS.PARAMETERS} onClick={() => setSubtab(SUBTABS.PARAMETERS)}>
                    Parameters
                </SubTabButton>
            </div>

            {subtab === SUBTABS.LANGUAGES && <LanguagesBackupsPanel />}
            {subtab === SUBTABS.PARAMETERS && <ParametersBackupsPanel />}

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

function SubTabButton({ active, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                padding: '0.45rem 0.95rem',
                background: active ? 'var(--surface-2)' : 'transparent',
                border: '1px solid var(--border)',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: active ? 700 : 500,
                fontSize: '0.85rem',
                borderRadius: '6px',
                cursor: 'pointer',
            }}
        >
            {children}
        </button>
    );
}

// ------------------------------------------------------------------
// Pannello Languages — comportamento originale di BackupsTab
// ------------------------------------------------------------------
function LanguagesBackupsPanel() {
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
        } catch {
            setError('Could not load the languages backup history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchFolders(); }, []);

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        if (!window.confirm('Start a global backup of ALL languages? This may take a few minutes.')) return;
        setIsBackingUp(true); setError('');
        try {
            await api.post('/api/admin/backups/create-all', { note: backupNote });
            setBackupNote('');
            await fetchFolders();
        } catch (err) {
            setError('Error while creating the languages backup: ' + (err.response?.data?.detail || err.message));
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleDelete = async (timestamp) => {
        if (!window.confirm('Are you sure you want to delete this languages backup? This action is irreversible.')) return;
        try {
            await api.delete(`/api/admin/backups/${timestamp}`);
            await fetchFolders();
        } catch {
            setError("Error while deleting the languages backup.");
        }
    };

    return (
        <div>
            <div className="card" style={{ padding: '1.25rem', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Create global languages backup</h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                    Snapshot of <strong>every language</strong> with answers and examples. Useful before major changes — backups remain until they are explicitly deleted.
                </p>

                {isBackingUp ? (
                    <BackupProgress label="Languages backup in progress…" />
                ) : (
                    <form onSubmit={handleCreateBackup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 300px' }}>
                            <label htmlFor="lang-note" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Note (optional)</label>
                            <input
                                id="lang-note" type="text"
                                value={backupNote}
                                onChange={(e) => setBackupNote(e.target.value)}
                                placeholder="E.g. Before the v2.0 release..."
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <button type="submit" className="btn btn--primary">+ Create languages backup now</button>
                    </form>
                )}
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Note</th>
                            <th>Languages</th>
                            <th>Admin</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && folders.map((f, idx) => (
                            <tr key={idx}>
                                <td><strong>{new Date(f.timestamp).toLocaleString()}</strong></td>
                                <td>{f.note || '—'}</td>
                                <td><span style={{ background: '#e2e8f0', padding: '0.1rem 0.55rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700 }}>{f.lang_count}</span></td>
                                <td className="small">{f.user_email}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <Link to={`/admin/backups/${encodeURIComponent(f.timestamp)}`} className="btn btn--small btn--primary">Open</Link>
                                    <button onClick={() => handleDelete(f.timestamp)} className="btn btn--small btn--danger" style={{ marginLeft: '0.4rem', color: 'red' }}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!loading && folders.length === 0 && (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }} className="muted">No languages backup saved.</td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ------------------------------------------------------------------
// Pannello Parameters — backup della *definizione* dei parametri
// ------------------------------------------------------------------
function ParametersBackupsPanel() {
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
        } catch {
            setError('Could not load the parameters backup history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchFolders(); }, []);

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        if (!window.confirm('Start a global backup of ALL parameters (definition + questions + allowed motivations)? This may take a few minutes.')) return;
        setIsBackingUp(true); setError('');
        try {
            await api.post('/api/admin/backups/parameters/create-all', { note: backupNote });
            setBackupNote('');
            await fetchFolders();
        } catch (err) {
            setError('Error while creating the parameters backup: ' + (err.response?.data?.detail || err.message));
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleDelete = async (timestamp) => {
        if (!window.confirm('Are you sure you want to delete this parameters backup? This action is irreversible.')) return;
        try {
            await api.delete(`/api/admin/backups/parameters/${encodeURIComponent(timestamp)}`);
            await fetchFolders();
        } catch {
            setError("Error while deleting the parameters backup.");
        }
    };

    return (
        <div>
            <div className="card" style={{ padding: '1.25rem', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Create global parameters backup</h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                    Snapshot of <strong>every parameter definition</strong> with its questions and the motivations allowed for each question. The data filled in by linguists per language is not included here (see the Languages backup for that).
                </p>

                {isBackingUp ? (
                    <BackupProgress label="Parameters backup in progress…" />
                ) : (
                    <form onSubmit={handleCreateBackup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 300px' }}>
                            <label htmlFor="param-note" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Note (optional)</label>
                            <input
                                id="param-note" type="text"
                                value={backupNote}
                                onChange={(e) => setBackupNote(e.target.value)}
                                placeholder="E.g. Before the questions revision..."
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <button type="submit" className="btn btn--primary">+ Create parameters backup now</button>
                    </form>
                )}
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Note</th>
                            <th>Parameters</th>
                            <th>Admin</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && folders.map((f, idx) => (
                            <tr key={idx}>
                                <td><strong>{new Date(f.timestamp).toLocaleString()}</strong></td>
                                <td>{f.note || '—'}</td>
                                <td><span style={{ background: '#e2e8f0', padding: '0.1rem 0.55rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700 }}>{f.param_count}</span></td>
                                <td className="small">{f.user_email}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <Link to={`/admin/backups/parameters/${encodeURIComponent(f.timestamp)}`} className="btn btn--small btn--primary">Open</Link>
                                    <button onClick={() => handleDelete(f.timestamp)} className="btn btn--small btn--danger" style={{ marginLeft: '0.4rem', color: 'red' }}>Delete</button>
                                </td>
                            </tr>
                        ))}
                        {!loading && folders.length === 0 && (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }} className="muted">No parameters backup saved.</td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function BackupProgress({ label }) {
    return (
        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <h4 style={{ color: '#ff4500', marginBottom: '0.5rem' }}>{label}</h4>
            <div style={{ width: '100%', background: '#e9ecef', height: '10px', borderRadius: '5px', overflow: 'hidden', margin: '1rem 0', position: 'relative' }}>
                <div className="progress-bar-moving" style={{ height: '100%', background: '#ff4500', borderRadius: '5px', position: 'absolute', width: '30%', animation: 'progress-loop 2s infinite linear' }}></div>
            </div>
            <div className="alert" style={{ backgroundColor: '#fee2e2', color: '#7f1d1d', padding: '0.6rem', display: 'inline-block', borderRadius: '4px', fontWeight: '600', fontSize: '0.85rem' }}>
                Do not close or refresh the page!
            </div>
        </div>
    );
}
