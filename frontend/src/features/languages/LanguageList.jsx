import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';

const STATUS_BADGE = {
    pending: { label: 'Pending', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', icon: '✏️' },
    waiting_for_approval: { label: 'Waiting', bg: '#fff8e1', color: '#92400e', border: '#fcd34d', icon: '⏳' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#15803d', border: '#86efac', icon: '✅' },
    rejected: { label: 'Rejected', bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5', icon: '⚠️' },
};

function StatusBadge({ status }) {
    const meta = STATUS_BADGE[status] || STATUS_BADGE.pending;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
            background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
            padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.75rem',
            fontWeight: 600, lineHeight: 1.6, whiteSpace: 'nowrap',
        }}>
            <span aria-hidden="true">{meta.icon}</span>{meta.label}
        </span>
    );
}

const INITIAL_FILTERS = {
    top_family: '',
    family: '',
    grp: '',
    historical: 'all',     // 'all' | 'yes' | 'no'
    status: 'all',         // 'all' | pending | waiting_for_approval | approved | rejected
};

// Download helper: forza il browser a scaricare la blob ricevuta
async function downloadBlob(request, fallbackName) {
    const res = await request;
    const cd = res.headers['content-disposition'] || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename = m ? m[1] : fallbackName;
    const blob = new Blob([res.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

export default function LanguageList() {
    const [languages, setLanguages] = useState([]);
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState(INITIAL_FILTERS);
    const [options, setOptions] = useState({ opt_top_families: [], opt_families: [], opt_groups: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [exporting, setExporting] = useState(false);

    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    useEffect(() => {
        const load = async () => {
            try {
                const [langsRes, optsRes] = await Promise.all([
                    api.get('/api/admin/languages'),
                    api.get('/api/tablea/options').catch(() => ({ data: {} })),
                ]);
                setLanguages(langsRes.data || []);
                setOptions({
                    opt_top_families: optsRes.data.opt_top_families || [],
                    opt_families: optsRes.data.opt_families || [],
                    opt_groups: optsRes.data.opt_groups || [],
                });
            } catch (err) {
                console.error('Errore nel recupero delle lingue', err);
                setError('Impossibile caricare le lingue.');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleFilter = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const resetAll = () => {
        setFilters(INITIAL_FILTERS);
        setSearch('');
    };

    const filteredLanguages = useMemo(() => {
        return languages.filter(lang => {
            if (filters.top_family && lang.top_level_family !== filters.top_family) return false;
            if (filters.family && lang.family !== filters.family) return false;
            if (filters.grp && lang.grp !== filters.grp) return false;
            if (filters.historical === 'yes' && !lang.historical_language) return false;
            if (filters.historical === 'no' && lang.historical_language) return false;
            if (filters.status !== 'all' && lang.status !== filters.status) return false;
            // ricerca testuale su tutti i campi rilevanti
            return searchMatches(lang, search, [
                'id', 'name_full', 'family', 'top_level_family', 'grp',
                'status', 'rejection_note',
            ]);
        });
    }, [languages, filters, search]);

    const activeFilterCount =
        (filters.top_family ? 1 : 0) +
        (filters.family ? 1 : 0) +
        (filters.grp ? 1 : 0) +
        (filters.historical !== 'all' ? 1 : 0) +
        (filters.status !== 'all' ? 1 : 0) +
        (search ? 1 : 0);

    // ID delle lingue su cui agiscono i bottoni di export:
    // selezionate via checkbox, oppure quelle filtrate visibili (default)
    const targetIds = selectedIds.size > 0
        ? Array.from(selectedIds)
        : filteredLanguages.map(l => l.id);

    const allFilteredSelected = filteredLanguages.length > 0 &&
        filteredLanguages.every(l => selectedIds.has(l.id));

    const toggleRow = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        if (allFilteredSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredLanguages.map(l => l.id)));
        }
    };

    const onExportSingle = async (langId) => {
        setExporting(true);
        try {
            await downloadBlob(
                api.get(`/api/export/language/${langId}/xlsx`, { responseType: 'blob' }),
                `PCM_${langId}.xlsx`
            );
        } catch {
            alert("Errore durante l'export della lingua.");
        } finally {
            setExporting(false);
        }
    };

    const onExportMetadata = async () => {
        setExporting(true);
        try {
            await downloadBlob(
                api.post('/api/admin/export/languages-list/xlsx',
                    { lang_ids: targetIds },
                    { responseType: 'blob' }
                ),
                'PCM_languages.xlsx'
            );
        } catch {
            alert("Errore durante l'export dei metadati.");
        } finally {
            setExporting(false);
        }
    };

    const onExportZip = async () => {
        setExporting(true);
        try {
            await downloadBlob(
                api.post('/api/admin/export/languages/zip',
                    { lang_ids: targetIds },
                    { responseType: 'blob' }
                ),
                'PCM_languages.zip'
            );
        } catch {
            alert("Errore durante l'export ZIP.");
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Languages</h1>
            </header>

            {/* ==== FILTRI ==== */}
            <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    <FilterField label="Search">
                        <input
                            type="search"
                            placeholder="Cerca in ogni campo..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Top Family">
                        <select name="top_family" value={filters.top_family} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_top_families.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Family">
                        <select name="family" value={filters.family} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_families.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Group">
                        <select name="grp" value={filters.grp} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_groups.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Historical">
                        <select name="historical" value={filters.historical} onChange={handleFilter} style={inputStyle}>
                            <option value="all">Both</option>
                            <option value="yes">Only Historical</option>
                            <option value="no">Only Non-Hist</option>
                        </select>
                    </FilterField>
                    <FilterField label="Status">
                        <select name="status" value={filters.status} onChange={handleFilter} style={inputStyle}>
                            <option value="all">Any status</option>
                            <option value="pending">Pending</option>
                            <option value="waiting_for_approval">Waiting</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </FilterField>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div className="small muted">
                        {filteredLanguages.length} di {languages.length} lingue
                        {activeFilterCount > 0 && <span> · {activeFilterCount} filtri attivi</span>}
                        {selectedIds.size > 0 && <span> · <strong>{selectedIds.size} selezionate</strong></span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={resetAll} className="btn btn--small">Reset</button>
                        {isAdmin && (
                            <Link to="/languages/add" className="btn btn--primary btn--small">Add Language</Link>
                        )}
                    </div>
                </div>
            </div>

            {/* ==== BARRA EXPORT / IMPORT ==== */}
            <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', border: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                <span className="small muted" style={{ marginRight: '0.5rem' }}>
                    {selectedIds.size > 0
                        ? `Azione su ${selectedIds.size} lingua/e selezionate`
                        : `Azione su ${filteredLanguages.length} lingue filtrate`}
                </span>
                <button
                    onClick={onExportMetadata}
                    disabled={exporting || targetIds.length === 0 || !isAdmin}
                    className="btn btn--small"
                    title={!isAdmin ? "Solo admin" : ""}
                >
                    📋 Export language metadata (.xlsx)
                </button>
                {isAdmin && (
                    <button
                        onClick={onExportZip}
                        disabled={exporting || targetIds.length === 0}
                        className="btn btn--small"
                    >
                        📦 Export parametric data (.zip)
                    </button>
                )}
                {isAdmin && (
                    <Link to="/admin/import-excel" className="btn btn--small">
                        ⬆️ Import from Excel
                    </Link>
                )}
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {error && <div style={{ color: 'red', padding: '1rem' }}>{error}</div>}
                <table className="table">
                    <thead>
                        <tr>
                            <th style={{ width: '40px', textAlign: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={allFilteredSelected}
                                    onChange={toggleAll}
                                    title="Select / deselect all (filtered)"
                                />
                            </th>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Family</th>
                            <th>Group</th>
                            <th>Geography</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && filteredLanguages.map(lang => (
                            <tr key={lang.id}>
                                <td style={{ textAlign: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(lang.id)}
                                        onChange={() => toggleRow(lang.id)}
                                    />
                                </td>
                                <td style={{ fontWeight: 'bold' }}>{lang.id}</td>
                                <td>{lang.name_full}</td>
                                <td><StatusBadge status={lang.status} /></td>
                                <td className="muted">{lang.family || '—'}</td>
                                <td className="muted small">{lang.grp || '—'}</td>
                                <td className="small">
                                    {lang.latitude ? `${lang.latitude}, ${lang.longitude}` : 'No coords'}
                                </td>
                                <td className="row-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                    <Link to={`/languages/${lang.id}/data`} className="btn btn--primary">Data</Link>
                                    <button
                                        onClick={() => onExportSingle(lang.id)}
                                        disabled={exporting}
                                        className="btn"
                                        title="Export this language as .xlsx"
                                    >
                                        Export
                                    </button>
                                    {isAdmin && (
                                        <>
                                            <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>
                                            <Link to={`/languages/${lang.id}/debug`} className="btn">Debug</Link>
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {filteredLanguages.length === 0 && !loading && (
                            <tr>
                                <td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>Nessuna lingua trovata.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ===== Helper UI =====
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
