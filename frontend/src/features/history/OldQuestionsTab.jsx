import { useState, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { formatBackendDate } from '../../utils/dateFormat';
import usePersistentState from '../../utils/usePersistentState';

// Archivio delle question salvate con "Save and delete the linked data"
export default function OldQuestionsTab() {
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = usePersistentState('oldQuestions:search', '');
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
            const contentDisposition = res.headers['content-disposition'] || '';
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            const fname = filenameMatch ? filenameMatch[1] : `archived_question_${versionId}.xlsx`;
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = fname;
            document.body.appendChild(link);
            link.click();
            link.remove();
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

    const filteredGroups = groups.filter(group => {
        if (!search.trim()) return true;
        const query = search.toLowerCase();
        if ((group.original_question_id || '').toLowerCase().includes(query)) return true;
        if ((group.parameter_id || '').toLowerCase().includes(query)) return true;
        if ((group.parameter_name || '').toLowerCase().includes(query)) return true;
        return (group.versions || []).some(version =>
            (version.text_preview || '').toLowerCase().includes(query) ||
            (version.archive_note || '').toLowerCase().includes(query)
        );
    });

    return (
        <>
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}


            <div className="card" style={{ padding: 'var(--filter-card-pad, 0.75rem 1rem)', marginBottom: 'var(--form-field-mb, 1rem)' }}>
                <input
                    type="search"
                    placeholder="Search by question ID, parameter, archived text or note..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)', border: '1px solid var(--border)', borderRadius: '4px' }}
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
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>Loading…</td></tr>
                        )}
                        {!loading && filteredGroups.length === 0 && (
                            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>No archived question yet.</td></tr>
                        )}
                        {!loading && filteredGroups.map((group) => {
                            const key = group.original_question_id;
                            const isOpen = expanded.has(key);
                            const latest = group.versions?.[0];
                            return (
                                <Fragment key={key}>
                                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpanded(key)}>
                                        <td style={{ textAlign: 'center', fontSize: '0.9rem' }}>{isOpen ? '▾' : '▸'}</td>
                                        <td style={{ fontWeight: 'bold' }}>{key}</td>
                                        <td>
                                            <code style={{ fontSize: '0.8rem' }}>{group.parameter_id}</code>
                                            <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.8rem' }}>{group.parameter_name}</span>
                                        </td>
                                        <td>
                                            <span className="badge rounded-pill bg-secondary">{group.versions.length}</span>
                                        </td>
                                        <td>
                                            <small>
                                                {latest ? formatBackendDate(latest.archived_at) : '-'}
                                                {latest && <> by <em>{latest.archived_by}</em></>}
                                            </small>
                                        </td>

                                    </tr>
                                    {isOpen && group.versions.map((version) => (
                                        <tr key={version.id} style={{ background: 'var(--surface-2, #f8fafc)' }}>
                                            <td></td>
                                            <td colSpan="2" style={{ fontSize: '0.85rem' }}>
                                                <div style={{ marginBottom: '0.25rem' }}>
                                                    <strong>{formatBackendDate(version.archived_at)}</strong>
                                                    {' '}— by <em>{version.archived_by}</em>
                                                </div>
                                                {version.archive_note && (
                                                    <div className="muted" style={{ fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                                                        Note: {version.archive_note}
                                                    </div>
                                                )}
                                                <div style={{ fontSize: '0.78rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                                    "{version.text_preview}{version.text_preview && version.text_preview.length >= 160 ? '…' : ''}"
                                                </div>
                                            </td>
                                            <td style={{ fontSize: '0.85rem' }}>
                                                <div><strong>{version.answers_count}</strong> answers</div>
                                                <div className="muted" style={{ fontSize: '0.78rem' }}>{version.examples_count} examples</div>
                                            </td>
                                            <td></td>
                                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <Link
                                                        className="btn btn-sm btn-primary"
                                                        to={`/admin/archived-questions/${version.id}`}
                                                    >
                                                        View data
                                                    </Link>
                                                    <button
                                                        className="btn btn-sm"
                                                        onClick={() => handleDownloadXlsx(version.id)}
                                                    >
                                                        Download .xlsx
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        style={{ backgroundColor: '#dc3545', borderColor: '#dc3545', color: 'white' }}
                                                        onClick={() => handleDelete(version.id)}
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
