import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { getApiErrorMessage } from '../../api';
import { searchMatches } from '../../utils/search';
import usePersistentState from '../../utils/usePersistentState';
import ConfirmDialog from '../../components/ConfirmDialog';
import NoticeToast from '../../components/NoticeToast';
import { RowActionsMenu, DropdownItem, MenuSection } from '../../components/ActionsMenu';
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
    const [search, setSearch] = usePersistentState('languages:search', '');
    const [filters, setFilters] = usePersistentState('languages:filters', INITIAL_FILTERS);
    const [options, setOptions] = useState({ opt_top_families: [], opt_families: [], opt_groups: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Esclusioni manuali: lingue spuntate via checkbox per essere ESCLUSE dal set
    // effettivo (mappa, distanze, export). Default vuoto = tutte incluse.
    // Le esclusioni persistono tra cambi di filtro: lingue non più visibili
    // restano nel set ma sono inerti finché non riappaiono.
    const [excludedIds, setExcludedIds] = useState(() => new Set());
    const [exporting, setExporting] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);
    const [globalBackup, setGlobalBackup] = useState(false);
    // Mappa collassabile: chi lavora sulla tabella la chiude una volta e la
    // ritrova chiusa (sessionStorage, come i filtri).
    const [mapOpen, setMapOpen] = usePersistentState('languages:mapOpen', true);
    // Dialogo di conferma corrente (null = chiuso) e toast esito operazioni.
    const [dialog, setDialog] = useState(null);
    const [notice, setNotice] = useState(null);
    // Job di export backup (asincrono): { jobId, state, error }.
    // state è il payload restituito da /status: { phase, phase_label, current,
    // total, finished, error, ... }. Quando finished:true scatta il download.
    const [exportJob, setExportJob] = useState(null);
    const exportStartedAtRef = useRef(null);
    // Job di "Recompute final values for all languages": stesso pattern del
    // backup ma senza download — finito = success notification.
    const [recomputeJob, setRecomputeJob] = useState(null);
    const [recomputing, setRecomputing] = useState(false);
    const toolsRef = useRef(null);
    const mapExportRef = useRef(null);
    const navigate = useNavigate();

    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    // Identità stabile per il timer di auto-dismiss del NoticeToast.
    const dismissNotice = useCallback(() => setNotice(null), []);
    const notify = (type, text) => setNotice({ type, text });

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

    const onDuplicate = (lang) => {
        // Default suggerito: id/nome senza cifre finali + "2" (stessa logica
        // del fallback automatico lato server). L'admin puo' sovrascriverlo.
        const baseId = (lang.id || '').replace(/\d+$/, '') || lang.id;
        const baseName = (lang.name_full || '').replace(/\d+$/, '') || lang.name_full;

        setDialog({
            title: `Duplicate "${lang.name_full}" (${lang.id})`,
            message: 'Creates a copy of this language with all its answers, examples and parameter values.',
            fields: [
                { name: 'id', label: 'New language ID (max 10 characters)', initial: `${baseId}2`, autoFocus: true },
                { name: 'name', label: 'New language name', initial: `${baseName}2` },
            ],
            confirmLabel: 'Duplicate',
            confirmEnabled: (v) => v.id.trim().length > 0,
            // Promise: il dialogo resta aperto con "Working…" e mostra
            // eventuali errori API (es. ID già esistente) senza chiudersi.
            onConfirm: async (v) => {
                const res = await api.post(
                    `/api/admin/languages/${encodeURIComponent(lang.id)}/duplicate`,
                    { new_id: v.id.trim(), new_name: v.name.trim() || undefined }
                );
                await reloadLanguages();
                notify('success', `Created "${res.data.name_full}" (${res.data.id}).`);
            },
        });
    };

    // Eliminazione "vera" della lingua: rimuove la riga e in cascata tutti i
    // dati operativi (risposte, parametri, backup, alias). Il dizionario
    // Motivations e gli archivi storici non vengono toccati. Doppia conferma:
    // l'admin deve digitare esattamente l'id della lingua per procedere.
    const onDelete = (lang) => {
        setDialog({
            title: `Delete "${lang.name_full}" (${lang.id})`,
            danger: true,
            message: (
                <>
                    <p style={{ margin: '0 0 0.5rem' }}><strong>This will permanently delete:</strong></p>
                    <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
                        <li>All answers, examples and answer-motivation links of this language</li>
                        <li>All parameter values, evaluations and "is_unsure" / admin-note statuses</li>
                        <li>All saved backups (Submissions) of this language and their contents</li>
                        <li>All historical ID aliases of this language</li>
                    </ul>
                    <p style={{ margin: '0 0 0.5rem' }}><strong>What will NOT be deleted:</strong></p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                        <li>History audit log (a "delete" event will be added there)</li>
                        <li>Archived answers (from removed questions) referring to this id</li>
                    </ul>
                </>
            ),
            fields: [
                { name: 'confirm', label: `Type the language ID (${lang.id}) to confirm`, placeholder: lang.id, autoFocus: true },
            ],
            confirmLabel: 'Delete permanently',
            confirmEnabled: (v) => v.confirm.trim() === lang.id,
            onConfirm: async () => {
                await api.delete(`/api/admin/languages/${encodeURIComponent(lang.id)}`);
                await reloadLanguages();
                notify('success', `Language "${lang.name_full}" (${lang.id}) deleted.`);
            },
        });
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
            notify('error', 'Error while exporting the metadata.');
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
            notify('error', getApiErrorMessage(err, 'Could not start the backup.'));
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
                notify('error', getApiErrorMessage(err, 'Could not download the backup file.'));
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
    const onStartRecompute = () => {
        setDialog({
            title: 'Recompute final values',
            message: 'Re-runs the parameter DAG and consolidate step on every language. Can take some minutes on large datasets.',
            confirmLabel: 'Recompute',
            // Non-Promise: il dialogo si chiude subito, il progresso vive
            // nel toast di job già esistente.
            onConfirm: () => { startRecompute(); },
        });
    };

    const startRecompute = async () => {
        setRecomputing(true);
        setRecomputeJob(null);
        try {
            const res = await api.post('/api/admin/recompute/all');
            const jobId = res.data?.job_id;
            if (!jobId) throw new Error('Server did not return a job_id.');
            setRecomputeJob({ jobId, state: null, error: null });
        } catch (err) {
            notify('error', getApiErrorMessage(err, 'Could not start recompute.'));
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
                        // Notifica anche il successo: senza, il job spariva in
                        // silenzio e l'utente non sapeva se aveva finito.
                        if (errCount > 0) {
                            notify('error', `Recompute completed with ${errCount} error(s) over ${total} language(s). See server logs for details.`);
                        } else {
                            notify('success', `Recompute completed on ${total} language(s).`);
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
            notify('error', 'The map is not ready yet — open it and wait for it to render.');
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
            notify('error', 'Could not export the map (rendering not complete or canvas blocked).');
        } finally {
            setExporting(false);
            setToolsOpen(false);
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
                notify('warning',
                    `${ids.length} language(s) have no coordinates and have been excluded from the GCD matrix:\n` +
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
            notify('error', msg);
        } finally {
            setExporting(false);
            setToolsOpen(false);
        }
    };

    const onGlobalBackup = () => {
        setDialog({
            title: 'Full languages backup',
            message: 'Snapshot of every language (definitions + answers). This may take a while. You will find it in History → Full backups.',
            fields: [
                { name: 'note', label: 'Optional note', placeholder: 'Leave empty to skip', autoFocus: true },
            ],
            confirmLabel: 'Start backup',
            // Fire-and-forget: il dialogo si chiude subito, l'esito arriva
            // col toast (la voce nel menu Tools resta "Backing up…" intanto).
            onConfirm: (v) => { runGlobalBackup(v.note); },
        });
    };

    const runGlobalBackup = async (note) => {
        setGlobalBackup(true);
        try {
            await api.post('/api/admin/backups/create-all', { note });
            notify('success', 'Global languages backup completed. You can find it in History → Full backups.');
        } catch (err) {
            console.error(err);
            notify('error', getApiErrorMessage(err, 'Error while creating the languages backup.'));
        } finally {
            setGlobalBackup(false);
        }
    };

    // Chiusura dropdown Tools al click fuori
    useEffect(() => {
        if (!toolsOpen) return;
        const onDocClick = (e) => {
            if (toolsRef.current && !toolsRef.current.contains(e.target)) {
                setToolsOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [toolsOpen]);

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Languages</h1>
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

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--filter-card-actions-top, 0.85rem)', flexWrap: 'wrap', gap: '0.5rem' }}>
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
                        {/* Tools ▾ in tre sezioni: Download (i 4 export coi nomi
                            storici), Maintenance (recompute + backup globale),
                            Import. Fuori restano solo Reset e Add Language. */}
                        {isAdmin && (
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
                                        <MenuSection label="Download" />
                                        <DropdownItem onClick={() => { setToolsOpen(false); onExportMetadata(); }} disabled={exporting || targetIds.length === 0}>
                                            Export language metadata (.xlsx)
                                        </DropdownItem>
                                        <DropdownItem onClick={() => { setToolsOpen(false); onStartExportZip(); }} disabled={exporting || targetIds.length === 0}>
                                            Export backup (.zip)
                                        </DropdownItem>
                                        <DropdownItem onClick={onExportMap} disabled={exporting || !mapOpen}>
                                            {mapOpen ? 'Map (.png)' : 'Map (.png) — open the map first'}
                                        </DropdownItem>
                                        <DropdownItem onClick={onExportGcd} disabled={exporting || targetIds.length === 0}>
                                            Geographic distances (.txt)
                                        </DropdownItem>
                                        <MenuSection label="Maintenance" divider />
                                        <DropdownItem onClick={() => { setToolsOpen(false); onStartRecompute(); }} disabled={recomputing}>
                                            {recomputing ? 'Recomputing…' : 'Recompute final values'}
                                        </DropdownItem>
                                        <DropdownItem onClick={() => { setToolsOpen(false); onGlobalBackup(); }} disabled={globalBackup}>
                                            {globalBackup ? 'Backing up…' : 'Full Languages Backup'}
                                        </DropdownItem>
                                        <MenuSection label="Import" divider />
                                        <DropdownItem onClick={() => { setToolsOpen(false); navigate('/admin/import-excel'); }}>
                                            Import from Excel
                                        </DropdownItem>
                                    </div>
                                )}
                            </div>
                        )}
                        {isAdmin && (
                            <Link to="/languages/add" className="btn btn--primary btn--small">Add Language</Link>
                        )}
                    </div>
                </div>
            </div>

            {/* ==== MAPPA (collassabile) ====
                La mappa occupa 420px tra filtri e tabella: chi lavora sulle
                righe la chiude e la preferenza viene ricordata (sessionStorage).
                Quando è chiusa il componente è smontato (OpenLayers non rende
                bene in display:none) e l'export PNG nel menu Tools si disabilita. */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1rem' }}>
                <button
                    type="button"
                    onClick={() => setMapOpen(o => !o)}
                    aria-expanded={mapOpen}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.6rem 1rem',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text)',
                        font: 'inherit',
                    }}
                >
                    <span style={{
                        fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase',
                        letterSpacing: '0.6px', color: 'var(--text-muted)',
                    }}>
                        Map · {effectiveLanguages.length} languages
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {mapOpen ? '▾ Hide' : '▸ Show'}
                    </span>
                </button>
                {mapOpen && (
                    <LanguageMap
                        ref={mapExportRef}
                        languages={effectiveLanguages}
                        filters={filters}
                        allTopFamilies={options.opt_top_families}
                        allFamilies={options.opt_families}
                        allGroups={options.opt_groups}
                    />
                )}
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {error && <div style={{ color: 'red', padding: '1rem' }}>{error}</div>}
                <table className="table">
                    <thead>
                        <tr>
                            <th style={{ width: '56px', textAlign: 'center' }} title="Checked = included in map, distances and exports">
                                <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                                    Incl.
                                </span>
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
                        {loading && (
                            <tr>
                                <td colSpan="8" className="muted" style={{ textAlign: 'center', padding: '2rem' }}>Loading languages…</td>
                            </tr>
                        )}
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
                                    {/* Progressive disclosure: visibili solo le azioni
                                        quotidiane (Data, Edit); Duplicate/Debug/Delete
                                        nel menu ⋯ — meno rumore e niente Delete a un
                                        click di distanza su ogni riga. */}
                                    <div className="row-actions" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                                        <Link to={`/languages/${lang.id}/data`} className="btn btn--primary">Data</Link>
                                        {isAdmin && (
                                            <>
                                                <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>
                                                <RowActionsMenu items={[
                                                    { label: 'Duplicate…', onClick: () => onDuplicate(lang) },
                                                    { label: 'Debug', onClick: () => navigate(`/languages/${lang.id}/debug`) },
                                                    { label: 'Delete…', danger: true, onClick: () => onDelete(lang) },
                                                ]} />
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

            {/* ==== DIALOGO DI CONFERMA (duplicate/delete/backup/recompute) ==== */}
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
