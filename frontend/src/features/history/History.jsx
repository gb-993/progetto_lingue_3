import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import BackupsTab from './BackupsTab';

// Etichette user-friendly per i tipi di entità
const ENTITY_LABELS = {
    parameter: { name: 'Parametro', icon: '🧩', color: '#3b82f6' },
    question: { name: 'Domanda', icon: '❓', color: '#8b5cf6' },
    motivation: { name: 'Motivazione', icon: '💬', color: '#ec4899' },
    language: { name: 'Lingua', icon: '🌍', color: '#16a34a' },
};

const OPERATION_LABELS = {
    create: { label: 'Creato', color: '#16a34a' },
    update: { label: 'Modificato', color: '#3b82f6' },
    delete: { label: 'Eliminato', color: '#dc2626' },
};

const SOURCE_LABELS = {
    manual: { label: 'Manuale', icon: '✏️' },
    excel_import: { label: 'Import Excel', icon: '📥' },
    system: { label: 'Sistema', icon: '⚙️' },
};

const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString() : '—';
const fmtValue = (v) => {
    if (v === null || v === undefined) return <span className="muted">—</span>;
    if (v === '') return <span className="muted">(vuoto)</span>;
    if (typeof v === 'boolean') return v ? '✓' : '✗';
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
                <p className="muted">
                    Cronologia di tutte le modifiche e backup completi delle lingue. Ogni cosa è permanente — nulla viene mai cancellato.
                </p>
            </header>

            {/* Tab nav */}
            <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1.25rem' }}>
                {[
                    { id: 'versions', label: '📜 Cronologia modifiche' },
                    { id: 'backups', label: '💾 Backup completi (snapshot lingue)' },
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => { setTab(t.id); setSearchParams({ tab: t.id }); }}
                        style={{
                            padding: '0.65rem 1rem', border: 'none', cursor: 'pointer',
                            background: tab === t.id ? '#fff' : 'transparent',
                            borderTop: tab === t.id ? '1px solid var(--border)' : '1px solid transparent',
                            borderLeft: tab === t.id ? '1px solid var(--border)' : '1px solid transparent',
                            borderRight: tab === t.id ? '1px solid var(--border)' : '1px solid transparent',
                            borderBottom: tab === t.id ? '1px solid #fff' : '1px solid transparent',
                            marginBottom: '-1px',
                            fontWeight: tab === t.id ? 700 : 500,
                            color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
                            borderRadius: '6px 6px 0 0',
                            fontSize: '0.95rem',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'versions' && <VersionsTab />}
            {tab === 'backups' && <BackupsTab />}
        </div>
    );
}

// ============================================================================
// TAB CRONOLOGIA MODIFICHE
// ============================================================================
function VersionsTab() {
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
            const res = await api.get('/api/admin/versions', { params });
            setItems(res.data.items || []);
            setTotal(res.data.total || 0);
            setPage(res.data.page || pageNum);
            setError('');
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore caricamento cronologia.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchVersions(1); /* eslint-disable-next-line */ }, []);

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
                    <FilterField label="Tipo entità">
                        <select name="entity_type" value={filters.entity_type} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">Tutte</option>
                            {options.entity_types.map(t => (
                                <option key={t} value={t}>{ENTITY_LABELS[t]?.name || t}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="ID entità">
                        <input
                            name="entity_id" value={filters.entity_id} onChange={handleFilterChange}
                            placeholder="es. FGM, FGM_01..."
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Operazione">
                        <select name="operation" value={filters.operation} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">Tutte</option>
                            {options.operations.map(o => (
                                <option key={o} value={o}>{OPERATION_LABELS[o]?.label || o}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="Sorgente">
                        <select name="source" value={filters.source} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">Tutte</option>
                            {options.sources.map(s => (
                                <option key={s} value={s}>{SOURCE_LABELS[s]?.label || s}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="Utente">
                        <select name="user_id" value={filters.user_id} onChange={handleFilterChange} style={inputStyle}>
                            <option value="">Tutti</option>
                            {options.users.map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                        </select>
                    </FilterField>
                    <FilterField label="Da (dal giorno)">
                        <input type="date" name="since" value={filters.since} onChange={handleFilterChange} style={inputStyle} />
                    </FilterField>
                    <FilterField label="A (incluso)">
                        <input type="date" name="until" value={filters.until} onChange={handleFilterChange} style={inputStyle} />
                    </FilterField>
                    <FilterField label="Cerca testo">
                        <input
                            name="search" value={filters.search} onChange={handleFilterChange}
                            placeholder="Cerca in id e nota..."
                            style={inputStyle}
                            onKeyDown={(e) => e.key === 'Enter' && onApply()}
                        />
                    </FilterField>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.85rem', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <div className="small muted">
                        {total} versioni totali{activeFilters > 0 && ` · ${activeFilters} filtri attivi`}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={onReset} className="btn btn--small">Reset</button>
                        <button onClick={onApply} className="btn btn--primary btn--small">Applica filtri</button>
                    </div>
                </div>
            </div>

            {/* Tabella */}
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table" style={{ marginBottom: 0 }}>
                    <thead>
                        <tr>
                            <th>Quando</th>
                            <th>Cosa</th>
                            <th>Op.</th>
                            <th>Sorgente</th>
                            <th>Autore</th>
                            <th>Nota</th>
                            <th style={{ textAlign: 'right' }}>Dettaglio</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && items.map(v => {
                            const ent = ENTITY_LABELS[v.entity_type] || { name: v.entity_type, icon: '·', color: '#64748b' };
                            const op = OPERATION_LABELS[v.operation] || { label: v.operation, color: '#64748b' };
                            const src = SOURCE_LABELS[v.source] || { label: v.source, icon: '·' };
                            return (
                                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setOpenVersion(v.id)}>
                                    <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(v.created_at)}</td>
                                    <td>
                                        <span style={{ marginRight: '0.4rem' }}>{ent.icon}</span>
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
                                    <td className="small">{src.icon} {src.label}</td>
                                    <td className="small">{v.user?.name || '—'}</td>
                                    <td className="small" style={{ maxWidth: '300px', wordBreak: 'break-word' }}>{v.note || <span className="muted">—</span>}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button className="btn btn--small" onClick={(e) => { e.stopPropagation(); setOpenVersion(v.id); }}>
                                            Apri
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {!loading && items.length === 0 && (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }} className="muted">
                                {activeFilters > 0 ? 'Nessuna versione corrisponde ai filtri.' : 'Nessuna versione registrata.'}
                            </td></tr>
                        )}
                        {loading && (
                            <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>Caricamento...</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Paginazione */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                    <button className="btn btn--small" disabled={page <= 1} onClick={() => fetchVersions(page - 1)}>‹ Precedente</button>
                    <span className="small muted">Pagina {page} di {totalPages}</span>
                    <button className="btn btn--small" disabled={page >= totalPages} onClick={() => fetchVersions(page + 1)}>Successiva ›</button>
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
            .catch(err => setError(err.response?.data?.detail || 'Errore caricamento.'))
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
                    width: '760px', maxWidth: '95vw', height: '100%', background: '#fff',
                    overflowY: 'auto', boxShadow: '-4px 0 20px rgba(0,0,0,0.2)',
                    padding: '1.5rem',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0 }}>Dettaglio versione</h2>
                    <button onClick={onClose} className="btn btn--small">✕ Chiudi</button>
                </div>

                {loading && <p>Caricamento...</p>}
                {error && <div className="alert alert-error">{error}</div>}

                {data && <VersionDiffView data={data} onClose={onClose} />}
            </div>
        </div>
    );
}

function VersionDiffView({ data, onClose }) {
    const ent = ENTITY_LABELS[data.entity_type] || { name: data.entity_type, icon: '·', color: '#64748b' };
    const op = OPERATION_LABELS[data.operation] || { label: data.operation, color: '#64748b' };
    const src = SOURCE_LABELS[data.source] || { label: data.source, icon: '·' };

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
            default: return null;
        }
    }, [data]);

    return (
        <>
            {/* Header info */}
            <div style={{
                background: '#f8fafc', border: '1px solid var(--border)',
                padding: '0.85rem', borderRadius: '6px', marginBottom: '1rem',
            }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>{ent.icon}</span>
                    <span style={{ fontSize: '0.75rem', color: ent.color, fontWeight: 700 }}>{ent.name.toUpperCase()}</span>
                    <strong style={{ fontSize: '1.05rem' }}>{data.entity_id}</strong>
                    <span style={{ background: op.color, color: '#fff', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {op.label}
                    </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    {fmtDateTime(data.created_at)} · {src.icon} {src.label}
                    {data.user && ` · ${data.user.name}`}
                </div>
                {data.note && (
                    <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: '#fff7ed', borderLeft: '3px solid #f59e0b', fontSize: '0.85rem' }}>
                        <strong>Nota:</strong> {data.note}
                    </div>
                )}
                {editLink && (
                    <div style={{ marginTop: '0.6rem' }}>
                        <Link to={editLink} onClick={onClose} className="small">→ Vai alla pagina di modifica</Link>
                    </div>
                )}
            </div>

            {/* Diff */}
            {!data.previous_snapshot ? (
                <div className="alert" style={{ background: '#dcfce7', color: '#15803d', padding: '0.6rem', marginBottom: '1rem', borderRadius: '6px' }}>
                    Prima versione registrata di questa entità — nessun diff disponibile.
                </div>
            ) : changedFields.length === 0 ? (
                <p className="muted">Nessun campo modificato (versione registrata senza modifiche).</p>
            ) : (
                <>
                    <h3 style={{ marginBottom: '0.5rem' }}>Campi modificati ({changedFields.length})</h3>
                    <div style={{ marginBottom: '1.5rem', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                        <table className="table" style={{ marginBottom: 0 }}>
                            <thead>
                                <tr>
                                    <th style={{ width: '180px' }}>Campo</th>
                                    <th>Prima</th>
                                    <th>Adesso</th>
                                </tr>
                            </thead>
                            <tbody>
                                {changedFields.map(f => (
                                    <tr key={f}>
                                        <td style={{ fontWeight: 700 }}>{f}</td>
                                        <td style={{ background: '#fee2e2', whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
                                            {fmtValue(data.diff[f].old)}
                                        </td>
                                        <td style={{ background: '#dcfce7', whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>
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
            <details>
                <summary style={{ cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, padding: '0.5rem 0' }}>
                    Mostra snapshot completo ({allFields.length} campi)
                </summary>
                <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                    <table className="table" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th>Campo</th>
                                <th>Valore</th>
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
            </details>

            {/* Placeholder rollback */}
            <div style={{ marginTop: '1.5rem', padding: '0.85rem', background: '#fff7ed', border: '1px dashed #fcd34d', borderRadius: '6px' }}>
                <h4 style={{ marginTop: 0, marginBottom: '0.4rem', color: '#9a3412' }}>🚧 Rollback (in arrivo)</h4>
                <p className="small" style={{ margin: 0, color: '#7c2d12' }}>
                    La funzionalità per ripristinare questa versione sarà disponibile a breve. Per ora, puoi usare il link "Vai alla pagina di modifica" qui sopra e copiare manualmente i valori dalla colonna <em>Prima</em>.
                </p>
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
