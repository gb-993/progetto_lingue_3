import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import BackupsTab from './BackupsTab';
import OldQuestionsTab from './OldQuestionsTab';

// Etichette user-friendly per i tipi di entità
const ENTITY_LABELS = {
    parameter: { name: 'Parameter', color: '#3b82f6' },
    question: { name: 'Question', color: '#8b5cf6' },
    motivation: { name: 'Motivation', color: '#ec4899' },
    language: { name: 'Language', color: '#16a34a' },
    answer: { name: 'Answer', color: '#0ea5e9' },
};

const OPERATION_LABELS = {
    create: { label: 'Created', color: '#16a34a' },
    update: { label: 'Updated', color: '#3b82f6' },
    delete: { label: 'Deleted', color: '#dc2626' },
};

const SOURCE_LABELS = {
    manual: { label: 'Manual' },
    excel_import: { label: 'Excel import' },
    system: { label: 'System' },
};

const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString() : '—';
const fmtValue = (v) => {
    if (v === null || v === undefined) return <span className="muted">—</span>;
    if (v === '') return <span className="muted">(empty)</span>;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) {
        if (v.length === 0) return <span className="muted">(none)</span>;
        if (typeof v[0] === 'object' && v[0] !== null) {
            // lista di oggetti (es. examples) -> render compatto
            return (
                <ol style={{ margin: 0, paddingLeft: '1.2em' }}>
                    {v.map((item, i) => (
                        <li key={i} style={{ marginBottom: '0.35rem' }}>
                            {Object.entries(item).filter(([, val]) => val !== '' && val !== null && val !== undefined).map(([k, val]) => (
                                <div key={k}><strong>{k}:</strong> {String(val)}</div>
                            ))}
                        </li>
                    ))}
                </ol>
            );
        }
        return v.join(', ');
    }
    if (typeof v === 'object') return <pre style={{ margin: 0, fontSize: '0.78rem' }}>{JSON.stringify(v, null, 2)}</pre>;
    return String(v);
};

