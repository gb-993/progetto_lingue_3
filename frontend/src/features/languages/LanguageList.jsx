import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';
import LanguageMap from './LanguageMap';

const STATUS_BADGE = {
    pending: { label: 'Pending', cls: '' },
    waiting_for_approval: { label: 'Waiting', cls: 'warn' },
    approved: { label: 'Approved', cls: 'ok' },
    rejected: { label: 'Rejected', cls: 'bad' },
};

function StatusBadge({ status }) {
    const meta = STATUS_BADGE[status] || STATUS_BADGE.pending;
    return (
        <span className={`status ${meta.cls}`} style={{ fontSize: '0.75rem', padding: '0.15rem 0.55rem' }}>
            {meta.label}
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
    const [downloadOpen, setDownloadOpen] = useState(false);
    const downloadRef = useRef(null);
    const mapExportRef = useRef(null);

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
                setError('Could not load the languages.');
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

    // Opzioni concatenate: subfamily ristretta dal top_family scelto,
    // group ristretto da top_family/family scelti.
    const filteredFamilyOptions = useMemo(() => {
        if (!filters.top_family) return options.opt_families;
        const set = new Set(
            languages
                .filter(l => l.top_level_family === filters.top_family)
                .map(l => l.family)
                .filter(Boolean)
        );
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [languages, options.opt_families, filters.top_family]);

    const filteredGroupOptions = useMemo(() => {
        if (!filters.top_family && !filters.family) return options.opt_groups;
        const set = new Set(
            languages
                .filter(l =>
                    (!filters.top_family || l.top_level_family === filters.top_family) &&
                    (!filters.family || l.family === filters.family)
                )
                .map(l => l.grp)
                .filter(Boolean)
        );
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [languages, options.opt_groups, filters.top_family, filters.family]);

    // Se il filtro selezionato non è più valido dopo un cambio del padre, lo azzero.
    useEffect(() => {
        if (filters.family && !filteredFamilyOptions.includes(filters.family)) {
            setFilters(prev => ({ ...prev, family: '' }));
        }
    }, [filteredFamilyOptions, filters.family]);

    useEffect(() => {
        if (filters.grp && !filteredGroupOptions.includes(filters.grp)) {
            setFilters(prev => ({ ...prev, grp: '' }));
        }
    }, [filteredGroupOptions, filters.grp]);

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
        }).sort((a, b) =>
            (a.name_full || '').localeCompare(b.name_full || '', undefined, { sensitivity: 'base' })
        );
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
            alert("Error while exporting the metadata.");
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
            alert("Error while exporting the ZIP.");
        } finally {
            setExporting(false);
        }
    };

    const onExportMap = async () => {
        if (!mapExportRef.current) {
            alert('Map is not ready yet.');
            return;
        }
        setExporting(true);
        try {
            const blob = await mapExportRef.current.exportPng();
            const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `PCM_map_${ts}.png`;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            alert('Could not export the map (rendering not complete or canvas blocked).');
        } finally {
            setExporting(false);
            setDownloadOpen(false);
        }
    };

    const onExportGcd = async () => {
        setExporting(true);
        try {
            const res = await api.post(
                '/api/admin/export/languages/gcd-txt',
                { lang_ids: targetIds },
                { responseType: 'blob' }
            );
            const skippedHeader = res.headers['x-skipped-languages'];
            if (skippedHeader) {
                const ids = skippedHeader.split(',').filter(Boolean);
                alert(
                    `Warning: ${ids.length} language(s) have no coordinates and have been excluded from the GCD matrix:\n\n` +
                    ids.join(', ')
                );
            }
            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^";]+)"?/);
            const filename = m ? m[1] : 'gcd.txt';
            const blob = new Blob([res.data], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            // Il backend può restituire un dettaglio di errore in JSON dentro il blob
            let msg = "Error while exporting the GCD distances.";
            const blob = err?.response?.data;
            if (blob instanceof Blob) {
                try {
                    const text = await blob.text();
                    const json = JSON.parse(text);
                    if (json?.detail) msg = json.detail;
                } catch { /* non-JSON, ignora */ }
            }
            alert(msg);
        } finally {
            setExporting(false);
            setDownloadOpen(false);
        }
    };

    // Chiusura dropdown al click fuori
    useEffect(() => {
        if (!downloadOpen) return;
        const onDocClick = (e) => {
            if (downloadRef.current && !downloadRef.current.contains(e.target)) {
                setDownloadOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [downloadOpen]);

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Languages</h1>
            </header>

            {/* ==== FILTRI ==== */}
            <div className="card" style={{
                padding: '1rem 1.25rem',
                marginBottom: '1rem',
                border: '1px solid var(--border)',
                position: 'sticky',
                top: '5rem',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    <FilterField label="Search">
                        <input
                            type="search"
                            placeholder="Search every field..."
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
                    <FilterField label="Subfamily">
                        <select name="family" value={filters.family} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {filteredFamilyOptions.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Group">
                        <select name="grp" value={filters.grp} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {filteredGroupOptions.map(v => <option key={v} value={v}>{v}</option>)}
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
                        {filteredLanguages.length} of {languages.length} languages
                        {activeFilterCount > 0 && <span> · {activeFilterCount} active filters</span>}
                        {selectedIds.size > 0 && <span> · <strong>{selectedIds.size} selected</strong></span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div ref={downloadRef} style={{ position: 'relative' }}>
                            <button
                                type="button"
                                onClick={() => setDownloadOpen(o => !o)}
                                disabled={exporting || targetIds.length === 0 || !isAdmin}
                                className="btn btn--small"
                                title={!isAdmin ? "Admin only" : ""}
                                aria-haspopup="menu"
                                aria-expanded={downloadOpen}
                            >
                                Download Data ▾
                            </button>
                            {downloadOpen && (
                                <div
                                    role="menu"
                                    style={{
                                        position: 'absolute',
                                        top: 'calc(100% + 4px)',
                                        right: 0,
                                        minWidth: 260,
                                        background: 'var(--surface)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm, 6px)',
                                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                                        zIndex: 50,
                                        overflow: 'hidden',
                                    }}
                                >
                                    <DropdownItem onClick={() => { setDownloadOpen(false); onExportMetadata(); }} disabled={exporting}>
                                        Export language metadata (.xlsx)
                                    </DropdownItem>
                                    <DropdownItem onClick={() => { setDownloadOpen(false); onExportZip(); }} disabled={exporting}>
                                        Export parametric data (.zip)
                                    </DropdownItem>
                                    <DropdownItem onClick={onExportMap} disabled={exporting}>
                                        Map (.png)
                                    </DropdownItem>
                                    <DropdownItem onClick={onExportGcd} disabled={exporting}>
                                        Geo distances (.txt)
                                    </DropdownItem>
                                </div>
                            )}
                        </div>
                        {isAdmin && (
                            <Link to="/admin/import-excel" className="btn btn--small">
                                Import from Excel
                            </Link>
                        )}
                        <button onClick={resetAll} className="btn btn--small">Reset</button>
                        {isAdmin && (
                            <Link to="/languages/add" className="btn btn--primary btn--small">Add Language</Link>
                        )}
                    </div>
                </div>
            </div>

            {/* ==== MAPPA ==== */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1rem' }}>
                <LanguageMap
                    ref={mapExportRef}
                    languages={filteredLanguages}
                    filters={filters}
                    allTopFamilies={options.opt_top_families}
                />
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
                            <th style={{ width: '14%' }}>Name</th>
                            <th>Status</th>
                            <th>Subfamily</th>
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
                                <td style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{lang.name_full}</td>
                                <td><StatusBadge status={lang.status} /></td>
                                <td className="muted">{lang.family || '—'}</td>
                                <td className="muted small">{lang.grp || '—'}</td>
                                <td className="small">
                                    {lang.latitude ? `${lang.latitude}, ${lang.longitude}` : 'No coords'}
                                </td>
                                <td className="row-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                                    <Link to={`/languages/${lang.id}/data`} className="btn btn--primary">Data</Link>
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
                                <td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>No language found.</td>
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

function DropdownItem({ onClick, disabled, children }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            disabled={disabled}
            style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.6rem 0.9rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                opacity: disabled ? 0.55 : 1,
            }}
            onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
            {children}
        </button>
    );
}
