import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function ImportExcel() {
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');

    const handleFile = (e) => {
        setFile(e.target.files[0] || null);
        setReport(null);
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        setError('');
        setReport(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post('/api/admin/import/excel', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setReport(res.data);
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore durante l\'import.');
        } finally {
            setBusy(false);
        }
    };

    const handleDownloadErrorReport = async () => {
        if (!report) return;
        try {
            const res = await api.post('/api/admin/import/error-report/xlsx', {
                errors: report.errors,
                target_language_id: report.target_language_id,
                target_language_name: report.target_language_name,
            }, { responseType: 'blob' });
            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^";]+)"?/);
            const filename = m ? m[1] : 'PCM_import_errors.xlsx';
            const blob = new Blob([res.data]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch {
            alert("Errore nel download del report.");
        }
    };

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Import from Excel</h1>
                <p className="muted">
                    Carica un file Excel per importare schema (Motivations, Parameters, Questions, QAM)
                    e/o dati di compilazione di una singola lingua (sheet <code>Database_model</code>).
                </p>
            </header>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Strategia</h3>
                <ul className="small" style={{ lineHeight: 1.8, marginBottom: 0 }}>
                    <li><strong>Schema</strong> (Motivations / Parameters / Questions / QAM): <em>strict update</em>. Se l'<code>id</code> esiste in DB, i campi vengono rimpiazzati col valore del file. Se l'<code>id</code> non esiste, la riga è un errore (saltata, finisce nel report). Le entità non menzionate nel file rimangono intatte.</li>
                    <li><strong>Database_model</strong>: <em>replace totale</em> della lingua. Tutte le risposte/esempi/motivazioni della lingua vengono cancellate, poi inserite solo le righe valide. Le righe errate restano svuotate (non risposte) e finiscono nel report.</li>
                    <li><strong>Errori a cascata</strong>: se una motivation/question fallisce, le righe dipendenti generano un errore esplicito (mai silenziose).</li>
                </ul>
            </div>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                            File Excel (.xlsx, max 50 MB)
                        </label>
                        <input
                            type="file"
                            accept=".xlsx,.xlsm"
                            onChange={handleFile}
                            disabled={busy}
                            style={{ display: 'block', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px', width: '100%', maxWidth: '500px' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={!file || busy}
                        >
                            {busy ? 'Importing...' : 'Start Import'}
                        </button>
                        <Link to="/languages" className="btn">Cancel</Link>
                        {busy && (
                            <span className="small muted">⚠️ Non chiudere la pagina fino al termine.</span>
                        )}
                    </div>
                </form>
            </div>

            {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {report && <ImportReport report={report} onDownloadErrors={handleDownloadErrorReport} />}
        </div>
    );
}

function ImportReport({ report, onDownloadErrors }) {
    const totalErrors = report.errors?.length || 0;
    const hasErrors = totalErrors > 0;
    const sheets = Object.entries(report.by_sheet || {});

    return (
        <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem',
            }}>
                <h3 style={{ margin: 0 }}>
                    {hasErrors ? '⚠️ Import completato con errori' : '✅ Import completato'}
                </h3>
                {hasErrors && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={onDownloadErrors}
                    >
                        📥 Download error report (.xlsx)
                    </button>
                )}
            </div>

            {report.target_language_name && (
                <p className="small muted" style={{ marginTop: 0 }}>
                    Lingua processata: <strong>{report.target_language_name}</strong>
                    {report.target_language_id && <span> ({report.target_language_id})</span>}
                </p>
            )}

            {/* Summary per sheet */}
            <h4 style={{ marginBottom: '0.5rem' }}>Riepilogo per sheet</h4>
            {sheets.length === 0 ? (
                <p className="small muted">Nessun sheet riconosciuto nel file.</p>
            ) : (
                <table className="table" style={{ marginBottom: '1.5rem' }}>
                    <thead>
                        <tr>
                            <th>Sheet</th>
                            <th style={{ textAlign: 'right' }}>Righe</th>
                            <th style={{ textAlign: 'right' }}>Aggiornate</th>
                            <th style={{ textAlign: 'right' }}>Inserite</th>
                            <th style={{ textAlign: 'right' }}>Saltate</th>
                            <th style={{ textAlign: 'right' }}>Errori</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sheets.map(([name, s]) => (
                            <tr key={name}>
                                <td><strong>{name}</strong></td>
                                <td style={{ textAlign: 'right' }}>{s.rows_total}</td>
                                <td style={{ textAlign: 'right', color: s.updated > 0 ? '#15803d' : 'inherit' }}>{s.updated}</td>
                                <td style={{ textAlign: 'right', color: s.inserted > 0 ? '#15803d' : 'inherit' }}>{s.inserted}</td>
                                <td style={{ textAlign: 'right' }}>{s.skipped}</td>
                                <td style={{
                                    textAlign: 'right',
                                    color: s.errors > 0 ? '#b91c1c' : 'inherit',
                                    fontWeight: s.errors > 0 ? 'bold' : 'normal',
                                }}>
                                    {s.errors}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {/* Lista errori */}
            {hasErrors && (
                <>
                    <h4 style={{ marginBottom: '0.5rem' }}>Errori ({totalErrors})</h4>
                    <div style={{
                        maxHeight: '500px', overflowY: 'auto',
                        border: '1px solid var(--border)', borderRadius: '6px',
                    }}>
                        <table className="table" style={{ marginBottom: 0 }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa' }}>
                                <tr>
                                    <th>Sheet</th>
                                    <th>Riga</th>
                                    <th>Colonna</th>
                                    <th>Valore</th>
                                    <th>Motivo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.errors.map((e, i) => (
                                    <tr key={i}>
                                        <td className="small">{e.sheet}</td>
                                        <td className="small">{e.row || '—'}</td>
                                        <td className="small muted">{e.column || '—'}</td>
                                        <td className="small" style={{ maxWidth: '250px', wordBreak: 'break-word' }}>
                                            {e.value || '—'}
                                        </td>
                                        <td className="small" style={{ color: '#b91c1c' }}>{e.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="small muted" style={{ marginTop: '1rem' }}>
                        Suggerimento: scarica il report con <strong>Download error report (.xlsx)</strong>,
                        sistema gli errori nel file di partenza e re-importa.
                    </p>
                </>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
                <Link to="/languages" className="btn btn--primary">Vai alla lista lingue</Link>
                {report.target_language_id && (
                    <Link to={`/languages/${report.target_language_id}/data`} className="btn">
                        Apri lingua importata
                    </Link>
                )}
            </div>
        </div>
    );
}
