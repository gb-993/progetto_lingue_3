import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../../api';
import { searchMatches } from '../../utils/search';
import usePersistentState from '../../utils/usePersistentState';
import ConfirmDialog from '../../components/ConfirmDialog';
import NoticeToast from '../../components/NoticeToast';
import { RowActionsMenu, DropdownItem, MenuSection } from '../../components/ActionsMenu';

// Stesso helper di LanguageList — forza download della blob ricevuta
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

const INITIAL_FILTERS = {
    schema: '',
    param_type: '',
    level_of_comparison: '',
    active: 'all',  // 'all' | 'yes' | 'no'
};

export default function ParameterList() {
    const [parameters, setParameters] = useState([]);
    const [search, setSearch] = usePersistentState('parameters:search', '');
    const [filters, setFilters] = usePersistentState('parameters:filters', INITIAL_FILTERS);
    const [options, setOptions] = useState({ opt_schemas: [], opt_types: [], opt_levels: [] });
    const [loading, setLoading] = useState(true);

    // --- Drag & drop reorder state ---
    const [draggingId, setDraggingId] = useState(null);
    const [dropTarget, setDropTarget] = useState(null); // { id, above: bool }
    const [savingOrder, setSavingOrder] = useState(false);

    // --- Backup state ---
    const [backingUpId, setBackingUpId] = useState(null);  // id del parametro per cui si sta facendo backup singolo
    const [globalBackup, setGlobalBackup] = useState(false);
    const [exportingInfo, setExportingInfo] = useState(false);

    // --- Selezione per l'export (modello a esclusione come LanguageList:
    //     spuntato = incluso; default tutti inclusi). ---
    const [excludedIds, setExcludedIds] = useState(new Set());

    // --- Tools ▾, dialogo di conferma e toast esiti (stessi pattern di LanguageList) ---
    const [toolsOpen, setToolsOpen] = useState(false);
    const toolsRef = useRef(null);
    const [dialog, setDialog] = useState(null);
    const [notice, setNotice] = useState(null);
    const dismissNotice = useCallback(() => setNotice(null), []);
    const notify = (type, text) => setNotice({ type, text });

    // Chiusura dropdown Tools al click fuori
    useEffect(() => {
        if (!toolsOpen) return;
        const onDocClick = (e) => {
            if (toolsRef.current && !toolsRef.current.contains(e.target)) setToolsOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [toolsOpen]);

    useEffect(() => {
        const load = async () => {
            try {
                const [paramsRes, optsRes] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/tablea/options').catch(() => ({ data: {} })),
                ]);
                const sorted = (paramsRes.data || []).slice().sort((a, b) => a.position - b.position);
                setParameters(sorted);
                setOptions({
                    opt_schemas: optsRes.data.opt_schemas || [],
                    opt_types: optsRes.data.opt_types || [],
                    opt_levels: optsRes.data.opt_levels || [],
                });
            } catch (err) {
                console.error('Errore nel recupero dei parametri', err);
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

    const filteredParams = useMemo(() => {
        return parameters.filter(p => {
            if (filters.schema && p.schema !== filters.schema) return false;
            if (filters.param_type && p.param_type !== filters.param_type) return false;
            if (filters.level_of_comparison && p.level_of_comparison !== filters.level_of_comparison) return false;
            if (filters.active === 'yes' && !p.is_active) return false;
            if (filters.active === 'no' && p.is_active) return false;
            return searchMatches(p, search, [
                'id', 'name', 'short_description', 'long_description',
                'implicational_condition', 'description_of_the_implicational_condition',
                'schema', 'param_type', 'level_of_comparison',
            ]);
        });
    }, [parameters, filters, search]);

    const activeFilterCount =
        (filters.schema ? 1 : 0) +
        (filters.param_type ? 1 : 0) +
        (filters.level_of_comparison ? 1 : 0) +
        (filters.active !== 'all' ? 1 : 0) +
        (search ? 1 : 0);

    // Reorder è abilitato solo se nessun filtro/search è attivo
    const canReorder = activeFilterCount === 0 && !savingOrder;

    // ---- Selezione per l'export "selected" (stesso schema di LanguageList) ----
    const effectiveParams = useMemo(
        () => filteredParams.filter(p => !excludedIds.has(p.id)),
        [filteredParams, excludedIds]
    );
    const targetIds = effectiveParams.map(p => p.id);
    const visibleExcludedCount = filteredParams.reduce(
        (acc, p) => acc + (excludedIds.has(p.id) ? 1 : 0), 0
    );
    const allFilteredIncluded = filteredParams.length > 0 && visibleExcludedCount === 0;

    const toggleRow = (id) => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const toggleAll = () => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            if (allFilteredIncluded) filteredParams.forEach(p => next.add(p.id));
            else filteredParams.forEach(p => next.delete(p.id));
            return next;
        });
    };

    // ---- Drag & drop handlers ----
    const handleDragStart = (e, id) => {
        e.dataTransfer.setData('application/x-parameter-row', id);
        e.dataTransfer.effectAllowed = 'move';
        // Drag image = l'intera riga, non solo l'handle
        const row = e.currentTarget.closest('tr');
        if (row) {
            try { e.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2); } catch { /* noop */ }
        }
        setDraggingId(id);
    };

    const handleDragEnd = () => {
        setDraggingId(null);
        setDropTarget(null);
    };

    const handleDragOver = (e, targetId) => {
        if (!draggingId || draggingId === targetId) return;
        const types = e.dataTransfer.types;
        if (!types || !Array.from(types).includes('application/x-parameter-row')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        setDropTarget(prev =>
            (prev && prev.id === targetId && prev.above === above) ? prev : { id: targetId, above }
        );
    };

    // ---- Export overview PDF ----
    const onExportInfoPdf = async () => {
        setExportingInfo(true);
        try {
            await downloadBlob(
                api.post(
                    '/api/admin/parameters/export/info-pdf',
                    { param_ids: targetIds },
                    { responseType: 'blob' }
                ),
                'PCM_parameters_info.pdf'
            );
        } catch {
            notify('error', 'Error while downloading the parameters info PDF.');
        } finally {
            setExportingInfo(false);
        }
    };

    // ---- Download PDF di un singolo parametro (voce del menu ⋯ di riga) ----
    const onDownloadPdf = async (param) => {
        try {
            await downloadBlob(
                api.get(`/api/admin/parameters/${param.id}/pdf`, { responseType: 'blob' }),
                `Parameter_${param.id}.pdf`
            );
        } catch {
            notify('error', 'Error while downloading the PDF.');
        }
    };

    // ---- Download Data .xlsx: matrice lingue × question del parametro,
    //      celle = frasi d'esempio (voce del menu ⋯ di riga) ----
    const onDownloadDataXlsx = async (param) => {
        try {
            await downloadBlob(
                api.get(`/api/admin/parameters/${param.id}/data-xlsx`, { responseType: 'blob' }),
                `Parameter_${param.id}_data.xlsx`
            );
        } catch {
            notify('error', 'Error while downloading the data Excel.');
        }
    };

    // ---- Backup handlers ----
    const onGlobalBackup = () => {
        setDialog({
            title: 'Full parameters backup',
            message: 'Snapshot of every parameter (definition + questions + allowed motivations). This may take a while. You will find it in History → Full backups → Parameters.',
            fields: [
                { name: 'note', label: 'Optional note', placeholder: 'Leave empty to skip', autoFocus: true },
            ],
            confirmLabel: 'Start backup',
            onConfirm: (v) => { runGlobalBackup(v.note); },
        });
    };

    const runGlobalBackup = async (note) => {
        setGlobalBackup(true);
        try {
            await api.post('/api/admin/backups/parameters/create-all', { note });
            notify('success', 'Global parameters backup completed. You can find it in History → Full backups → Parameters.');
        } catch (err) {
            console.error(err);
            notify('error', getApiErrorMessage(err, 'Error while creating the parameters backup.'));
        } finally {
            setGlobalBackup(false);
        }
    };

    const onBackupParameter = (param) => {
        setDialog({
            title: `Backup "${param.name}" (${param.id})`,
            message: 'Snapshot of this parameter (definition + questions + allowed motivations). You will find it in History → Full backups → Parameters.',
            fields: [
                { name: 'note', label: 'Optional note', placeholder: 'Leave empty to skip', autoFocus: true },
            ],
            confirmLabel: 'Create backup',
            onConfirm: (v) => { runBackupParameter(param, v.note); },
        });
    };

    const runBackupParameter = async (param, note) => {
        setBackingUpId(param.id);
        try {
            await api.post(
                `/api/admin/backups/parameters/create-one/${encodeURIComponent(param.id)}`,
                { note }
            );
            notify('success', `Backup of "${param.name}" created. You can find it in History → Full backups → Parameters.`);
        } catch (err) {
            console.error(err);
            notify('error', getApiErrorMessage(err, 'Error while creating the parameter backup.'));
        } finally {
            setBackingUpId(null);
        }
    };

    const handleDrop = async (e, targetId) => {
        e.preventDefault();
        const movedId = draggingId;
        const above = dropTarget?.above ?? false;
        // Reset visual state subito
        setDraggingId(null);
        setDropTarget(null);

        if (!movedId || movedId === targetId) return;

        const fromIdx = parameters.findIndex(p => p.id === movedId);
        const targetIdx = parameters.findIndex(p => p.id === targetId);
        if (fromIdx < 0 || targetIdx < 0) return;

        let insertAt = above ? targetIdx : targetIdx + 1;
        if (fromIdx < insertAt) insertAt -= 1;
        if (insertAt === fromIdx) return;

        const newArr = [...parameters];
        const [moved] = newArr.splice(fromIdx, 1);
        newArr.splice(insertAt, 0, moved);

        // Update ottimistico (riassegno position 1..N localmente)
        const previousArr = parameters;
        setParameters(newArr.map((p, i) => ({ ...p, position: i + 1 })));
        setSavingOrder(true);
        try {
            await api.patch('/api/admin/parameters/reorder', {
                moved_id: movedId,
                order: newArr.map(p => p.id),
            });
        } catch (err) {
            notify('error', getApiErrorMessage(err, 'Reorder failed.'));
            setParameters(previousArr); // rollback
        } finally {
            setSavingOrder(false);
        }
    };

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Parameter Management</h1>
            </header>

            {/* ==== FILTRI ==== */}
            <div className="card" style={{
                padding: 'var(--filter-card-pad, 1rem 1.25rem)',
                marginBottom: '1rem',
                border: '1px solid var(--border)',
                position: 'sticky',
                top: 'var(--topbar-height)',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 'var(--filter-card-gap, 0.75rem)', alignItems: 'end' }}>
                    <FilterField label="Search">
                        <input
                            type="search"
                            placeholder="Search every field..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Schema">
                        <select name="schema" value={filters.schema} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_schemas.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Type">
                        <select name="param_type" value={filters.param_type} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_types.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Level">
                        <select name="level_of_comparison" value={filters.level_of_comparison} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_levels.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Active">
                        <select name="active" value={filters.active} onChange={handleFilter} style={inputStyle}>
                            <option value="all">All</option>
                            <option value="yes">Only Active</option>
                            <option value="no">Only Inactive</option>
                        </select>
                    </FilterField>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--filter-card-actions-top, 0.85rem)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div className="small muted">
                        {filteredParams.length} of {parameters.length} parameters
                        {visibleExcludedCount > 0 && <span> · {targetIds.length} selected for export</span>}
                        {activeFilterCount > 0 && <span> · {activeFilterCount} active filters · reordering disabled while filtering</span>}
                        {savingOrder && <span> · saving order…</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={resetAll} className="btn btn--small">Reset</button>
                        {/* Tools ▾: export e manutenzione fuori dalla vista,
                            come in LanguageList. Add Parameter resta il
                            bottone primario. */}
                        <div ref={toolsRef} style={{ position: 'relative' }}>
                            <button
                                type="button"
                                onClick={() => setToolsOpen(o => !o)}
                                className="btn btn--small"
                                aria-haspopup="menu"
                                aria-expanded={toolsOpen}
                            >
                                Tools ▾
                            </button>
                            {toolsOpen && (
                                <div
                                    role="menu"
                                    style={{
                                        position: 'absolute',
                                        top: 'calc(100% + 4px)',
                                        right: 0,
                                        minWidth: 280,
                                        background: 'var(--surface)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-sm, 6px)',
                                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                                        zIndex: 50,
                                        overflow: 'hidden',
                                    }}
                                >
                                    <MenuSection label="Export (selected)" />
                                    <DropdownItem
                                        onClick={() => { setToolsOpen(false); onExportInfoPdf(); }}
                                        disabled={exportingInfo || targetIds.length === 0}
                                    >
                                        {exportingInfo ? 'Exporting…' : `Parameters Data (${targetIds.length})`}
                                    </DropdownItem>
                                    <MenuSection label="Maintenance" divider />
                                    <DropdownItem
                                        onClick={() => { setToolsOpen(false); onGlobalBackup(); }}
                                        disabled={globalBackup}
                                    >
                                        {globalBackup ? 'Backing up…' : 'Full parameters backup'}
                                    </DropdownItem>
                                </div>
                            )}
                        </div>
                        <Link to="/admin/parameters/add" className="btn btn--primary btn--small">Add Parameter</Link>
                    </div>
                </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th style={{ width: '56px', textAlign: 'center' }} title="Checked = included in the selected-parameters export">
                                <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                                    Incl.
                                </span>
                                <input
                                    type="checkbox"
                                    checked={allFilteredIncluded}
                                    onChange={toggleAll}
                                    title="Include / exclude all visible parameters"
                                />
                            </th>
                            {canReorder && <th style={{ width: '24px' }} aria-label="Drag handle" />}
                            <th>ID</th>
                            <th>Name</th>
                            <th>Schema</th>
                            <th>Type</th>
                            <th>Level</th>
                            <th title="Number of non-stop questions" style={{ textAlign: 'center' }}>#Q</th>
                            <th title="Number of stop questions" style={{ textAlign: 'center' }}>#QS</th>
                            <th>Status</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={canReorder ? 11 : 10} className="muted" style={{ textAlign: 'center', padding: '2rem' }}>Loading parameters…</td>
                            </tr>
                        )}
                        {!loading && filteredParams.map(param => {
                            const isDragging = param.id === draggingId;
                            const isDropAbove = dropTarget?.id === param.id && dropTarget?.above;
                            const isDropBelow = dropTarget?.id === param.id && !dropTarget?.above;
                            const rowDnDProps = canReorder ? {
                                onDragOver: (e) => handleDragOver(e, param.id),
                                onDrop: (e) => handleDrop(e, param.id),
                            } : {};
                            return (
                                <tr
                                    key={param.id}
                                    className={param.is_active ? '' : 'is-disabled'}
                                    style={{
                                        opacity: isDragging ? 0.4 : (param.is_active ? 1 : 0.55),
                                        color: param.is_active ? undefined : 'var(--text-muted)',
                                        background: param.is_active ? undefined : 'var(--surface-2)',
                                        boxShadow: isDropAbove
                                            ? 'inset 0 2px 0 var(--brand, #3b82f6)'
                                            : isDropBelow
                                                ? 'inset 0 -2px 0 var(--brand, #3b82f6)'
                                                : 'none',
                                    }}
                                    {...rowDnDProps}
                                >
                                    <td style={{ textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={!excludedIds.has(param.id)}
                                            onChange={() => toggleRow(param.id)}
                                            title="Uncheck to exclude from the selected-parameters export"
                                        />
                                    </td>
                                    {canReorder && (
                                        <td
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, param.id)}
                                            onDragEnd={handleDragEnd}
                                            title="Drag to reorder"
                                            style={{
                                                width: '24px',
                                                cursor: 'grab',
                                                textAlign: 'center',
                                                userSelect: 'none',
                                                color: 'var(--text-muted)',
                                            }}
                                        >
                                            ⋮⋮
                                        </td>
                                    )}
                                    <td style={{ fontWeight: 'bold' }}>{param.id}</td>
                                    <td>{param.name}</td>
                                    <td className="muted small">{param.schema || '—'}</td>
                                    <td>{param.param_type ? <span className="badge">{param.param_type}</span> : '—'}</td>
                                    <td className="muted small">{param.level_of_comparison || '—'}</td>
                                    <td style={{ textAlign: 'center' }}>{param.questions_count ?? 0}</td>
                                    <td style={{ textAlign: 'center' }}>{param.stop_count ?? 0}</td>
                                    <td>
                                        <span className={`status ${param.is_active ? 'ok' : 'bad'}`}>
                                            {param.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
                                        {/* Azioni quotidiane visibili (Data, Edit);
                                            PDF e Backup nel menu ⋯ come in LanguageList. */}
                                        <div className="row-actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                                            <Link
                                                to={`/admin/parameters/${param.id}/by-language`}
                                                className="btn btn--primary"
                                                title="Open this parameter across all languages (one square per language)"
                                            >
                                                Data
                                            </Link>
                                            <Link to={`/admin/parameters/${param.id}/edit`} className="btn">Edit</Link>
                                            <RowActionsMenu items={[
                                                { label: 'Download PDF', onClick: () => onDownloadPdf(param) },
                                                { label: 'Download Data (.xlsx)', onClick: () => onDownloadDataXlsx(param) },
                                                {
                                                    label: backingUpId === param.id ? 'Backing up…' : 'Backup…',
                                                    disabled: backingUpId === param.id,
                                                    onClick: () => onBackupParameter(param),
                                                },
                                            ]} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredParams.length === 0 && !loading && (
                            <tr>
                                <td colSpan={canReorder ? 11 : 10} style={{ textAlign: 'center', padding: '2rem' }}>No parameter found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ==== DIALOGO DI CONFERMA (backup note) ==== */}
            {dialog && <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />}

            {/* ==== TOAST ESITO OPERAZIONI ==== */}
            <NoticeToast notice={notice} onClose={dismissNotice} />
        </div>
    );
}

// ===== Helper UI =====
const inputStyle = { width: '100%', padding: 'var(--filter-card-input-pad, 0.45rem)', fontSize: '0.85rem' };

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
