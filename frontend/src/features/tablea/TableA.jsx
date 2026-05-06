import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function TableA() {
    const [view, setView] = useState('params'); // 'params' o 'questions'

    // Stato per le opzioni delle tendine
    const [options, setOptions] = useState({
        opt_top_families: [], opt_families: [], opt_groups: [],
        opt_schemas: [], opt_types: [], opt_levels: [], opt_templates: [],
        opt_all_languages: []
    });

    // Stato per i filtri attivi
    const [filters, setFilters] = useState({
        f_lang_top_family: '', f_lang_family: '', f_lang_grp: '', f_lang_hist: 'all',
        f_p_schema: '', f_p_type: '', f_p_level: '',
        f_q_template: '', f_q_stop: 'all'
    });

    // Stato per le lingue specifiche (checkbox)
    const [selectedLangs, setSelectedLangs] = useState([]);

    // Stato per le righe selezionate manualmente (checkbox tabella)
    const [selectedRows, setSelectedRows] = useState([]);

    // Dati della matrice
    const [matrixData, setMatrixData] = useState({ languages: [], rows: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Dropdown download + modale Mantel
    const [downloadOpen, setDownloadOpen] = useState(false);
    const downloadRef = useRef(null);
    const [mantelOpen, setMantelOpen] = useState(false);
    const [mantelOpts, setMantelOpts] = useState({ gcd: true, hamming: true, jaccard: true });
    const [mantelRunning, setMantelRunning] = useState(false);
    const [clusterMapOpen, setClusterMapOpen] = useState(false);
    const [clusterMapOpts, setClusterMapOpts] = useState({ distance: 'hamming', threshold_coeff: 0.56 });
    const [clusterMapRunning, setClusterMapRunning] = useState(false);

    // Caricamento opzioni iniziali
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

    // Caricamento matrice dati
    const fetchMatrix = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = {
                view,
                ...filters,
                f_lang_specific: selectedLangs,
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

    // Ricarica la matrice quando cambia la view (Params <-> Questions)
    useEffect(() => {
        // Reset delle righe selezionate quando si cambia vista
        setSelectedRows([]);
        fetchMatrix();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    // Gestione input filtri testuali/select
    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    // Gestione checkbox lingue
    const handleLangCheckbox = (id) => {
        setSelectedLangs(prev =>
            prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
        );
    };

    // Gestione selezione righe (tabella)
    const handleRowCheckbox = (id) => {
        setSelectedRows(prev =>
            prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
        );
    };

    const handleMasterCheckbox = (e) => {
        const isChecked = e.target.checked;
        if (isChecked) {
            setSelectedRows(matrixData.rows.map(r => r.item.id));
        } else {
            setSelectedRows([]);
        }
    };

    const resetFilters = () => {
        setFilters({
            f_lang_top_family: '', f_lang_family: '', f_lang_grp: '', f_lang_hist: 'all',
            f_p_schema: '', f_p_type: '', f_p_level: '',
            f_q_template: '', f_q_stop: 'all'
        });
        setSelectedLangs([]);
        setSelectedRows([]);
        // fetchMatrix verrà chiamato manualmente se l'utente clicca "Apply"
    };

    // ==========================================
    // GESTIONE DOWNLOAD FILE (BLOB)
    // ==========================================
    const handleDownload = async (endpoint, filename, mimeType) => {
        try {
            const payload = { view, ...filters, f_lang_specific: selectedLangs, selected_ids: selectedRows };
            const response = await api.post(`/api/tablea/export/${endpoint}`, payload, { responseType: 'blob' });

            const skippedHeader = response.headers['x-skipped-languages'];
            if (skippedHeader) {
                const ids = skippedHeader.split(',').filter(Boolean);
                alert(
                    `Warning: ${ids.length} language(s) without coordinates have been excluded:\n\n`
                    + ids.join(', ')
                );
            }

            // Crea un link temporaneo per forzare il download del file nel browser
            const url = window.URL.createObjectURL(new Blob([response.data], { type: mimeType }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (err) {
            console.error(`Errore export ${endpoint}`, err);
            alert("Error while generating the file. Check the applied filters.");
        }
    };

    const runMantel = async () => {
        const selectedCount = Number(mantelOpts.gcd) + Number(mantelOpts.hamming) + Number(mantelOpts.jaccard);
        if (selectedCount < 2) {
            alert("Select at least 2 distances for the Mantel test.");
            return;
        }
        setMantelRunning(true);
        try {
            const payload = {
                view, ...filters,
                f_lang_specific: selectedLangs,
                selected_ids: selectedRows,
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

            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^";]+)"?/);
            const filename = m ? m[1] : 'mantel_test.zip';
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);

            setMantelOpen(false);
        } catch (err) {
            let msg = "Error while running the Mantel test.";
            const blob = err?.response?.data;
            if (blob instanceof Blob) {
                try {
                    const text = await blob.text();
                    const json = JSON.parse(text);
                    if (json?.detail) msg = json.detail;
                } catch { /* non-JSON */ }
            }
            alert(msg);
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
        setClusterMapRunning(true);
        try {
            const payload = {
                view, ...filters,
                f_lang_specific: selectedLangs,
                selected_ids: selectedRows,
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
            const a = document.createElement('a');
            a.href = url; a.download = 'cluster_map.html';
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);

            setClusterMapOpen(false);
        } catch (err) {
            let msg = "Error while building the cluster map.";
            const blob = err?.response?.data;
            if (blob instanceof Blob) {
                try {
                    const text = await blob.text();
                    const json = JSON.parse(text);
                    if (json?.detail) msg = json.detail;
                } catch { /* non-JSON */ }
            }
            alert(msg);
        } finally {
            setClusterMapRunning(false);
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
        <div className="container" style={{ maxWidth: '100%' }}>

            <header className="dashboard-hero" style={{ marginBottom: '2rem' }}>
                <h1>Table A</h1>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                    <nav style={{ background: '#e9ecef', padding: '5px', borderRadius: '50px', display: 'inline-flex' }}>
                        <button
                            className={`btn ${view === 'params' ? 'btn-light' : 'btn-outline'}`}
                            style={{ borderRadius: '50px', border: 'none', background: view === 'params' ? 'white' : 'transparent', fontWeight: 600, color: view === 'params' ? 'black' : '#6c757d', boxShadow: view === 'params' ? '0 2px 5px rgba(0,0,0,0.1)' : 'none' }}
                            onClick={() => setView('params')}
                        >
                            Parameters View
                        </button>
                        <button
                            className={`btn ${view === 'questions' ? 'btn-light' : 'btn-outline'}`}
                            style={{ borderRadius: '50px', border: 'none', background: view === 'questions' ? 'white' : 'transparent', fontWeight: 600, color: view === 'questions' ? 'black' : '#6c757d', boxShadow: view === 'questions' ? '0 2px 5px rgba(0,0,0,0.1)' : 'none' }}
                            onClick={() => setView('questions')}
                        >
                            Questions View
                        </button>
                    </nav>
                </div>
            </header>

            {/* ================= PANNELLO FILTRI ================= */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', flexWrap: 'wrap' }}>

                    {/* Filtri Lingua */}
                    <div style={{ flex: '1 1 300px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text)', textTransform: 'uppercase', marginBottom: '1rem', borderBottom: '1px solid var(--border)', display: 'block', paddingBottom: '0.25rem' }}>
                            Language Filters
                        </span>

                        <div style={{ marginBottom: '0.75rem' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Specific Languages</label>
                            <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid var(--border)', padding: '0.5rem', background: 'var(--surface-2)', borderRadius: '4px' }}>
                                {options.opt_all_languages.map(lang => (
                                    <div key={lang.id} style={{ display: 'flex', alignItems: 'center', marginBottom: '0.3rem' }}>
                                        <input
                                            type="checkbox"
                                            id={`lang_${lang.id}`}
                                            checked={selectedLangs.includes(lang.id)}
                                            onChange={() => handleLangCheckbox(lang.id)}
                                            style={{ marginRight: '0.5rem' }}
                                        />
                                        <label htmlFor={`lang_${lang.id}`} style={{ margin: 0, cursor: 'pointer', fontSize: '0.85rem' }}>
                                            {lang.name} ({lang.id})
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Top Family</label>
                                <select className="form-control" name="f_lang_top_family" value={filters.f_lang_top_family} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                    <option value="">All</option>
                                    {options.opt_top_families.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Family</label>
                                <select className="form-control" name="f_lang_family" value={filters.f_lang_family} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                    <option value="">All</option>
                                    {options.opt_families.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Historical</label>
                                <select className="form-control" name="f_lang_hist" value={filters.f_lang_hist} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                    <option value="all">Both</option>
                                    <option value="yes">Only Historical</option>
                                    <option value="no">Only Non-Historical</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Group</label>
                                <select className="form-control" name="f_lang_grp" value={filters.f_lang_grp} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                    <option value="">All</option>
                                    {options.opt_groups.map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Filtri Specifici (Params/Questions) */}
                    <div style={{ flex: '1 1 300px' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text)', textTransform: 'uppercase', marginBottom: '1rem', borderBottom: '1px solid var(--border)', display: 'block', paddingBottom: '0.25rem' }}>
                            {view === 'params' ? 'Parameters Filters' : 'Questions Filters'}
                        </span>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            {view === 'params' ? (
                                <>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Schema</label>
                                        <select className="form-control" name="f_p_schema" value={filters.f_p_schema} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_schemas.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Type</label>
                                        <select className="form-control" name="f_p_type" value={filters.f_p_type} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_types.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Level</label>
                                        <select className="form-control" name="f_p_level" value={filters.f_p_level} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_levels.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.3rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Template</label>
                                        <select className="form-control" name="f_q_template" value={filters.f_q_template} onChange={handleFilterChange} style={{ width: '100%', padding: '0.4rem', fontSize: '0.85rem' }}>
                                            <option value="">All</option>
                                            {options.opt_templates.map(t => <option key={t} value={t}>{t}</option>)}
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

                {/* Barra Azioni */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button onClick={fetchMatrix} className="btn btn--primary">Apply Filters</button>
                        <button onClick={resetFilters} className="btn">Reset</button>
                    </div>

                    {/* Download Dropdown click-toggle */}
                    <div ref={downloadRef} style={{ position: 'relative', display: 'inline-block' }}>
                        <button
                            type="button"
                            className="btn"
                            style={{ background: '#333', color: 'white' }}
                            onClick={() => setDownloadOpen(o => !o)}
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
                                {view === 'params' && (
                                    <>
                                        <div style={{ borderTop: '1px solid var(--border)' }} />
                                        <DropItem onClick={() => { setDownloadOpen(false); handleDownload('distances', 'distances_txt.zip', 'application/zip'); }}>
                                            Distances (.txt zip)
                                        </DropItem>
                                        <DropItem onClick={() => { setDownloadOpen(false); handleDownload('geo_distances', 'geo_distances_km.zip', 'application/zip'); }}>
                                            Geographic distances km (.txt zip)
                                        </DropItem>
                                        <DropItem onClick={() => { setDownloadOpen(false); handleDownload('dendrograms', 'dendrograms.zip', 'application/zip'); }}>
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
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ================= TABELLA RISULTATI ================= */}
            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                    <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => setSelectedRows(matrixData.rows.map(r => r.item.id))}>Select All</button>
                    <button className="btn" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', marginLeft: '0.5rem' }} onClick={() => setSelectedRows([])}>Deselect All</button>
                </div>

                <div style={{ maxHeight: '65vh', overflow: 'auto' }}>
                    {loading ? (
                        <div style={{ padding: '3rem', textAlign: 'center' }}>Loading data...</div>
                    ) : matrixData.rows.length === 0 ? (
                        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No data matches the selected filters.</div>
                    ) : (
                        <table className="table table--freeze" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                            <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface-2)' }}>
                            <tr>
                                <th style={{ width: '45px', textAlign: 'center', position: 'sticky', left: 0, background: 'var(--surface-2)', zIndex: 11, borderRight: '1px solid var(--border)' }}>
                                    <input type="checkbox" onChange={handleMasterCheckbox} checked={selectedRows.length > 0 && selectedRows.length === matrixData.rows.length} />
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
                            {matrixData.rows.map(row => (
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
                                        <td key={`${row.item.id}-${idx}`} style={{ textAlign: 'center', fontWeight: cell.val ? 'bold' : 'normal' }}>
                                            {cell.val ? (
                                                <Link to={`/languages/${cell.lang_id}/data#${view === 'questions' ? 'q_' : ''}${row.item.id}`} style={{ textDecoration: 'none', color: cell.val === '-' ? '#dc3545' : cell.val === '+' ? '#28a745' : 'inherit' }}>
                                                    {cell.val}
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

            {/* ===== MODALE MANTEL TEST ===== */}
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
                    <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(440px, 92vw)', boxShadow: '0 12px 36px rgba(0,0,0,0.25)', padding: '1.25rem 1.5rem' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Mantel test</h3>
                        <p className="muted small" style={{ marginTop: 0 }}>
                            Choose two distance matrices.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                            <CheckRow label="Geographic distance (GCD)"
                                checked={mantelOpts.gcd}
                                onChange={(v) => setMantelOpts(o => ({ ...o, gcd: v }))} />
                            <CheckRow label="Hamming"
                                checked={mantelOpts.hamming}
                                onChange={(v) => setMantelOpts(o => ({ ...o, hamming: v }))} />
                            <CheckRow label="Jaccard[+]"
                                checked={mantelOpts.jaccard}
                                onChange={(v) => setMantelOpts(o => ({ ...o, jaccard: v }))} />
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
                    </div>
                </div>
            )}

            {/* ===== MODALE CLUSTER MAP ===== */}
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
                    <div style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, width: 'min(460px, 92vw)', boxShadow: '0 12px 36px rgba(0,0,0,0.25)', padding: '1.25rem 1.5rem' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Cluster map</h3>
                        <p className="muted small" style={{ marginTop: 0 }}>
                            Builds an interactive HTML map: UPGMA clusters (linkage = average) on the geographic coordinates of the selected languages.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '1rem 0' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Distance</label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.92rem' }}>
                                <input type="radio" name="cmap_dist" value="hamming"
                                    checked={clusterMapOpts.distance === 'hamming'}
                                    onChange={() => setClusterMapOpts(o => ({ ...o, distance: 'hamming' }))} />
                                <span>Hamming (default)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.92rem' }}>
                                <input type="radio" name="cmap_dist" value="jaccard"
                                    checked={clusterMapOpts.distance === 'jaccard'}
                                    onChange={() => setClusterMapOpts(o => ({ ...o, distance: 'jaccard' }))} />
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
                                onChange={(e) => setClusterMapOpts(o => ({ ...o, threshold_coeff: e.target.value }))}
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