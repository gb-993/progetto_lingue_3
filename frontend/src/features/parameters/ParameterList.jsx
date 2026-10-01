import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api, { getApiErrorMessage } from '../../api';
import { searchMatches } from '../../utils/search';
import usePersistentState from '../../utils/usePersistentState';
import { needsWorkLabels } from './needsWork';
import ConfirmDialog from '../../components/ConfirmDialog';
import NoticeToast from '../../components/NoticeToast';
import { RowActionsMenu, DropdownItem, MenuSection } from '../../components/ActionsMenu';

async function downloadBlob(request, fallbackName) {
    const res = await request;
    const contentDisposition = res.headers['content-disposition'] || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
    const filename = filenameMatch ? filenameMatch[1] : fallbackName;
    const blob = new Blob([res.data]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
}

const INITIAL_FILTERS = {
    schema: '',
    param_type: '',
    level_of_comparison: '',
    active: 'all',
    todo: 'all',
};

export default function ParameterList() {
    const [parameters, setParameters] = useState([]);
    const [search, setSearch] = usePersistentState('parameters:search', '');
    const [filters, setFilters] = usePersistentState('parameters:filters', INITIAL_FILTERS);
    const [options, setOptions] = useState({ opt_schemas: [], opt_types: [], opt_levels: [] });
    const [loading, setLoading] = useState(true);

    const [draggingId, setDraggingId] = useState(null);
    const [dropTarget, setDropTarget] = useState(null);
    const [savingOrder, setSavingOrder] = useState(false);

    const [backingUpId, setBackingUpId] = useState(null);
    const [globalBackup, setGlobalBackup] = useState(false);
    const [exportingInfo, setExportingInfo] = useState(false);

    const [excludedIds, setExcludedIds] = useState(new Set());

    const [toolsOpen, setToolsOpen] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const toolsRef = useRef(null);
    const [dialog, setDialog] = useState(null);
    const [notice, setNotice] = useState(null);
    const dismissNotice = useCallback(() => setNotice(null), []);
    const notify = (type, text) => setNotice({ type, text });

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
        return parameters.filter(param => {
            if (filters.schema && param.schema !== filters.schema) return false;
            if (filters.param_type && param.param_type !== filters.param_type) return false;
            if (filters.level_of_comparison && param.level_of_comparison !== filters.level_of_comparison) return false;
            if (filters.active === 'yes' && !param.is_active) return false;
            if (filters.active === 'no' && param.is_active) return false;
            if (filters.todo === 'yes' && !(param.needs_work || []).length) return false;
            return searchMatches(param, search, [
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
        (filters.todo === 'yes' ? 1 : 0) +
        (search ? 1 : 0);

    const canReorder = activeFilterCount === 0 && !savingOrder;

    const effectiveParams = useMemo(
        () => filteredParams.filter(param => !excludedIds.has(param.id)),
        [filteredParams, excludedIds]
    );
    const targetIds = effectiveParams.map(param => param.id);
    const visibleExcludedCount = filteredParams.reduce(
        (acc, param) => acc + (excludedIds.has(param.id) ? 1 : 0), 0
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
            if (allFilteredIncluded) filteredParams.forEach(param => next.add(param.id));
            else filteredParams.forEach(param => next.delete(param.id));
            return next;
        });
    };

    const handleDragStart = (e, id) => {
        e.dataTransfer.setData('application/x-parameter-row', id);
        e.dataTransfer.effectAllowed = 'move';
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

    const onGlobalBackup = () => {
        setDialog({
            title: 'Full parameters backup',
            message: 'Snapshot of every parameter (definition + questions + allowed motivations). This may take a while. You will find it in History → Full backups → Parameters.',
            fields: [
                { name: 'note', label: 'Optional note', placeholder: 'Leave empty to skip', autoFocus: true },
            ],
            confirmLabel: 'Start backup',
            onConfirm: (values) => { runGlobalBackup(values.note); },
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
            onConfirm: (values) => { runBackupParameter(param, values.note); },
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
        setDraggingId(null);
        setDropTarget(null);

        if (!movedId || movedId === targetId) return;

        const fromIdx = parameters.findIndex(param => param.id === movedId);
        const targetIdx = parameters.findIndex(param => param.id === targetId);
        if (fromIdx < 0 || targetIdx < 0) return;

        let insertAt = above ? targetIdx : targetIdx + 1;
        if (fromIdx < insertAt) insertAt -= 1;
        if (insertAt === fromIdx) return;

        const reordered = [...parameters];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(insertAt, 0, moved);

        const previousOrder = parameters;
        setParameters(reordered.map((param, index) => ({ ...param, position: index + 1 })));
        setSavingOrder(true);
        try {
            await api.patch('/api/admin/parameters/reorder', {
                moved_id: movedId,
                order: reordered.map(param => param.id),
            });
        } catch (err) {
            notify('error', getApiErrorMessage(err, 'Reorder failed.'));
            setParameters(previousOrder);
        } finally {
            setSavingOrder(false);
        }
    };

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Parameter Management</h1>
            </header>

            <div className={`card filter-card${filtersOpen ? '' : ' is-collapsed'}`} style={{
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
                <button
                    type="button"
                    className="filter-card-toggle"
                    onClick={() => setFiltersOpen(open => !open)}
                    aria-expanded={filtersOpen}
                >
                    <span>{filtersOpen ? '▾' : '▸'} Filters</span>
                    {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
                </button>
                <div className="filter-card-body">
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
                            {options.opt_schemas.map(schema => <option key={schema} value={schema}>{schema}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Type">
                        <select name="param_type" value={filters.param_type} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_types.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Level">
                        <select name="level_of_comparison" value={filters.level_of_comparison} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_levels.map(level => <option key={level} value={level}>{level}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Active">
                        <select name="active" value={filters.active} onChange={handleFilter} style={inputStyle}>
                            <option value="all">All</option>
                            <option value="yes">Only Active</option>
                            <option value="no">Only Inactive</option>
                        </select>
                    </FilterField>
                    <FilterField label="To do">
                        <select name="todo" value={filters.todo || 'all'} onChange={handleFilter} style={inputStyle}>
                            <option value="all">All</option>
                            <option value="yes">Needs work</option>
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
                        <div ref={toolsRef} style={{ position: 'relative' }}>
                            <button
                                type="button"
                                onClick={() => setToolsOpen(open => !open)}
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
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
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
                            <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }} title="Yellow dot = some sections still need work (hover the dot to see which)">To do</th>
                            <th className="hide-mobile">Schema</th>
                            <th className="hide-mobile">Type</th>
                            <th className="hide-mobile">Level</th>
                            <th className="hide-mobile" title="Number of non-stop questions" style={{ textAlign: 'center' }}>#Q</th>
                            <th className="hide-mobile" title="Number of stop questions" style={{ textAlign: 'center' }}>#QS</th>
                            <th className="hide-mobile">Status</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={canReorder ? 12 : 11} className="muted" style={{ textAlign: 'center', padding: '2rem' }}>Loading parameters…</td>
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
                                    <td style={{ textAlign: 'center' }}>
                                        {(param.needs_work || []).length > 0 && (
                                            <span
                                                className="todo-dot"
                                                role="img"
                                                aria-label={`Needs work: ${needsWorkLabels(param.needs_work).join(', ')}`}
                                                title={`Needs work: ${needsWorkLabels(param.needs_work).join(', ')}`}
                                            />
                                        )}
                                    </td>
                                    <td className="muted small hide-mobile">{param.schema || '—'}</td>
                                    <td className="hide-mobile">{param.param_type ? <span className="badge">{param.param_type}</span> : '—'}</td>
                                    <td className="muted small hide-mobile">{param.level_of_comparison || '—'}</td>
                                    <td className="hide-mobile" style={{ textAlign: 'center' }}>{param.questions_count ?? 0}</td>
                                    <td className="hide-mobile" style={{ textAlign: 'center' }}>{param.stop_count ?? 0}</td>
                                    <td className="hide-mobile">
                                        <span className={`status ${param.is_active ? 'ok' : 'bad'}`}>
                                            {param.is_active ? 'Active' : 'Disabled'}
                                        </span>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
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
                                <td colSpan={canReorder ? 12 : 11} style={{ textAlign: 'center', padding: '2rem' }}>No parameter found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {dialog && <ConfirmDialog config={dialog} onClose={() => setDialog(null)} />}

            <NoticeToast notice={notice} onClose={dismissNotice} />
        </div>
    );
}

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
