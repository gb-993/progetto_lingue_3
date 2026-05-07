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
    top_family: [],        // multi-select: [] significa tutte
    family: [],            // multi-select: [] significa tutte
    grp: [],               // multi-select: [] significa tutti
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
    // Esclusioni manuali: lingue spuntate via checkbox per essere ESCLUSE dal set
    // effettivo (mappa, distanze, export). Default vuoto = tutte incluse.
    // Le esclusioni persistono tra cambi di filtro: lingue non più visibili
    // restano nel set ma sono inerti finché non riappaiono.
    const [excludedIds, setExcludedIds] = useState(() => new Set());
    const [exporting, setExporting] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [globalBackup, setGlobalBackup] = useState(false);
    // Job di export backup (asincrono): { jobId, state, error }.
    // state è il payload restituito da /status: { phase, phase_label, current,
    // total, finished, error, ... }. Quando finished:true scatta il download.
    const [exportJob, setExportJob] = useState(null);
    const exportStartedAtRef = useRef(null);
    // Job di "Recompute final values for all languages": stesso pattern del
    // backup ma senza download — finito = success notification.
    const [recomputeJob, setRecomputeJob] = useState(null);
    const [recomputing, setRecomputing] = useState(false);
    const downloadRef = useRef(null);
    const mapExportRef = useRef(null);

    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    const reloadLanguages = async () => {
        const res = await api.get('/api/admin/languages');
        setLanguages(res.data || []);
    };

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

    const onDuplicate = async (lang) => {
        const ok = window.confirm(
            `Duplicate "${lang.name_full}" (${lang.id}) with all answers, examples and parameters?\n\n` +
            `A new language will be created with a numeric suffix appended to id and name.`
        );
        if (!ok) return;
        try {
            const res = await api.post(`/api/admin/languages/${encodeURIComponent(lang.id)}/duplicate`);
            await reloadLanguages();
            alert(`Created "${res.data.name_full}" (${res.data.id}).`);
        } catch (err) {
            const detail = err?.response?.data?.detail || 'Could not duplicate the language.';
            alert(detail);
        }
    };

    const handleFilter = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    // Cambio multi-select con pulizia transitiva: cambiando top_family invalido
    // le subfamily/group non più appartenenti; cambiando family invalido i group.
    const handleMultiFilter = (name, value) => {
        setFilters(prev => {
            const next = { ...prev, [name]: value };
            if (name === 'top_family') {
                if (value.length > 0) {
                    const allowedFamilies = new Set(
                        languages
                            .filter(l => value.includes(l.top_level_family))
                            .map(l => l.family)
                            .filter(Boolean)
                    );
                    next.family = prev.family.filter(f => allowedFamilies.has(f));
                }
            }
            if (name === 'top_family' || name === 'family') {
                const tops = next.top_family;
                const fams = next.family;
                if (tops.length > 0 || fams.length > 0) {
                    const allowedGroups = new Set(
                        languages
                            .filter(l =>
                                (tops.length === 0 || tops.includes(l.top_level_family)) &&
                                (fams.length === 0 || fams.includes(l.family))
                            )
                            .map(l => l.grp)
                            .filter(Boolean)
                    );
                    next.grp = prev.grp.filter(g => allowedGroups.has(g));
                }
            }
            return next;
        });
    };

    const resetAll = () => {
        setFilters(INITIAL_FILTERS);
        setSearch('');
    };

    // Opzioni concatenate: subfamily ristretta dalle top_family scelte,
    // group ristretto da top_family/family scelti. Array vuoto = nessun vincolo.
    const filteredFamilyOptions = useMemo(() => {
        if (filters.top_family.length === 0) return options.opt_families;
        const set = new Set(
            languages
                .filter(l => filters.top_family.includes(l.top_level_family))
                .map(l => l.family)
                .filter(Boolean)
        );
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [languages, options.opt_families, filters.top_family]);

    const filteredGroupOptions = useMemo(() => {
        if (filters.top_family.length === 0 && filters.family.length === 0) return options.opt_groups;
        const set = new Set(
            languages
                .filter(l =>
                    (filters.top_family.length === 0 || filters.top_family.includes(l.top_level_family)) &&
                    (filters.family.length === 0 || filters.family.includes(l.family))
                )
                .map(l => l.grp)
                .filter(Boolean)
        );
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }, [languages, options.opt_groups, filters.top_family, filters.family]);

    const filteredLanguages = useMemo(() => {
        return languages.filter(lang => {
            if (filters.top_family.length > 0 && !filters.top_family.includes(lang.top_level_family)) return false;
            if (filters.family.length > 0 && !filters.family.includes(lang.family)) return false;
            if (filters.grp.length > 0 && !filters.grp.includes(lang.grp)) return false;
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
        (filters.top_family.length > 0 ? 1 : 0) +
        (filters.family.length > 0 ? 1 : 0) +
        (filters.grp.length > 0 ? 1 : 0) +
        (filters.historical !== 'all' ? 1 : 0) +
        (filters.status !== 'all' ? 1 : 0) +
        (search ? 1 : 0);

    // Set effettivo (fonte di verità unica): filtri − esclusioni manuali.
    // Usato da mappa, distanze GCD, tutti gli export, count "X of Y".
    const effectiveLanguages = useMemo(
        () => filteredLanguages.filter(l => !excludedIds.has(l.id)),
        [filteredLanguages, excludedIds]
    );
    const targetIds = effectiveLanguages.map(l => l.id);

    // Numero di lingue attualmente visibili (filtrate) che sono escluse manualmente.
    // Le esclusioni "fuori filtro" sono ignorate qui — restano nel set ma inerti.
    const visibleExcludedCount = filteredLanguages.reduce(
        (acc, l) => acc + (excludedIds.has(l.id) ? 1 : 0),
        0
    );
    const allFilteredIncluded = filteredLanguages.length > 0 && visibleExcludedCount === 0;

    // Click sulla checkbox di riga: aggiunge o rimuove la lingua dalle esclusioni.
    const toggleRow = (id) => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    // Checkbox in testa: se tutte le visibili sono incluse → escludile tutte;
    // altrimenti → includile tutte (rimuove dalle esclusioni solo le visibili,
    // lasciando intatte le esclusioni "fuori filtro").
    const toggleAll = () => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            if (allFilteredIncluded) {
                filteredLanguages.forEach(l => next.add(l.id));
            } else {
                filteredLanguages.forEach(l => next.delete(l.id));
            }
            return next;
        });
    };

    // Reset rapido: rimuove tutte le esclusioni (anche quelle fuori filtro).
    const clearExclusions = () => setExcludedIds(new Set());

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

    // Backup zip async: POST → {job_id} → poll status → GET download quando finished.
    // La barra di progresso appare in basso a destra finché il job è attivo.
    const onStartExportZip = async () => {
        setExporting(true);
        setExportJob(null);
        exportStartedAtRef.current = Date.now();
        try {
            const res = await api.post(
                '/api/admin/export/languages/zip',
                { lang_ids: targetIds }
            );
            const jobId = res.data?.job_id;
            if (!jobId) throw new Error('Server did not return a job_id.');
            setExportJob({ jobId, state: null, error: null });
        } catch (err) {
            alert(err.response?.data?.detail || err.message || 'Could not start the backup.');
            setExporting(false);
        }
    };

    const onCancelExport = () => {
        // Nessun cancel server-side: smettiamo solo il polling/UI. Il job
        // continua in background ma il file verrà purgato dal TTL (1h).
        setExporting(false);
        setExportJob(null);
    };

    // Polling stato + auto-download a fine job.
    useEffect(() => {
        if (!exportJob?.jobId) return;
        const jobId = exportJob.jobId;
        let cancelled = false;
        let intervalId;

        const stopPolling = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const downloadFile = async () => {
            try {
                const res = await api.get(
                    `/api/admin/export/languages/zip/download/${jobId}`,
                    { responseType: 'blob' }
                );
                const cd = res.headers['content-disposition'] || '';
                const m = cd.match(/filename="?([^";]+)"?/);
                const filename = m ? m[1] : 'PCM_backup.zip';
                const blob = new Blob([res.data]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert(err.response?.data?.detail || 'Could not download the backup file.');
            }
        };

        const poll = async () => {
            try {
                const res = await api.get(`/api/admin/export/languages/zip/status/${jobId}`);
                if (cancelled) return;
                setExportJob(prev => prev?.jobId === jobId ? { ...prev, state: res.data } : prev);
                if (res.data.finished) {
                    stopPolling();
                    if (res.data.error) {
                        setExportJob(prev => prev?.jobId === jobId ? { ...prev, error: res.data.error } : prev);
                        setExporting(false);
                    } else {
                        await downloadFile();
                        if (!cancelled) {
                            setExporting(false);
                            setExportJob(null);
                        }
                    }
                }
            } catch (err) {
                if (cancelled) return;
                stopPolling();
                const msg = err.response?.data?.detail || 'Error polling export job.';
                setExportJob(prev => prev?.jobId === jobId ? { ...prev, error: msg } : prev);
                setExporting(false);
            }
        };

        poll();
        intervalId = setInterval(poll, 1500);

        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [exportJob?.jobId]);

    // Recompute final values per TUTTE le lingue. Stessa meccanica del job
    // di backup (POST start → polling status → done) ma senza download.
    const onStartRecompute = async () => {
        const ok = window.confirm(
            'Recompute the final values for ALL languages?\n\n' +
            'This re-runs the parameter DAG and consolidate step on every language. ' +
            'Can take some minutes on large datasets.'
        );
        if (!ok) return;
        setRecomputing(true);
        setRecomputeJob(null);
        try {
            const res = await api.post('/api/admin/recompute/all');
            const jobId = res.data?.job_id;
            if (!jobId) throw new Error('Server did not return a job_id.');
            setRecomputeJob({ jobId, state: null, error: null });
        } catch (err) {
            alert(err.response?.data?.detail || err.message || 'Could not start recompute.');
            setRecomputing(false);
        }
    };

    const onCancelRecompute = () => {
        // Nessun cancel server-side: chiudiamo solo il toast, il job
        // continua e termina da solo (TTL 1h).
        setRecomputing(false);
        setRecomputeJob(null);
    };

    useEffect(() => {
        if (!recomputeJob?.jobId) return;
        const jobId = recomputeJob.jobId;
        let cancelled = false;
        let intervalId;

        const stopPolling = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const poll = async () => {
            try {
                const res = await api.get(`/api/admin/recompute/status/${jobId}`);
                if (cancelled) return;
                setRecomputeJob(prev => prev?.jobId === jobId ? { ...prev, state: res.data } : prev);
                if (res.data.finished) {
                    stopPolling();
                    if (res.data.error) {
                        setRecomputeJob(prev => prev?.jobId === jobId ? { ...prev, error: res.data.error } : prev);
                    } else {
                        const errCount = res.data.report?.errors_count || 0;
                        const total = res.data.report?.languages_processed || 0;
                        if (errCount > 0) {
                            alert(`Recompute completed with ${errCount} error(s) over ${total} language(s). See server logs for details.`);
                        }
                        setRecomputeJob(null);
                    }
                    setRecomputing(false);
                }
            } catch (err) {
                if (cancelled) return;
                stopPolling();
                const msg = err.response?.data?.detail || 'Error polling recompute job.';
                setRecomputeJob(prev => prev?.jobId === jobId ? { ...prev, error: msg } : prev);
                setRecomputing(false);
            }
        };

        poll();
        intervalId = setInterval(poll, 1500);

        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [recomputeJob?.jobId]);

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

    const onGlobalBackup = async () => {
        const note = window.prompt(
            'Optional note for the global languages backup (leave empty to skip):',
            ''
        );
        if (note === null) return;
        if (!window.confirm('Start a global backup of every language? This may take a while.')) return;
        setGlobalBackup(true);
        try {
            await api.post('/api/admin/backups/create-all', { note });
            alert('Global languages backup completed. You can find it in History → Full backups.');
        } catch (err) {
            console.error(err);
            alert(err?.response?.data?.detail || 'Error while creating the languages backup.');
        } finally {
            setGlobalBackup(false);
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
                top: 'var(--topbar-height)',
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
                        <MultiSelect
                            value={filters.top_family}
                            options={options.opt_top_families}
                            onChange={(v) => handleMultiFilter('top_family', v)}
                            placeholder="All"
                        />
                    </FilterField>
                    <FilterField label="Subfamily">
                        <MultiSelect
                            value={filters.family}
                            options={filteredFamilyOptions}
                            onChange={(v) => handleMultiFilter('family', v)}
                            placeholder="All"
                        />
                    </FilterField>
                    <FilterField label="Group">
                        <MultiSelect
                            value={filters.grp}
                            options={filteredGroupOptions}
                            onChange={(v) => handleMultiFilter('grp', v)}
                            placeholder="All"
                        />
                    </FilterField>
                    <FilterField label="Historical">
                        <select name="historical" value={filters.historical} onChange={handleFilter} style={inputStyle}>
                            <option value="all">Both</option>
                            <option value="yes">Only Historical</option>
                            <option value="no">Only Non-Historical</option>
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
                        {effectiveLanguages.length} of {languages.length} languages
                        {activeFilterCount > 0 && <span> · {activeFilterCount} active filters</span>}
                        {visibleExcludedCount > 0 && (
                            <span> · <strong>{visibleExcludedCount} excluded</strong></span>
                        )}
                        {excludedIds.size > visibleExcludedCount && (
                            <span> · {excludedIds.size - visibleExcludedCount} hidden excluded</span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {excludedIds.size > 0 && (
                            <button
                                onClick={clearExclusions}
                                className="btn btn--small"
                                title="Re-include every excluded language (also those outside the current filter)"
                            >
                                Clear exclusions
                            </button>
                        )}
                        <button onClick={resetAll} className="btn btn--small">Reset</button>
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
                                    <DropdownItem onClick={() => { setDownloadOpen(false); onStartExportZip(); }} disabled={exporting}>
                                        Export backup (.zip)
                                    </DropdownItem>
                                    <DropdownItem onClick={onExportMap} disabled={exporting}>
                                        Map (.png)
                                    </DropdownItem>
                                    <DropdownItem onClick={onExportGcd} disabled={exporting}>
                                        Geographic distances (.txt)
                                    </DropdownItem>
                                </div>
                            )}
                        </div>
                        {isAdmin && (
                            <button
                                type="button"
                                onClick={onGlobalBackup}
                                disabled={globalBackup}
                                className="btn btn--small"
                                title="Snapshot every language (definitions + answers)"
                            >
                                {globalBackup ? 'Backing up…' : '+ Full Languages Backup'}
                            </button>
                        )}
                        {isAdmin && (
                            <button
                                type="button"
                                onClick={onStartRecompute}
                                disabled={recomputing}
                                className="btn btn--small"
                                title="Re-run the parameter DAG on every language"
                            >
                                {recomputing ? 'Recomputing…' : 'Recompute final values'}
                            </button>
                        )}
                        {isAdmin && (
                            <Link to="/admin/import-excel" className="btn btn--small">
                                Import from Excel
                            </Link>
                        )}
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
                    languages={effectiveLanguages}
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
                                    checked={allFilteredIncluded}
                                    onChange={toggleAll}
                                    title="Include / exclude all visible languages"
                                />
                            </th>
                            <th>ID</th>
                            <th style={{ width: '14%' }}>Name</th>
                            <th>Status</th>
                            <th>Top family</th>
                            <th>Subfamily</th>
                            <th>Group</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && filteredLanguages.map(lang => (
                            <tr key={lang.id}>
                                <td style={{ textAlign: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={!excludedIds.has(lang.id)}
                                        onChange={() => toggleRow(lang.id)}
                                        title="Uncheck to exclude from map, distances and exports"
                                    />
                                </td>
                                <td style={{ fontWeight: 'bold' }}>{lang.id}</td>
                                <td style={{ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{lang.name_full}</td>
                                <td><StatusBadge status={lang.status} /></td>
                                <td className="muted">{lang.top_level_family || '—'}</td>
                                <td className="muted">{lang.family || '—'}</td>
                                <td className="muted small">{lang.grp || '—'}</td>
                                <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
                                    <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
                                        <Link to={`/languages/${lang.id}/data`} className="btn btn--primary">Data</Link>
                                        {isAdmin && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn"
                                                    onClick={() => onDuplicate(lang)}
                                                    title="Duplicate this language with all its answers, examples and parameters"
>
                                                    Duplicate
                                                </button>
                                                <Link to={`/languages/${lang.id}/debug`} className="btn">Debug</Link>
                                                                                                <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>

                                            </>
                                        )}
                                    </div>
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

            {/* ==== TOAST PROGRESSO BACKUP ==== */}
            {(exporting || exportJob) && (
                <ExportProgressToast
                    job={exportJob}
                    starting={exporting && !exportJob}
                    onClose={onCancelExport}
                />
            )}

            {/* ==== TOAST PROGRESSO RECOMPUTE ==== */}
            {(recomputing || recomputeJob) && (
                <ProgressToast
                    job={recomputeJob}
                    starting={recomputing && !recomputeJob}
                    onClose={onCancelRecompute}
                    titleBuilding="Recomputing final values…"
                    titleDone="Recompute complete"
                    titleErrored="Recompute failed"
                    bottom="5rem"
                />
            )}
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

function MultiSelect({ value, options, onChange, placeholder = 'All' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    const toggle = (opt) => {
        if (value.includes(opt)) onChange(value.filter(v => v !== opt));
        else onChange([...value, opt]);
    };

    const clear = (e) => {
        e.stopPropagation();
        onChange([]);
    };

    const label = value.length === 0
        ? placeholder
        : value.length <= 2
            ? value.join(', ')
            : `${value.slice(0, 2).join(', ')} +${value.length - 2}`;

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    ...inputStyle,
                    textAlign: 'left',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.35rem',
                    color: value.length === 0 ? 'var(--text-muted)' : 'var(--text)',
                    overflow: 'hidden',
                }}
                aria-haspopup="listbox"
                aria-expanded={open}
                title={value.length > 0 ? value.join(', ') : ''}
            >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {label}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                    {value.length > 0 && (
                        <span
                            onClick={clear}
                            role="button"
                            aria-label="Clear"
                            title="Clear"
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: 'var(--surface-2)',
                                color: 'var(--text-muted)',
                                fontSize: '0.7rem',
                                lineHeight: 1,
                                cursor: 'pointer',
                            }}
                        >
                            ×
                        </span>
                    )}
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>▾</span>
                </span>
            </button>
            {open && (
                <div
                    role="listbox"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        left: 0,
                        right: 0,
                        minWidth: '100%',
                        maxHeight: 280,
                        overflowY: 'auto',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                        zIndex: 60,
                    }}
                >
                    {options.length === 0 ? (
                        <div style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            No options
                        </div>
                    ) : options.map(opt => {
                        const checked = value.includes(opt);
                        return (
                            <label
                                key={opt}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.45rem 0.75rem',
                                    fontSize: '0.82rem',
                                    cursor: 'pointer',
                                    background: checked ? 'var(--surface-2)' : 'transparent',
                                }}
                                onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'var(--surface-2)'; }}
                                onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(opt)}
                                    style={{ flexShrink: 0 }}
                                />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {opt}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
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

// Toast fisso in basso a destra per l'avanzamento di un job backend basato su
// migration_progress (POST → polling /status → done). Titoli e posizione
// verticale configurabili così istanze multiple non si sovrappongono.
function ProgressToast({
    job, starting, onClose,
    titleBuilding = 'Working…',
    titleDone = 'Done',
    titleErrored = 'Failed',
    bottom = '1rem',
}) {
    const state = job?.state;
    const finished = !!state?.finished;
    const errored = !!(job?.error || state?.error);
    const current = state?.current || 0;
    const total = state?.total || 0;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const phaseLabel = state?.phase_label || (starting ? 'Starting…' : 'Queued, waiting for backend…');

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: 'fixed',
                right: '1rem',
                bottom,
                width: 'min(380px, calc(100vw - 2rem))',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
                padding: '0.9rem 1rem',
                zIndex: 100,
            }}
        >
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: '0.5rem',
                gap: '0.5rem',
            }}>
                <strong style={{ fontSize: '0.9rem' }}>
                    {errored ? titleErrored : finished ? titleDone : titleBuilding}
                </strong>
                <button
                    type="button"
                    onClick={onClose}
                    title={errored || finished ? 'Close' : 'Hide (job continues in background)'}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        lineHeight: 1,
                    }}
                >
                    ×
                </button>
            </div>

            {!errored && (
                <>
                    <div style={{
                        position: 'relative',
                        width: '100%',
                        height: '14px',
                        background: 'var(--surface-2)',
                        borderRadius: '7px',
                        overflow: 'hidden',
                        border: '1px solid var(--border)',
                        marginBottom: '0.5rem',
                    }}>
                        <div style={{
                            width: `${percent}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--brand, #3b82f6), #6366f1)',
                            transition: 'width 0.4s ease',
                        }} />
                    </div>
                    <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {phaseLabel}
                        </span>
                        {total > 0 && <span>{current} / {total}</span>}
                    </div>
                </>
            )}

            {errored && (
                <div className="small" style={{ color: '#b91c1c' }}>
                    {job?.error || state?.error}
                </div>
            )}
        </div>
    );
}

// Wrapper specifico per il toast del backup: stesso UI di ProgressToast con
// preset di etichette. Tenuto come componente separato così il call-site
// rimane terso ("<ExportProgressToast .../>") senza props ridondanti.
function ExportProgressToast(props) {
    return (
        <ProgressToast
            {...props}
            titleBuilding="Building backup…"
            titleDone="Backup ready"
            titleErrored="Backup failed"
        />
    );
}
