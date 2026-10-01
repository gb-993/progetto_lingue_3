import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import api from '../../api';
import { searchMatches } from '../../utils/search';
import reactSelectStyles from '../../utils/reactSelectStyles';
import usePersistentState from '../../utils/usePersistentState';
import SegmentedToggle from '../../components/SegmentedToggle';

const multiSelectStyles = {
    ...reactSelectStyles,
    multiValue: (base) => ({ ...base, background: 'var(--surface-2)', border: '1px solid var(--border)' }),
    multiValueLabel: (base) => ({ ...base, color: 'var(--text)' }),
    multiValueRemove: (base) => ({ ...base, color: 'var(--text-muted)', ':hover': { background: 'var(--bad, #dc2626)', color: '#fff' } }),
};
const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' };

// export che il backend esegue uno alla volta (routers/tablea.py)
const HEAVY_EXPORT_NAMES = { dendrograms: 'dendrograms', pca: 'PCA scatterplot' };
const HEAVY_EXPORT_HINT = 'This may take several seconds, or up to a minute longer if another heavy export is already running.';

// con responseType 'blob' anche l'errore arriva come Blob: ne legge il detail
async function readBlobError(err, fallback) {
    const blob = err?.response?.data;
    if (blob instanceof Blob) {
        try {
            const json = JSON.parse(await blob.text());
            if (json?.detail) return json.detail;
        } catch { /* non-JSON */ }
    }
    return fallback;
}
const sectionTitleStyle = { fontSize: '0.8rem', fontWeight: 900, color: 'var(--text)', textTransform: 'uppercase', marginBottom: 'var(--form-field-mb, 1rem)', borderBottom: '1px solid var(--border)', display: 'block', paddingBottom: '0.25rem' };
const toSelectOptions = (values) => (values || []).map(value => ({ value, label: value }));

