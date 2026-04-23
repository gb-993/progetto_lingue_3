import { useState, useEffect } from 'react';
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
            setError("Errore durante il calcolo della tabella.");
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
            alert("Errore durante la generazione del file. Controlla i filtri applicati.");
        }
    };

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
                                    <option value="no">Only Non-Hist</option>
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

                    {/* Download Dropdown simulato con HTML standard */}
                    <div className="download-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
                        <button className="btn" style={{ background: '#333', color: 'white' }}>Download Data ▾</button>
                        <div className="download-content" style={{ display: 'none', position: 'absolute', right: 0, background: 'white', minWidth: '220px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', border: '1px solid #ddd', borderRadius: '4px', zIndex: 100 }}>
                            <button onClick={() => handleDownload('xlsx', `tableA_${view}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px', border: 'none', background: 'none', cursor: 'pointer' }}>Export .xlsx (Standard)</button>
                            <button onClick={() => handleDownload('csv', `tableA_${view}_transposed.csv`, 'text/csv')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px', border: 'none', background: 'none', cursor: 'pointer' }}>Export .csv (Transposed)</button>

                            {view === 'params' && (
                                <>
                                    <button onClick={() => handleDownload('distances', 'distances_txt.zip', 'application/zip')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px', border: 'none', background: 'none', cursor: 'pointer', borderTop: '1px solid #ddd' }}>Distances (.txt zip)</button>
                                    <button onClick={() => handleDownload('dendrograms', 'dendrograms.zip', 'application/zip')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px', border: 'none', background: 'none', cursor: 'pointer' }}>Dendrograms (.png zip)</button>
                                    <button onClick={() => handleDownload('pca', `pca_scatterplot_${view}.png`, 'image/png')} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px', border: 'none', background: 'none', cursor: 'pointer' }}>PCA Scatterplot (.png)</button>
                                </>
                            )}
                        </div>
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
                        <div style={{ padding: '3rem', textAlign: 'center', color: '#666' }}>No data matches the selected filters.</div>
                    ) : (
                        <table className="table table--freeze" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                            <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 10, background: '#f8f9fa' }}>
                            <tr>
                                <th style={{ width: '45px', textAlign: 'center', position: 'sticky', left: 0, background: '#f8f9fa', zIndex: 11, borderRight: '1px solid #ddd' }}>
                                    <input type="checkbox" onChange={handleMasterCheckbox} checked={selectedRows.length > 0 && selectedRows.length === matrixData.rows.length} />
                                </th>
                                <th style={{ position: 'sticky', left: '45px', background: '#f8f9fa', zIndex: 11, minWidth: '80px', borderRight: '1px solid #ddd' }}>
                                    {view === 'params' ? 'ID' : 'Q.ID'}
                                </th>
                                <th style={{ minWidth: view === 'params' ? '200px' : '400px', whiteSpace: 'normal', position: 'sticky', left: '125px', background: '#f8f9fa', zIndex: 11, borderRight: '1px solid #ddd' }}>
                                    {view === 'params' ? 'Parameter Name' : 'Question Text'}
                                </th>
                                {view === 'params' && (
                                    <th style={{ minWidth: '250px' }}>Implicational conditions</th>
                                )}
                                {matrixData.languages.map(lang => (
                                    <th key={lang.id} style={{ textAlign: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: '1rem 0.5rem' }}>{lang.id}</th>
                                ))}
                            </tr>
                            </thead>
                            <tbody>
                            {matrixData.rows.map(row => (
                                <tr key={row.item.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ textAlign: 'center', position: 'sticky', left: 0, background: 'white', zIndex: 5, borderRight: '1px solid #ddd' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedRows.includes(row.item.id)}
                                            onChange={() => handleRowCheckbox(row.item.id)}
                                        />
                                    </td>
                                    <td style={{ position: 'sticky', left: '45px', background: 'white', zIndex: 5, fontWeight: 'bold', borderRight: '1px solid #ddd' }}>
                                        {row.item.id}
                                    </td>
                                    <td style={{ whiteSpace: 'normal', position: 'sticky', left: '125px', background: 'white', zIndex: 5, borderRight: '1px solid #ddd' }}>
                                        {row.item.name}
                                    </td>
                                    {view === 'params' && (
                                        <td style={{ color: '#666', whiteSpace: 'normal', fontSize: '0.85em' }}>
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

            {/* CSS per il menu a tendina */}
            <style>{`
                .download-dropdown:hover .download-content { display: block !important; }
                .download-content button:hover { background-color: #f8f9fa !important; color: #ff4500 !important; }
            `}</style>
        </div>
    );
}