import { useState, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ==========================================
// Tab "Old questions archive" della pagina History.
// Archivio risposte/esempi delle question modificate in modo non
// compatibile con i dati raccolti (bottone "Save and delete the linked
// data" nell'edit di una question). La lista e' raggruppata per
// question_id, ogni gruppo si espande e mostra le versioni archiviate
// in ordine cronologico (piu' recente per primo).
// ==========================================
export default function OldQuestionsTab() {
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());

    const fetchGroups = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/admin/archived-questions');
            setGroups(res.data || []);
        } catch (err) {
            console.error('Errore nel recupero delle questions archiviate', err);
            setError('Could not load the archived questions.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchGroups(); }, []);

    const toggleExpanded = (key) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleDownloadXlsx = async (versionId) => {
        try {
            const res = await api.get(`/api/admin/archived-questions/${versionId}/xlsx`, {
                responseType: 'blob',
            });
            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^"]+)"?/);
            const fname = m ? m[1] : `archived_question_${versionId}.xlsx`;
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement('a');
            a.href = url;
            a.download = fname;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            alert('Could not download the archive.');
        }
    };

    const handleDelete = async (versionId) => {
        if (!window.confirm('Delete this archived version? The underlying answers and examples will be permanently lost.')) return;
        try {
            await api.delete(`/api/admin/archived-questions/${versionId}`);
            await fetchGroups();
        } catch {
            alert('Could not delete the archived version.');
        }
    };

    const filteredGroups = groups.filter(g => {
        if (!search.trim()) return true;
        const s = search.toLowerCase();
        if ((g.original_question_id || '').toLowerCase().includes(s)) return true;
        if ((g.parameter_id || '').toLowerCase().includes(s)) return true;
        if ((g.parameter_name || '').toLowerCase().includes(s)) return true;
        return (g.versions || []).some(v =>
            (v.text_preview || '').toLowerCase().includes(s) ||
            (v.archive_note || '').toLowerCase().includes(s)
        );
    });

    return (
        <>
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
                <p className="small muted" style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.45 }}>
                    Each row groups the archived versions of a single question. A new version
                    is created whenever an admin saves a question with the
                    <strong> "Save and delete the linked data" </strong>
                    button: the previous answers/examples for every language are moved here
                    and stay downloadable.
                </p>
            </div>

            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                <input
                    type="search"
                    placeholder="Search by question ID, parameter, archived text or note..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                />
            </div>

            <div className="table-responsive card" style={{ padding: 0 }}>
                <table className="table table-hover align-middle">
                    <thead className="table-light">
                        <tr>
                            <th style={{ width: '32px' }}></th>
                            <th>Question ID</th>
                            <th>Parameter</th>
                            <th>Archived versions</th>
                            <th>Latest archive</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>Loading…</td></tr>
                        )}
                        {!loading && filteredGroups.length === 0 && (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>No archived question yet.</td></tr>
                        )}
                        {!loading && filteredGroups.map((g) => {
                            const key = g.original_question_id;
                            const isOpen = expanded.has(key);
                            const latest = g.versions?.[0];
                            return (
                                <Fragment key={key}>
                                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpanded(key)}>
                                        <td style={{ textAlign: 'center', fontSize: '0.9rem' }}>{isOpen ? '▾' : '▸'}</td>
                                        <td style={{ fontWeight: 'bold' }}>{key}</td>
                                        <td>
                                            <code style={{ fontSize: '0.8rem' }}>{g.parameter_id}</code>
                                            <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.8rem' }}>{g.parameter_name}</span>
                                        </td>
                                        <td>
                                            <span className="badge rounded-pill bg-secondary">{g.versions.length}</span>
                                        </td>
                                        <td>
                                            <small>
                                                {latest ? new Date(latest.archived_at).toLocaleString() : '-'}
                                                {latest && <> by <em>{latest.archived_by}</em></>}
                                            </small>
                                        </td>
                                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                                            <button
                                                className="btn btn-sm"
                                                onClick={() => toggleExpanded(key)}
                                            >
                                                {isOpen ? 'Hide versions' : 'Show versions'}
                                            </button>
                                        </td>
                                    </tr>
                                    {isOpen && g.versions.map((v) => (
                                        <tr key={v.id} style={{ background: 'var(--surface-2, #f8fafc)' }}>
                                            <td></td>
                                            <td colSpan="2" style={{ fontSize: '0.85rem' }}>
                                                <div style={{ marginBottom: '0.25rem' }}>
                                                    <strong>{new Date(v.archived_at).toLocaleString()}</strong>
                                                    {' '}— by <em>{v.archived_by}</em>
                                                </div>
                                                {v.archive_note && (
                                                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                                                        Note: {v.archive_note}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: '0.78rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                                    "{v.text_preview}{v.text_preview && v.text_preview.length >= 160 ? '…' : ''}"
                                                </div>
                                            </td>
                                            <td style={{ fontSize: '0.85rem' }}>
                                                <div><strong>{v.answers_count}</strong> answers</div>
                                                <div className="muted" style={{ fontSize: '0.78rem' }}>{v.examples_count} examples</div>
                                            </td>
                                            <td></td>
                                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <Link
                                                        className="btn btn-sm btn-primary"
                                                        to={`/admin/archived-questions/${v.id}`}
                                                    >
                                                        View data
                                                    </Link>
                                                    <button
                                                        className="btn btn-sm"
                                                        onClick={() => handleDownloadXlsx(v.id)}
                                                    >
                                                        Download .xlsx
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}
                                                        onClick={() => handleDelete(v.id)}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}