// risposte su parametri azzerati
const EMPTY_ORPHANS = { count: 0, languages: [], parameters: [] };

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export default function TableA() {
    const [view, setView] = usePersistentState('tablea:view', 'params');

    const [search, setSearch] = usePersistentState('tablea:search', '');

    const [options, setOptions] = useState({
        opt_top_families: [], opt_families: [], opt_groups: [],
        opt_schemas: [], opt_types: [], opt_levels: [], opt_templates: [],
        opt_all_languages: []
    });

    const [filters, setFilters] = usePersistentState('tablea:itemFilters', {
        f_p_schema: '', f_p_type: '', f_p_level: '',
        f_q_template: '', f_q_stop: 'all'
    });

    // lingue scelte = filtri − escluse + aggiunte
    const [langFilters, setLangFilters] = usePersistentState('tablea:langFilters', {
        top_family: [], family: [], grp: [], historical: 'all',
    });
    const [excludedLangs, setExcludedLangs] = usePersistentState('tablea:excludedLangs', []);
    const [addedLangs, setAddedLangs] = usePersistentState('tablea:addedLangs', []);
    const [langPickFilter, setLangPickFilter] = useState('');

    const [selectedRows, setSelectedRows] = useState([]);

    const [matrixData, setMatrixData] = useState({ languages: [], rows: [], orphan_answers: EMPTY_ORPHANS });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [downloadOpen, setDownloadOpen] = useState(false);
    const downloadRef = useRef(null);
    const [mantelOpen, setMantelOpen] = useState(false);
    const [mantelOpts, setMantelOpts] = useState({ gcd: true, hamming: true, jaccard: true });
    const [mantelRunning, setMantelRunning] = useState(false);
    const [clusterMapOpen, setClusterMapOpen] = useState(false);
    const [clusterMapOpts, setClusterMapOpts] = useState({ distance: 'hamming', threshold_coeff: 0.56 });
    const [clusterMapRunning, setClusterMapRunning] = useState(false);
    const [heavyExportName, setHeavyExportName] = useState(null);

    const allLangs = useMemo(() => options.opt_all_languages || [], [options.opt_all_languages]);

    const baseLangs = useMemo(() => allLangs.filter(lang => {
        if (langFilters.top_family.length && !langFilters.top_family.includes(lang.top_family)) return false;
        if (langFilters.family.length && !langFilters.family.includes(lang.family)) return false;
        if (langFilters.grp.length && !langFilters.grp.includes(lang.grp)) return false;
        if (langFilters.historical === 'yes' && !lang.historical) return false;
        if (langFilters.historical === 'no' && lang.historical) return false;
        return true;
    }), [allLangs, langFilters]);

    const baseIdSet = useMemo(() => new Set(baseLangs.map(lang => lang.id)), [baseLangs]);
    const excludedSet = useMemo(() => new Set(excludedLangs), [excludedLangs]);

    const candidateLangs = useMemo(() => {
        const langsById = new Map();
        baseLangs.forEach(lang => langsById.set(lang.id, lang));
        addedLangs.forEach(id => {
            if (!langsById.has(id)) {
                const lang = allLangs.find(candidate => candidate.id === id);
                if (lang) langsById.set(id, lang);
            }
        });
        return [...langsById.values()].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    }, [baseLangs, addedLangs, allLangs]);

    const resolvedLangIds = useMemo(
        () => candidateLangs.filter(lang => !excludedSet.has(lang.id)).map(lang => lang.id),
        [candidateLangs, excludedSet]
    );

    const hasLangIntent =
        langFilters.top_family.length > 0 || langFilters.family.length > 0 ||
        langFilters.grp.length > 0 || langFilters.historical !== 'all' ||
        excludedLangs.length > 0 || addedLangs.length > 0;

    // [] per il backend = tutte le lingue
    const langSelectionEmpty = hasLangIntent && resolvedLangIds.length === 0;

    const langPayloadIds = useMemo(
        () => (resolvedLangIds.length === allLangs.length ? [] : resolvedLangIds),
        [resolvedLangIds, allLangs]
    );

    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const res = await api.get('/api/tablea/options');
                setOptions(res.data);
            } catch (err) {
                console.error("Errore caricamento opzioni", err);
            }
        };
        fetchOptions();
    }, []);

    const fetchMatrix = async () => {
        setLoading(true);
        setError('');
        try {
            if (langSelectionEmpty) {
                setMatrixData({ languages: [], rows: [], orphan_answers: EMPTY_ORPHANS });
                return;
            }
            const payload = {
                view,
                ...filters,
                f_lang_specific: langPayloadIds,
                selected_ids: selectedRows
            };
            const res = await api.post('/api/tablea/matrix', payload);
            setMatrixData(res.data);
        } catch (err) {
            console.error("Errore caricamento matrice", err);
            setError("Error while computing the table.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setSelectedRows([]);
        setSearch('');
        fetchMatrix();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const filteredRows = useMemo(
        () => matrixData.rows.filter(row => searchMatches(row.item, search)),
        [matrixData.rows, search]
    );

    // [] = esporta tutto
    const exportIds = useMemo(() => {
        const visibleSet = new Set(filteredRows.map(row => row.item.id));
        if (selectedRows.length > 0) {
            return selectedRows.filter(id => visibleSet.has(id));
        }
        return search.trim() ? Array.from(visibleSet) : [];
    }, [selectedRows, filteredRows, search]);

    const hasFilterIntent = selectedRows.length > 0 || search.trim() !== '';
    const wouldExportNothing = (hasFilterIntent && exportIds.length === 0) || langSelectionEmpty;

    const familyOpts = useMemo(() => {
        if (!langFilters.top_family.length) return options.opt_families || [];
        const families = new Set(allLangs
            .filter(lang => langFilters.top_family.includes(lang.top_family))
            .map(lang => lang.family).filter(Boolean));
        return [...families].sort();
    }, [allLangs, options.opt_families, langFilters.top_family]);

    const groupOpts = useMemo(() => {
        if (!langFilters.top_family.length && !langFilters.family.length) return options.opt_groups || [];
        const groups = new Set(allLangs
            .filter(lang =>
                (!langFilters.top_family.length || langFilters.top_family.includes(lang.top_family)) &&
                (!langFilters.family.length || langFilters.family.includes(lang.family)))
            .map(lang => lang.grp).filter(Boolean));
        return [...groups].sort();
    }, [allLangs, options.opt_groups, langFilters.top_family, langFilters.family]);

    const addLangOptions = useMemo(
        () => allLangs.filter(lang => !baseIdSet.has(lang.id))
            .map(lang => ({ value: lang.id, label: `${lang.name} (${lang.id})` })),
        [allLangs, baseIdSet]
    );
    const addLangValue = useMemo(
        () => addLangOptions.filter(option => addedLangs.includes(option.value)),
        [addLangOptions, addedLangs]
    );

    const handleLangFamilyChange = (name, values) => {
        setLangFilters(prev => {
            const next = { ...prev, [name]: values };
            if (name === 'top_family') {
                const allowedFamilies = new Set(allLangs
                    .filter(lang => values.length === 0 || values.includes(lang.top_family))
                    .map(lang => lang.family).filter(Boolean));
                next.family = prev.family.filter(family => allowedFamilies.has(family));
            }
            if (name === 'top_family' || name === 'family') {
                const topFamilies = next.top_family, families = next.family;
                const allowedGroups = new Set(allLangs
                    .filter(lang =>
                        (topFamilies.length === 0 || topFamilies.includes(lang.top_family)) &&
                        (families.length === 0 || families.includes(lang.family)))
                    .map(lang => lang.grp).filter(Boolean));
                next.grp = prev.grp.filter(group => allowedGroups.has(group));
            }
            return next;
        });
    };

    const toggleLangIncluded = (id) => {
        if (excludedSet.has(id)) {
            setExcludedLangs(prev => prev.filter(langId => langId !== id));
            return;
        }
        if (baseIdSet.has(id)) {
            setExcludedLangs(prev => [...prev, id]);
        } else {
            setAddedLangs(prev => prev.filter(langId => langId !== id));
        }
    };

    const visibleCandidateLangs = useMemo(() => {
        const query = langPickFilter.trim().toLowerCase();
        if (!query) return candidateLangs;
        return candidateLangs.filter(lang =>
            (lang.id || '').toLowerCase().includes(query) || (lang.name || '').toLowerCase().includes(query));
    }, [candidateLangs, langPickFilter]);

    const handleRowCheckbox = (id) => {
        setSelectedRows(prev =>
            prev.includes(id) ? prev.filter(rowId => rowId !== id) : [...prev, id]
        );
    };

    const handleMasterCheckbox = (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            setSelectedRows(filteredRows.map(row => row.item.id));
        } else {
            setSelectedRows([]);
        }
    };

    const resetFilters = () => {
        setFilters({
            f_p_schema: '', f_p_type: '', f_p_level: '',
            f_q_template: '', f_q_stop: 'all'
        });
        setLangFilters({ top_family: [], family: [], grp: [], historical: 'all' });
        setExcludedLangs([]);
        setAddedLangs([]);
        setLangPickFilter('');
        setSelectedRows([]);
        setSearch('');
    };

    const handleDownload = async (endpoint, filename, mimeType) => {
        if (langSelectionEmpty) { alert('No language selected. Adjust the language selection first.'); return; }
        if (HEAVY_EXPORT_NAMES[endpoint]) setHeavyExportName(HEAVY_EXPORT_NAMES[endpoint]);
        try {
            const payload = { view, ...filters, f_lang_specific: langPayloadIds, selected_ids: exportIds };
            const response = await api.post(`/api/tablea/export/${endpoint}`, payload, { responseType: 'blob' });

            const skippedHeader = response.headers['x-skipped-languages'];
            if (skippedHeader) {
                const ids = skippedHeader.split(',').filter(Boolean);
                alert(
                    `Warning: ${ids.length} language(s) without coordinates have been excluded:\n\n`
                    + ids.join(', ')
                );
            }

            const url = window.URL.createObjectURL(new Blob([response.data], { type: mimeType }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (err) {
            console.error(`Errore export ${endpoint}`, err);
            alert(await readBlobError(err, "Error while generating the file. Check the applied filters."));
        } finally {
            setHeavyExportName(null);
        }
    };

    const runMantel = async () => {
        const selectedCount = Number(mantelOpts.gcd) + Number(mantelOpts.hamming) + Number(mantelOpts.jaccard);
        if (selectedCount < 2) {
            alert("Select at least 2 distances for the Mantel test.");
            return;
        }
        if (langSelectionEmpty) { alert('No language selected. Adjust the language selection first.'); return; }
        setMantelRunning(true);
        try {
            const payload = {
                view, ...filters,
                f_lang_specific: langPayloadIds,
                selected_ids: exportIds,
                include_gcd: mantelOpts.gcd,
                include_hamming: mantelOpts.hamming,
                include_jaccard: mantelOpts.jaccard,
            };
            const res = await api.post('/api/tablea/export/mantel', payload, { responseType: 'blob' });

            const skippedHeader = res.headers['x-skipped-languages'];
            if (skippedHeader) {
                const ids = skippedHeader.split(',').filter(Boolean);
                alert(
                    `Warning: ${ids.length} language(s) without coordinates have been excluded ` +
                    `from all matrices (because GCD was selected):\n\n` + ids.join(', ')
                );
            }

            const contentDisposition = res.headers['content-disposition'] || '';
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            const filename = filenameMatch ? filenameMatch[1] : `mantel_test_${view}.zip`;
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
            const link = document.createElement('a');
            link.href = url; link.download = filename;
            document.body.appendChild(link); link.click(); link.remove();
            URL.revokeObjectURL(url);

            setMantelOpen(false);
        } catch (err) {
            alert(await readBlobError(err, "Error while running the Mantel test."));
        } finally {
            setMantelRunning(false);
        }
    };

    const runClusterMap = async () => {
        if (!['hamming', 'jaccard'].includes(clusterMapOpts.distance)) {
            alert("Pick a distance (Hamming or Jaccard[+]).");
            return;
        }
        const coeff = Number(clusterMapOpts.threshold_coeff);
        if (!(coeff > 0 && coeff <= 1)) {
            alert("Threshold coefficient must be in (0, 1].");
            return;
        }
        if (langSelectionEmpty) { alert('No language selected. Adjust the language selection first.'); return; }
        setClusterMapRunning(true);
        try {
            const payload = {
                view, ...filters,
                f_lang_specific: langPayloadIds,
                selected_ids: exportIds,
                distance: clusterMapOpts.distance,
                threshold_coeff: coeff,
            };
            const res = await api.post('/api/tablea/export/cluster_map', payload, { responseType: 'blob' });

            const skippedHeader = res.headers['x-skipped-languages'];
            if (skippedHeader) {
                const ids = skippedHeader.split(',').filter(Boolean);
                alert(
                    `Warning: ${ids.length} language(s) without coordinates have been excluded from the map:\n\n`
                    + ids.join(', ')
                );
            }

            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
            const link = document.createElement('a');
            link.href = url; link.download = `cluster_map_${view}.html`;
            document.body.appendChild(link); link.click(); link.remove();
            URL.revokeObjectURL(url);

            setClusterMapOpen(false);
        } catch (err) {
            alert(await readBlobError(err, "Error while building the cluster map."));
        } finally {
            setClusterMapRunning(false);
        }
    };

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
        <div className="container" style={{ maxWidth: '100%' }}>

            <header className="dashboard-hero" style={{ marginBottom: 'var(--form-col-gap, 2rem)' }}>
                <h1>Table A</h1>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--form-col-gap, 1.5rem)' }}>
                    <SegmentedToggle
                        ariaLabel="View"
                        value={view}
                        onChange={setView}
                        options={[{ value: 'params', label: 'Parameters View' }, { value: 'questions', label: 'Questions View' }]}
                    />
                </div>
            </header>

            <div className="card" style={{ padding: 'var(--form-box-pad-lg, 1.5rem)', marginBottom: 'var(--form-col-gap, 2rem)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 'var(--form-col-gap, 2rem)', marginBottom: 'var(--form-field-mb, 1rem)', flexWrap: 'wrap' }}>

                    <div style={{ flex: '1 1 340px' }}>
                        <span style={sectionTitleStyle}>Language Selection</span>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                            <div>
                                <label style={labelStyle}>Top Family</label>
                                <Select
                                    isMulti isSearchable closeMenuOnSelect={false}
                                    options={toSelectOptions(options.opt_top_families)}
                                    value={toSelectOptions(langFilters.top_family)}
                                    onChange={(selected) => handleLangFamilyChange('top_family', selected ? selected.map(option => option.value) : [])}
                                    placeholder="All"
                                    styles={multiSelectStyles}
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Subfamily</label>
                                <Select
                                    isMulti isSearchable closeMenuOnSelect={false}
                                    options={toSelectOptions(familyOpts)}
                                    value={toSelectOptions(langFilters.family)}
                                    onChange={(selected) => handleLangFamilyChange('family', selected ? selected.map(option => option.value) : [])}
                                    placeholder="All"
                                    styles={multiSelectStyles}
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Group</label>
                                <Select
                                    isMulti isSearchable closeMenuOnSelect={false}
                                    options={toSelectOptions(groupOpts)}
                                    value={toSelectOptions(langFilters.grp)}
                                    onChange={(selected) => handleLangFamilyChange('grp', selected ? selected.map(option => option.value) : [])}
                                    placeholder="All"
                                    styles={multiSelectStyles}
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Historical</label>
                                <select
                                    className="form-control"
                                    value={langFilters.historical}
                                    onChange={(e) => setLangFilters(prev => ({ ...prev, historical: e.target.value }))}
                                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}
                                >
                                    <option value="all">Both</option>
                                    <option value="yes">Only Historical</option>
                                    <option value="no">Only Non-Historical</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ marginBottom: '0.75rem' }}>
                            <label style={labelStyle}>Add specific languages</label>
                            <Select
                                isMulti isSearchable closeMenuOnSelect={false}
                                options={addLangOptions}
                                value={addLangValue}
                                onChange={(selected) => setAddedLangs(selected ? selected.map(option => option.value) : [])}
                                placeholder="Add languages outside the selected families…"
                                noOptionsMessage={() => 'No language to add'}
                                styles={multiSelectStyles}
                            />
                        </div>

                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                                <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>
                                    Languages selected ({resolvedLangIds.length}{candidateLangs.length !== resolvedLangIds.length ? ` of ${candidateLangs.length}` : ''})
                                </label>
                                <input
                                    type="search"
                                    placeholder="Search..."
                                    value={langPickFilter}
                                    onChange={(e) => setLangPickFilter(e.target.value)}
                                    style={{ flex: '1 1 120px', minWidth: '120px', padding: '0.35rem 0.5rem', fontSize: '0.8rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text)' }}
                                />
                            </div>
                            <div style={{ maxHeight: '5rem', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.5rem' }}>
                                {candidateLangs.length === 0 ? (
                                    <div className="small muted" style={{ padding: '0.5rem' }}>
                                        No language matches the selected families. Adjust the filters above or add specific languages.
                                    </div>
                                ) : visibleCandidateLangs.length === 0 ? (
                                    <div className="small muted" style={{ padding: '0.5rem' }}>No language matches “{langPickFilter}”.</div>
                                ) : visibleCandidateLangs.map(lang => {
                                    const included = !excludedSet.has(lang.id);
                                    return (
                                        <label key={lang.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.15rem 0', cursor: 'pointer', fontSize: '0.85rem', opacity: included ? 1 : 0.5 }}>
                                            <input type="checkbox" checked={included} onChange={() => toggleLangIncluded(lang.id)} />
                                            <span style={{ fontWeight: 700, minWidth: '3rem' }}>{lang.id}</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lang.name}</span>
                                            {!baseIdSet.has(lang.id) && (
                                                <span className="status" style={{ fontSize: '0.65rem', padding: '0 0.35rem', marginLeft: 'auto', background: 'var(--surface-2)', color: 'var(--text-muted)' }}>added</span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div style={{ flex: '1 1 300px' }}>
                        <span style={sectionTitleStyle}>
                            {view === 'params' ? 'Parameter Filters' : 'Question Filters'}
                        </span>

                        <div style={{ border: '1px dashed var(--border)', borderRadius: '6px', padding: '0.6rem 0.7rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: view === 'params' ? 'repeat(3, 1fr)' : '1fr 1fr', gap: '0.75rem' }}>
                            {view === 'params' ? (
                                <>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Schema</label>
                                        <select className="form-control" name="f_p_schema" value={filters.f_p_schema} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_schemas.map(schema => <option key={schema} value={schema}>{schema}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Type</label>
                                        <select className="form-control" name="f_p_type" value={filters.f_p_type} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_types.map(type => <option key={type} value={type}>{type}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Level</label>
                                        <select className="form-control" name="f_p_level" value={filters.f_p_level} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_levels.map(level => <option key={level} value={level}>{level}</option>)}
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Template</label>
                                        <select className="form-control" name="f_q_template" value={filters.f_q_template} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_templates.map(template => <option key={template} value={template}>{template}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Stop Question?</label>
                                        <select className="form-control" name="f_q_stop" value={filters.f_q_stop} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="all">All</option>
                                            <option value="yes">Yes</option>
                                            <option value="no">No</option>
                                        </select>
                                    </div>
                                </>
                            )}
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 'var(--form-box-pad, 1.25rem)' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button onClick={fetchMatrix} className="btn btn--primary">Apply Filters</button>
                        <button onClick={resetFilters} className="btn">Reset</button>
                    </div>

                    <div ref={downloadRef} style={{ position: 'relative', display: 'inline-block' }}>
                        <button
                            type="button"
                            className="btn"
                            style={{ background: '#333', color: 'white', opacity: wouldExportNothing ? 0.55 : 1, cursor: wouldExportNothing ? 'not-allowed' : 'pointer' }}
                            onClick={() => setDownloadOpen(open => !open)}
                            disabled={wouldExportNothing}
                            title={wouldExportNothing
                                ? "Nothing to export: your selection / search returns 0 rows. Clear the search or change selection."
                                : ""}
                            aria-haspopup="menu"
                            aria-expanded={downloadOpen}
                        >
                            Download Data ▾
                        </button>
                        {downloadOpen && (
                            <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: 'var(--surface)', color: 'var(--text)', minWidth: 240, boxShadow: '0 6px 18px rgba(0,0,0,0.18)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 100, overflow: 'hidden' }}>
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('xlsx', `tableA_${view}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }}>
                                    Export .xlsx (Standard)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('csv', `tableA_${view}_transposed.csv`, 'text/csv'); }}>
                                    Export .csv (Transposed)
                                </DropItem>
                                <div style={{ borderTop: '1px solid var(--border)' }} />
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('distances', `distances_txt_${view}.zip`, 'application/zip'); }}>
                                    Distances (.txt zip)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('geo_distances', 'geo_distances_km.zip', 'application/zip'); }}>
                                    Geographic distances km (.txt zip)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('dendrograms', `dendrograms_${view}.zip`, 'application/zip'); }}>
                                    Dendrograms (.png zip)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); setClusterMapOpen(true); }}>
                                    Cluster map (.html)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); handleDownload('pca', `pca_scatterplot_${view}.png`, 'image/png'); }}>
                                    PCA Scatterplot (.png)
                                </DropItem>
                                <DropItem onClick={() => { setDownloadOpen(false); setMantelOpen(true); }}>
                                    Mantel test (.zip)
                                </DropItem>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {heavyExportName && (
                <div className="alert alert-info" role="status" style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                    Generating {heavyExportName}… {HEAVY_EXPORT_HINT}
                </div>
            )}

            {error && <div className="alert alert-error" style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>{error}</div>}

            {view === 'questions' && matrixData.orphan_answers?.count > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                    {/* un solo figlio: .alert è flex */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>
                            {matrixData.orphan_answers.count.toLocaleString('en-US')} answer
                            {matrixData.orphan_answers.count === 1 ? '' : 's'} in this selection belong to
                            parameters neutralised by an implicational condition.
                        </strong>
                        <div style={{ marginTop: '0.35rem' }}>
                            The Questions view shows raw answers and does not apply implicational
                            neutralisation, so these answers are counted both in the table below and in every
                            computation started from this page (distances, dendrograms, cluster map, PCA,
                            Mantel). In the Parameters view the same cells are <code>0</code> and are skipped,
                            which is why the two views can return different distances for the languages
                            involved.
                        </div>
                        <div className="small" style={{ marginTop: '0.35rem' }}>
                            Affects {plural(matrixData.orphan_answers.languages.length, 'language')} and{' '}
                            {plural(matrixData.orphan_answers.parameters.length, 'parameter')}.
                            {matrixData.orphan_answers.languages.length <= 12
                                && matrixData.orphan_answers.parameters.length <= 12 && (
                                <> Languages: {matrixData.orphan_answers.languages.join(', ')} &mdash;{' '}
                                Parameters: {matrixData.orphan_answers.parameters.join(', ')}</>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                    padding: 'var(--form-box-pad, 1rem)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                }}>
                    <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setSelectedRows(filteredRows.map(row => row.item.id))}>Select All</button>
                    <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setSelectedRows([])}>Deselect All</button>
                    <input
                        type="search"
                        placeholder={view === 'params' ? 'Search ID, name, conditions...' : 'Search Q.ID, text, parameter...'}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ flex: '0 1 300px', minWidth: '160px', padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text)' }}
                    />
                    <span className="small muted" style={{ marginLeft: 'auto' }}>
                        {search
                            ? `Showing ${filteredRows.length} of ${matrixData.rows.length} rows`
                            : `${matrixData.rows.length} rows`}
                    </span>
                </div>

                <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
                    {loading ? (
                        <div style={{ padding: '3rem', textAlign: 'center' }}>Loading data...</div>
                    ) : matrixData.rows.length === 0 ? (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No data matches the selected filters.</div>
                    ) : filteredRows.length === 0 ? (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            No rows match the search "{search}". Clear the search box to see all {matrixData.rows.length} rows.
                        </div>
                    ) : (
                        <table className="table table--freeze" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                            <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-2)' }}>
                            <tr>
                                <th style={{ width: '45px', textAlign: 'center', position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 11, borderRight: '1px solid var(--border)' }}>
                                    <input type="checkbox" onChange={handleMasterCheckbox} checked={filteredRows.length > 0 && filteredRows.every(row => selectedRows.includes(row.item.id))} />
                                </th>
                                <th style={{ position: 'sticky', left: '45px', background: 'var(--surface-2)', zIndex: 11, minWidth: '80px', borderRight: '1px solid var(--border)' }}>
                                    {view === 'params' ? 'ID' : 'Q.ID'}
                                </th>
                                <th style={{ minWidth: view === 'params' ? '200px' : '400px', whiteSpace: 'normal', borderRight: '1px solid var(--border)' }}>
                                    {view === 'params' ? 'Parameter Name' : 'Question Text'}
                                </th>
                                {view === 'params' && (
                                    <th style={{ minWidth: '250px' }}>Implicational conditions</th>
                                )}
                                {matrixData.languages.map(lang => (
                                    <th key={lang.id} style={{ textAlign: 'center', padding: '0.5rem' }}>{lang.id}</th>
                                ))}
                            </tr>
                            </thead>
                            <tbody>
                            {filteredRows.map(row => (
                                <tr key={row.item.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ textAlign: 'center', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 5, borderRight: '1px solid var(--border)' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedRows.includes(row.item.id)}
                                            onChange={() => handleRowCheckbox(row.item.id)}
                                        />
                                    </td>
                                    <td style={{ position: 'sticky', left: '45px', background: 'var(--surface)', zIndex: 5, fontWeight: 'bold', borderRight: '1px solid var(--border)' }}>
                                        {row.item.id}
                                    </td>
                                    <td style={{ whiteSpace: 'normal', borderRight: '1px solid var(--border)' }}>
                                        {row.item.name}
                                    </td>
                                    {view === 'params' && (
                                        <td style={{ color: 'var(--text-muted)', whiteSpace: 'normal', fontSize: '0.85em' }}>
                                            {row.item.extra}
                                        </td>
                                    )}
                                    {row.cells.map((cell, idx) => (
                                        <td
                                            key={`${row.item.id}-${idx}`}
                                            style={{
                                                textAlign: 'center',
                                                fontWeight: cell.val ? 'bold' : 'normal',
                                                background: cell.is_incomplete ? 'rgba(220, 53, 69, 0.15)' : undefined,
                                            }}
                                            title={
                                                cell.is_incomplete ? 'Parameter incomplete or flagged unsure for this language'
                                                : (cell.val === '0' && cell.init === '+') ? 'Final value 0 (initial value was +, zeroed by the implicational condition)'
                                                : undefined
                                            }
                                        >
                                            {cell.val ? (
                                                <Link to={`/languages/${cell.lang_id}/data#${view === 'questions' ? 'q_' : ''}${row.item.id}`} style={{ textDecoration: 'none', color: cell.val === '-' ? '#dc3545' : cell.val === '+' ? '#28a745' : 'inherit' }}>
                                                    {(cell.val === '0' && cell.init === '+') ? '0+' : cell.val}
                                                </Link>
                                            ) : (
                                                <span style={{ opacity: 0.3 }}>—</span>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {mantelOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => { if (e.target === e.currentTarget && !mantelRunning) setMantelOpen(false); }}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
                    }}
                >
                    <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(440px, 92vw)', boxShadow: '0 12px 36px rgba(0,0,0,0.25)', padding: 'var(--modal-pad, 1.25rem 1.5rem)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Mantel test</h3>
                        <p className="muted small" style={{ marginTop: 0 }}>
                            Choose two or three distance matrices.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                            <CheckRow label="Geographic distance (GCD)"
                                checked={mantelOpts.gcd}
                                onChange={(checked) => setMantelOpts(prev => ({ ...prev, gcd: checked }))} />
                            <CheckRow label="Hamming"
                                checked={mantelOpts.hamming}
                                onChange={(checked) => setMantelOpts(prev => ({ ...prev, hamming: checked }))} />
                            <CheckRow label="Jaccard[+]"
                                checked={mantelOpts.jaccard}
                                onChange={(checked) => setMantelOpts(prev => ({ ...prev, jaccard: checked }))} />
                        </div>

                        {mantelOpts.gcd && (
                            <div className="small muted" style={{ marginBottom: '0.75rem' }}>
                                Note: languages without coordinates will be excluded from all matrices.
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button type="button" className="btn" disabled={mantelRunning} onClick={() => setMantelOpen(false)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn--primary" disabled={mantelRunning} onClick={runMantel}>
                                {mantelRunning ? 'Running…' : 'Perform Mantel test and download (.zip)'}
                            </button>
                        </div>
                        {mantelRunning && (
                            <div className="small muted" role="status" style={{ marginTop: '0.5rem', textAlign: 'right' }}>{HEAVY_EXPORT_HINT}</div>
                        )}
                    </div>
                </div>
            )}

            {clusterMapOpen && (
                <div
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => { if (e.target === e.currentTarget && !clusterMapRunning) setClusterMapOpen(false); }}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
                    }}
                >
                    <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(460px, 92vw)', boxShadow: '0 12px 36px rgba(0,0,0,0.25)', padding: 'var(--modal-pad, 1.25rem 1.5rem)' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Cluster map</h3>
                        <p className="muted small" style={{ marginTop: 0 }}>
                            Builds an interactive HTML map: UPGMA clusters (linkage = average) on the geographic coordinates of the selected languages.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Distance</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.92rem' }}>
                                <input type="radio" name="cmap_dist" value="hamming"
                                    checked={clusterMapOpts.distance === 'hamming'}
                                    onChange={() => setClusterMapOpts(prev => ({ ...prev, distance: 'hamming' }))} />
                                <span>Hamming (default)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.92rem' }}>
                                <input type="radio" name="cmap_dist" value="jaccard"
                                    checked={clusterMapOpts.distance === 'jaccard'}
                                    onChange={() => setClusterMapOpts(prev => ({ ...prev, distance: 'jaccard' }))} />
                                <span>Jaccard[+]</span>
                            </label>
                        </div>

                        <div style={{ margin: '1rem 0' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                                Cluster threshold (× max linkage distance)
                            </label>
                            <input
                                type="number"
                                min="0.05" max="1" step="0.01"
                                value={clusterMapOpts.threshold_coeff}
                                onChange={(e) => setClusterMapOpts(prev => ({ ...prev, threshold_coeff: e.target.value }))}
                                className="form-control"
                                style={{ width: '8rem', padding: '0.35rem 0.5rem' }}
                            />
                            <div className="small muted" style={{ marginTop: '0.3rem' }}>
                                Default 0.56 (same as the original 01_plot_clusters.py script). Lower = more, smaller clusters.
                            </div>
                        </div>

                        <div className="small muted" style={{ marginBottom: '0.75rem' }}>
                            Note: languages without coordinates will be excluded from the map.
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button type="button" className="btn" disabled={clusterMapRunning} onClick={() => setClusterMapOpen(false)}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn--primary" disabled={clusterMapRunning} onClick={runClusterMap}>
                                {clusterMapRunning ? 'Building…' : 'Build cluster map and download (.html)'}
                            </button>
                        </div>
                        {clusterMapRunning && (
                            <div className="small muted" role="status" style={{ marginTop: '0.5rem', textAlign: 'right' }}>{HEAVY_EXPORT_HINT}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function DropItem({ onClick, children }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.6rem 0.9rem', border: 'none', background: 'transparent',
                color: 'var(--text)', cursor: 'pointer', fontSize: '0.88rem',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
            {children}
        </button>
    );
}

function CheckRow({ label, checked, onChange }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.92rem' }}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ width: 16, height: 16 }}
            />
            <span>{label}</span>
        </label>
    );
}