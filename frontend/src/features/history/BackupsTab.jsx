/*
  Tab "Backup completi" — riusa il flow del vecchio BackupList ma estratto come
  componente tab della pagina History (niente più pagina /admin/backups separata).
*/
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function BackupsTab() {
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
            setError('Could not load the backup history.');
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
            setError('Error while creating the backup: ' + (err.response?.data?.detail || err.message));
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleDelete = async (timestamp) => {
        if (!window.confirm('Are you sure you want to delete this backup? This action is irreversible.')) return;
        try {
            await api.delete(`/api/admin/backups/${timestamp}`);
            await fetchFolders();
        } catch {
            setError("Error while deleting the backup.");
        }
    };

    return (
        <div>
            <div className="card" style={{ padding: '1.25rem', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Create global backup</h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                    Snapshot of <strong>every language</strong> with answers and examples. Useful before major changes — backups remain until they are explicitly deleted.
                </p>

                {isBackingUp ? (
                    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                        <h4 style={{ color: '#ff4500', marginBottom: '0.5rem' }}>Backup in progress…</h4>
                        <div style={{ width: '100%', background: '#e9ecef', height: '10px', borderRadius: '5px', overflow: 'hidden', margin: '1rem 0', position: 'relative' }}>
                            <div className="progress-bar-moving" style={{ height: '100%', background: '#ff4500', borderRadius: '5px', position: 'absolute', width: '30%', animation: 'progress-loop 2s infinite linear' }}></div>
                        </div>
                        <div className="alert" style={{ backgroundColor: '#fee2e2', color: '#7f1d1d', padding: '0.6rem', display: 'inline-block', borderRadius: '4px', fontWeight: '600', fontSize: '0.85rem' }}>
                            Do not close or refresh the page!
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleCreateBackup} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 300px' }}>
                            <label htmlFor="note" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Note (optional)</label>
                            <input
                                id="note" type="text"
                                value={backupNote}
                                onChange={(e) => setBackupNote(e.target.value)}
                                placeholder="E.g. Before the v2.0 release, before the import on 04/27..."
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <button type="submit" className="btn btn--primary">+ Create backup now</button>
                    </form>
                )}
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            {/* Lista backups */}
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
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }} className="muted">No backup saved.</td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

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