// ============================================================================
export default function History() {
    const [searchParams, setSearchParams] = useSearchParams();
    const initialTab = searchParams.get('tab') || 'versions';
    const [tab, setTab] = useState(initialTab);

    return (
        <div className="container" style={{ maxWidth: '1300px' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1rem' }}>
                <h1>History & Backups</h1>

            </header>

            {/* Tab nav */}
            <div style={{ display: 'flex', gap: '0.35rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                {[
                    { id: 'versions', label: 'Change history' },
                    { id: 'answers', label: 'Answer changes' },
                    { id: 'backups', label: 'Full backups (languages & parameters)' },
                    { id: 'old_questions', label: 'Old questions archive' },
                ].map(t => {
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => { setTab(t.id); setSearchParams({ tab: t.id }); }}
                            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-2)'; }}
                            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-alt)'; }}
                            style={{
                                padding: '0.65rem 1rem',
                                cursor: 'pointer',
                                background: active ? 'var(--surface)' : 'var(--surface-alt)',
                                borderTop: active ? '1px solid var(--border)' : '1px solid var(--border)',
                                borderLeft: active ? '1px solid var(--border)' : '1px solid var(--border)',
                                borderRight: active ? '1px solid var(--border)' : '1px solid var(--border)',
                                borderBottom: active ? '1px solid var(--surface)' : '1px solid var(--border)',
                                marginBottom: '-1px',
                                fontWeight: active ? 700 : 500,
                                color: active ? 'var(--text)' : 'var(--text-muted)',
                                borderRadius: '6px 6px 0 0',
                                fontSize: '0.95rem',
                                transition: 'background 0.15s ease, color 0.15s ease',
                            }}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {tab === 'versions' && <VersionsTab key="versions" excludeEntityType="answer" />}
            {tab === 'answers' && <VersionsTab key="answers" lockEntityType="answer" />}
            {tab === 'backups' && <BackupsTab />}
            {tab === 'old_questions' && <OldQuestionsTab />}
        </div>
    );
}

// ============================================================================
// TAB CRONOLOGIA MODIFICHE
// ============================================================================
// Props:
//   lockEntityType: se passato, filtra solo quel type e nasconde il dropdown
//   excludeEntityType: se passato, esclude quel type dai risultati e dal dropdown
function VersionsTab({ lockEntityType, excludeEntityType }) {
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [perPage] = useState(50);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [options, setOptions] = useState({ entity_types: [], sources: [], operations: [], users: [] });
    const [openVersion, setOpenVersion] = useState(null);

    // Filtri
    const [filters, setFilters] = useState({
        entity_type: '',
        entity_id: '',
        user_id: '',
        source: '',
        operation: '',
        since: '',
        until: '',
        search: '',
    });

    useEffect(() => {
        api.get('/api/admin/versions/options')
            .then(res => setOptions(res.data || { entity_types: [], sources: [], operations: [], users: [] }))
            .catch(() => {});
    }, []);

    const fetchVersions = async (pageNum = page) => {
        setLoading(true);
        try {
            const params = { page: pageNum, per_page: perPage };
            for (const [k, v] of Object.entries(filters)) {
                if (v !== '' && v !== null && v !== undefined) params[k] = v;
            }
            if (lockEntityType) params.entity_type = lockEntityType;
            if (excludeEntityType) params.exclude_entity_type = excludeEntityType;
            const res = await api.get('/api/admin/versions', { params });
            setItems(res.data.items || []);
            setTotal(res.data.total || 0);
            setPage(res.data.page || pageNum);
            setError('');
        } catch (err) {
            setError(err.response?.data?.detail || 'Error loading the history.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchVersions(1); /* eslint-disable-next-line */ }, [lockEntityType, excludeEntityType]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const onApply = () => fetchVersions(1);
    const onReset = () => {
        setFilters({ entity_type: '', entity_id: '', user_id: '', source: '', operation: '', since: '', until: '', search: '' });
        // refresh subito senza filtri
        setTimeout(() => fetchVersions(1), 0);
    };

    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const activeFilters = Object.values(filters).filter(v => v !== '').length;

    return (
        <div>
            {/* Pannello filtri */}
            <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    {!lockEntityType && (
                        <FilterField label="Entity type">
                            <select name="entity_type" value={filters.entity_type} onChange={handleFilterChange} style={inputStyle}>
                                <option value="">All</option>
                                {options.entity_types.filter(t => t !== excludeEntityType).map(t => (
                                    <option key={t} value={t}>{ENTITY_LABELS[t]?.name || t}</option>
                                ))}
                            </select>
                        </FilterField>
                    )}
                    <FilterField label="Entity ID">
                        <input
                            name="entity_id" value={filters.entity_id} onChange={handleFilterChange}
                            placeholder="e.g. FGM, FGM_01..."
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Operation">
                        <select name="operation" value={filters.operation} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">All</option>
                            {options.operations.map(o => (
                                <option key={o} value={o}>{OPERATION_LABELS[o]?.label || o}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="Source">
                        <select name="source" value={filters.source} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">All</option>
                            {options.sources.map(s => (
                                <option key={s} value={s}>{SOURCE_LABELS[s]?.label || s}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="User">
                        <select name="user_id" value={filters.user_id} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">All</option>
                            {options.users.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="From (day)">
                        <input type="date" name="since" value={filters.since} onChange={handleFilterChange} style={inputStyle} />
                    </FilterField>
                    <FilterField label="To (inclusive)">
                        <input type="date" name="until" value={filters.until} onChange={handleFilterChange} style={inputStyle} />
                    </FilterField>
                    <FilterField label="Text search">
                        <input
                            name="search" value={filters.search} onChange={handleFilterChange}
                            placeholder="Search ID and note..."
                            style={inputStyle}
                            onKeyDown={(e) => e.key === 'Enter' && onApply()}
                        />
                    </FilterField>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.85rem', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <div className="small muted">
                        {total} total versions{activeFilters > 0 && ` · ${activeFilters} active filters`}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={onReset} className="btn btn--small">Reset</button>
                        <button onClick={onApply} className="btn btn--primary btn--small">Apply filters</button>
                    </div>
                </div>
            </div>

            {/* Tabella */}
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table" style={{ marginBottom: 0 }}>
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>What</th>
                            <th>Op.</th>
                            <th>Source</th>
                            <th>Author</th>
                            <th>Note</th>
                            <th style={{ textAlign: 'right' }}>Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && items.map(v => {
                            const ent = ENTITY_LABELS[v.entity_type] || { name: v.entity_type, color: '#64748b' };
                            const op = OPERATION_LABELS[v.operation] || { label: v.operation, color: '#64748b' };
                            const src = SOURCE_LABELS[v.source] || { label: v.source };
                            return (
                                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setOpenVersion(v.id)}>
                                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(v.created_at)}</td>
                                    <td>
                                        <span style={{ fontSize: '0.78rem', color: ent.color, fontWeight: 700 }}>{ent.name}</span>
                                        <div style={{ fontSize: '0.85rem' }}>
                                            <strong>{v.entity_id}</strong>
                                            {v.summary_label.split(' — ')[1] && (
                                                <span className="muted small"> — {v.summary_label.split(' — ').slice(1).join(' — ')}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <span style={{ background: op.color, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700 }}>
                                            {op.label}
                                        </span>
                                    </td>
                                    <td className="small">{src.label}</td>
                                    <td className="small">{v.user?.name || '—'}</td>
                                    <td className="small" style={{ maxWidth: '300px', wordBreak: 'break-word' }}>{v.note || <span className="muted">—</span>}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button className="btn btn--small" onClick={(e) => { e.stopPropagation(); setOpenVersion(v.id); }}>
                                            Open
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {!loading && items.length === 0 && (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }} className="muted">
                                {activeFilters > 0 ? 'No version matches the filters.' : 'No version recorded.'}
                            </td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Paginazione */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                    <button className="btn btn--small" disabled={page <= 1} onClick={() => fetchVersions(page - 1)}>‹ Previous</button>
                    <span className="small muted">Page {page} of {totalPages}</span>
                    <button className="btn btn--small" disabled={page >= totalPages} onClick={() => fetchVersions(page + 1)}>Next ›</button>
                </div>
            )}

            {/* Drawer dettaglio */}
            {openVersion && (
                <VersionDetailDrawer
                    versionId={openVersion}
                    onClose={() => setOpenVersion(null)}
                />
            )}
        </div>
    );
}

// ============================================================================
function VersionDetailDrawer({ versionId, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        api.get(`/api/admin/versions/${versionId}`)
            .then(res => setData(res.data))
            .catch(err => setError(err.response?.data?.detail || 'Loading error.'))
            .finally(() => setLoading(false));
    }, [versionId]);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.4)', zIndex: 1000,
                display: 'flex', justifyContent: 'flex-end',
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '760px', maxWidth: '95vw', height: '100%',
                    background: 'var(--surface)', color: 'var(--text)',
                    overflowY: 'auto', boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
                    padding: '1.5rem',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0 }}>Version detail</h2>
                    <button onClick={onClose} className="btn btn--small">Close</button>
                </div>

                {loading && <p>Loading...</p>}
                {error && <div className="alert alert-error">{error}</div>}

                {data && <VersionDiffView data={data} onClose={onClose} />}
            </div>
        </div>
    );
}

function VersionDiffView({ data, onClose }) {
    const ent = ENTITY_LABELS[data.entity_type] || { name: data.entity_type, color: '#64748b' };
    const op = OPERATION_LABELS[data.operation] || { label: data.operation, color: '#64748b' };
    const src = SOURCE_LABELS[data.source] || { label: data.source };

    const changedFields = Object.keys(data.diff || {}).sort();
    const allFields = useMemo(() => {
        const keys = new Set([
            ...Object.keys(data.snapshot || {}),
            ...Object.keys(data.previous_snapshot || {}),
        ]);
        return Array.from(keys).sort();
    }, [data]);

    const editLink = useMemo(() => {
        switch (data.entity_type) {
            case 'parameter': return `/admin/parameters/${data.entity_id}/edit`;
            case 'question': return `/admin/questions/${data.entity_id}/edit`;
            case 'language': return `/languages/${data.entity_id}/edit`;
            case 'motivation': return `/admin/motivations`;
            case 'answer': {
                const langId = data.snapshot?.language_id;
                return langId ? `/languages/${langId}/data` : null;
            }
            default: return null;
        }
    }, [data]);

    return (
        <>
            {/* Header info */}
            <div style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)',
                padding: '0.85rem', borderRadius: '6px', marginBottom: '1rem',
            }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', color: ent.color, fontWeight: 700 }}>{ent.name.toUpperCase()}</span>
                    <strong style={{ fontSize: '1.05rem' }}>{data.entity_id}</strong>
                    <span style={{ background: op.color, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {op.label}
                    </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {fmtDateTime(data.created_at)} · {src.label}
                    {data.user && ` · ${data.user.name}`}
                </div>
                {data.note && (
                    <div className="alert alert-warning" style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', borderLeft: '3px solid var(--warn)', fontSize: '0.85rem' }}>
                        <strong>Note:</strong> {data.note}
                    </div>
                )}
                {editLink && (
                    <div style={{ marginTop: '0.6rem' }}>
                        <Link to={editLink} onClick={onClose} className="small" style={{ textDecoration: 'underline' }}>Go to the edit page</Link>
                    </div>
                )}
            </div>

            {/* Diff */}
            {changedFields.length > 0 && (
                <>
                    <h3 style={{ marginBottom: '0.5rem' }}>Modified fields ({changedFields.length})</h3>
                    <div style={{ marginBottom: '1.5rem', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <table className="table" style={{ marginBottom: 0 }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '180px' }}>Field</th>
                                    <th>Before</th>
                                    <th>Now</th>
                                </tr>
                            </thead>
                            <tbody>
                                {changedFields.map(f => (
                                    <tr key={f}>
                                        <td style={{ fontWeight: 700 }}>{f}</td>
                                        <td style={{ background: 'var(--pill-bad-bg)', whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                                            {fmtValue(data.diff[f].old)}
                                        </td>
                                        <td style={{ background: 'var(--pill-ok-bg)', whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                                            {fmtValue(data.diff[f].new)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Snapshot completo */}
            <h3 style={{ marginBottom: '0.5rem' }}>Full snapshot ({allFields.length} fields)</h3>
            <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                <table className="table" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                    <thead>
                        <tr>
                            <th>Field</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allFields.map(f => (
                            <tr key={f}>
                                <td style={{ fontWeight: 600 }}>{f}</td>
                                <td style={{ whiteSpace: 'pre-wrap' }}>{fmtValue(data.snapshot[f])}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ============================================================================
const inputStyle = { width: '100%', padding: '0.45rem', fontSize: '0.85rem' };

function FilterField({ label, children }) {
    return (
        <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {label}
            </label>
            {children}
        </div>
    );
}
