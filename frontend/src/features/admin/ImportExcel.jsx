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
            setError(err.response?.data?.detail || 'Error during import.');
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
            alert("Error downloading the report.");
        }
    };

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Import from Excel</h1>
                <p className="muted">
                    Upload an Excel file to import schema (Motivations, Parameters, Questions, QAM)
                    and/or filled-in data of a single language (sheet <code>Database_model</code>).
                </p>
            </header>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Strategy</h3>
                <ul className="small" style={{ lineHeight: 1.8, marginBottom: 0 }}>
                    <li><strong>Schema</strong> (Motivations / Parameters / Questions / QAM): <em>strict update</em>. If the <code>id</code> exists in the DB, the fields are replaced with the value from the file. If the <code>id</code> does not exist, the row is an error (skipped, included in the report). Entities not mentioned in the file remain untouched.</li>
                    <li><strong>Database_model</strong>: <em>full replace</em> of the language. All answers/examples/motivations for the language are deleted, then only valid rows are inserted. Invalid rows remain empty (unanswered) and are included in the report.</li>
                    <li><strong>Cascading errors</strong>: if a motivation/question fails, the dependent rows generate an explicit error (never silent).</li>
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
                            <span className="small muted">Do not close the page until completion.</span>
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
                    {hasErrors ? 'Import completed with errors' : 'Import completed'}
                </h3>
                {hasErrors && (
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={onDownloadErrors}
                    >
                        Download error report (.xlsx)
                    </button>
                )}
            </div>

            {report.target_language_name && (
                <p className="small muted" style={{ marginTop: 0 }}>
                    Language processed: <strong>{report.target_language_name}</strong>
                    {report.target_language_id && <span> ({report.target_language_id})</span>}
                </p>
            )}

            {/* Summary per sheet */}
            <h4 style={{ marginBottom: '0.5rem' }}>Per-sheet summary</h4>
            {sheets.length === 0 ? (
                <p className="small muted">No sheet recognised in the file.</p>
            ) : (
                <table className="table" style={{ marginBottom: '1.5rem' }}>
                    <thead>
                        <tr>
                            <th>Sheet</th>
                            <th style={{ textAlign: 'right' }}>Rows</th>
                            <th style={{ textAlign: 'right' }}>Updated</th>
                            <th style={{ textAlign: 'right' }}>Inserted</th>
                            <th style={{ textAlign: 'right' }}>Skipped</th>
                            <th style={{ textAlign: 'right' }}>Errors</th>
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
                    <h4 style={{ marginBottom: '0.5rem' }}>Errors ({totalErrors})</h4>
                    <div style={{
                        maxHeight: '500px', overflowY: 'auto',
                        border: '1px solid var(--border)', borderRadius: '6px',
                    }}>
                        <table className="table" style={{ marginBottom: 0 }}>
                            <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa' }}>
                                <tr>
                                    <th>Sheet</th>
                                    <th>Row</th>
                                    <th>Column</th>
                                    <th>Value</th>
                                    <th>Reason</th>
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
                        Tip: download the report with <strong>Download error report (.xlsx)</strong>,
                        fix the errors in the source file and re-import.
                    </p>
                </>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
                <Link to="/languages" className="btn btn--primary">Go to languages list</Link>
                {report.target_language_id && (
                    <Link to={`/languages/${report.target_language_id}/data`} className="btn">
                        Open imported language
                    </Link>
                )}
            </div>
        </div>
    );
}
