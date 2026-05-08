import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// Fasi del backend in services/backup_restore.py.
const PHASE_ORDER = [
    'queued',
    'wipe',
    'schema',
    'metadata',
    'glossary',
    'compilation',
    'extras',
    'recompute',
    'done',
];
// Compilation è la fase che domina nel tempo: contiene un xlsx per lingua.
const PHASE_WEIGHTS = {
    queued: 0,
    wipe: 1,
    schema: 2,
    metadata: 1,
    glossary: 1,
    compilation: 80,
    extras: 4,
    recompute: 10,
    done: 0,
};
const TOTAL_WEIGHT = Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0);

function computeOverallPercent(state) {
    if (!state) return 0;
    if (state.finished) return state.error ? 0 : 100;
    const idx = PHASE_ORDER.indexOf(state.phase);
    if (idx < 0) return 0;
    let cumulative = 0;
    for (let i = 0; i < idx; i++) {
        cumulative += PHASE_WEIGHTS[PHASE_ORDER[i]] || 0;
    }
    const phaseWeight = PHASE_WEIGHTS[state.phase] || 0;
    const phaseFraction = state.total > 0 ? Math.min(1, (state.current || 0) / state.total) : 0;
    cumulative += phaseWeight * phaseFraction;
    return Math.min(99, Math.round((cumulative / TOTAL_WEIGHT) * 100));
}

function fmtElapsed(seconds) {
    if (seconds == null) return '';
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export default function BackupRestore() {
    const [file, setFile] = useState(null);
    const [wipe, setWipe] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');

    const [jobId, setJobId] = useState(null);
    const [jobState, setJobState] = useState(null);
    const [elapsed, setElapsed] = useState(0);
    const startedAtRef = useRef(null);

    // Export full backup: stato indipendente dal restore. { jobId, state, error }
    const [exportJob, setExportJob] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [exportElapsed, setExportElapsed] = useState(0);
    const exportStartedAtRef = useRef(null);

    const canSubmit = !!file && !busy && (!wipe || confirmText === 'WIPE');

    const handleFile = (e) => {
        setFile(e.target.files[0] || null);
        setReport(null);
        setError('');
        setJobId(null);
        setJobState(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        setError('');
        setReport(null);
        setJobId(null);
        setJobState(null);
        startedAtRef.current = Date.now();
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post(
                `/api/admin/backup-restore?wipe=${wipe ? 'true' : 'false'}`,
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            if (res.data?.job_id) {
                setJobId(res.data.job_id);
            } else {
                setError('Server did not return a job_id.');
                setBusy(false);
            }
        } catch (err) {
            setError(err.response?.data?.detail || 'Error starting backup restore.');
            setBusy(false);
        }
    };

    // Polling status job
    useEffect(() => {
        if (!jobId) return;
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
                const res = await api.get(`/api/admin/backup-restore/status/${jobId}`);
                if (cancelled) return;
                setJobState(res.data);
                if (res.data.finished) {
                    stopPolling();
                    if (res.data.error) {
                        setError(res.data.error);
                    } else {
                        setReport(res.data.report);
                    }
                    setBusy(false);
                }
            } catch (err) {
                if (cancelled) return;
                stopPolling();
                setError(err.response?.data?.detail || 'Error polling job status.');
                setBusy(false);
            }
        };

        poll();
        intervalId = setInterval(poll, 1500);

        return () => {
            cancelled = true;
            stopPolling();
        };
    }, [jobId]);

    // Timer client-side
    useEffect(() => {
        if (!busy) return;
        const id = setInterval(() => {
            if (startedAtRef.current) {
                setElapsed((Date.now() - startedAtRef.current) / 1000);
            }
        }, 500);
        return () => clearInterval(id);
    }, [busy]);

    // Export full backup: avvia il job, fa polling, scarica al termine.
    const handleStartFullBackup = async () => {
        setExporting(true);
        setExportJob(null);
        exportStartedAtRef.current = Date.now();
        try {
            const res = await api.post('/api/admin/export/full-backup/zip', {});
            const newJobId = res.data?.job_id;
            if (!newJobId) throw new Error('Server did not return a job_id.');
            setExportJob({ jobId: newJobId, state: null, error: null });
        } catch (err) {
            alert(err.response?.data?.detail || err.message || 'Could not start the full backup.');
            setExporting(false);
        }
    };

    // Polling export job + auto-download a fine job
    useEffect(() => {
        if (!exportJob?.jobId) return;
        const exportJobId = exportJob.jobId;
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
                    `/api/admin/export/full-backup/zip/download/${exportJobId}`,
                    { responseType: 'blob' }
                );
                const cd = res.headers['content-disposition'] || '';
                const m = cd.match(/filename="?([^";]+)"?/);
                const filename = m ? m[1] : 'PCM_full_backup.zip';
                const blob = new Blob([res.data]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            } catch (err) {
                alert(err.response?.data?.detail || 'Could not download the full backup file.');
            }
        };

        const poll = async () => {
            try {
                const res = await api.get(`/api/admin/export/full-backup/zip/status/${exportJobId}`);
                if (cancelled) return;
                setExportJob(prev => prev?.jobId === exportJobId ? { ...prev, state: res.data } : prev);
                if (res.data.finished) {
                    stopPolling();
                    if (res.data.error) {
                        setExportJob(prev => prev?.jobId === exportJobId ? { ...prev, error: res.data.error } : prev);
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
                alert(err.response?.data?.detail || 'Error polling export job.');
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

    // Timer client-side per export
    useEffect(() => {
        if (!exporting) return;
        const id = setInterval(() => {
            if (exportStartedAtRef.current) {
                setExportElapsed((Date.now() - exportStartedAtRef.current) / 1000);
            }
        }, 500);
        return () => clearInterval(id);
    }, [exporting]);

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Backup &amp; Restore</h1>
                <p className="muted">
                    Download a complete site backup for disaster recovery, or upload a
                    backup zip to restore schema, languages, glossary, compilation data
                    and (when present) site content / submissions / archived questions.
                </p>
            </header>

            {/* === Export full backup === */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Export full backup</h3>
                <p className="small" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                    Generates a <code>PCM_full_backup_*.zip</code> with everything the
                    standard backup contains plus the site&apos;s satellite data:
                    editable site content, submission history, parameter submission
                    snapshots and archived questions. Users are <strong>not</strong> included
                    (manage them via your DB tooling).
                </p>
                <details style={{ marginBottom: '0.75rem' }}>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>
                        What&apos;s the difference vs the standard backup?
                    </summary>
                    <ul className="small" style={{ lineHeight: 1.7, marginTop: '0.5rem', marginBottom: 0 }}>
                        <li>
                            The standard <code>PCM_backup.zip</code> (from <em>Languages → Download data</em>)
                            contains schema + languages + glossary. Use it for sharing or partial restore.
                        </li>
                        <li>
                            The full backup adds an <code>extras/</code> folder with{' '}
                            <code>site_content.xlsx</code>, <code>submissions.xlsx</code>,{' '}
                            <code>parameter_submissions.xlsx</code>, <code>archived_questions.xlsx</code>.
                            Use it for emergency recovery.
                        </li>
                        <li>
                            On restore, the snapshot tables (submissions, parameter
                            submissions, archived questions) are repopulated only when
                            the <strong>wipe</strong> option is enabled.
                        </li>
                    </ul>
                </details>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handleStartFullBackup}
                        disabled={exporting}
                    >
                        {exporting ? 'Generating…' : 'Download full backup (.zip)'}
                    </button>
                </div>

                {(exporting || exportJob?.error) && (
                    <ExportProgressPanel
                        jobState={exportJob?.state}
                        elapsed={exportElapsed}
                        error={exportJob?.error}
                    />
                )}
            </div>

            {/* === Restore section === */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>How to get the bundle for restore</h3>
                <ol className="small" style={{ lineHeight: 1.7, marginTop: 0, marginBottom: '0.75rem', paddingLeft: '1.25rem' }}>
                    <li>
                        Use the <strong>Download full backup</strong> button above for a
                        disaster-recovery snapshot, or open the{' '}
                        <Link to="/languages" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
                            Languages
                        </Link>{' '}
                        page and pick <strong>Download Data ▾ → Export backup (.zip)</strong>{' '}
                        for the lighter linguistic-data-only snapshot.
                    </li>
                    <li>Save the <code>PCM_*backup_*.zip</code> file and upload it below.</li>
                </ol>
                <details>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>
                        Files contained in the zip (technical reference)
                    </summary>
                    <ul className="small" style={{ lineHeight: 1.7, marginTop: '0.5rem', marginBottom: 0 }}>
                        <li><code>schema.xlsx</code> — Motivations / Parameters / Questions / QAM</li>
                        <li><code>languages_metadata.xlsx</code> — metadata for all languages</li>
                        <li><code>glossary.xlsx</code> — Word / Description</li>
                        <li><code>languages/&lt;ID&gt;.xlsx</code> — one file per language with answers, examples, motivations and admin notes</li>
                        <li><code>extras/*.xlsx</code> (full backup only) — site content, submissions history, parameter submissions, archived questions</li>
                    </ul>
                </details>
            </div>

            {wipe && (
                <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid #b91c1c' }}>
                    <h3 style={{ marginTop: 0, color: '#b91c1c' }}>⚠ Destructive operation</h3>
                    <ul className="small" style={{ lineHeight: 1.7, marginBottom: 0 }}>
                        <li>With <code>wipe</code> enabled, <strong>all data tables are deleted</strong> before the restore (schema, languages, answers, examples, motivations, glossary, snapshots, change logs, taxonomy, site content, archived questions, parameter submissions).</li>
                        <li>Users are NOT affected.</li>
                        <li>Without wipe, the restore is an <strong>upsert</strong>: it updates or adds the rows present in the bundle, but does not remove those not mentioned.</li>
                    </ul>
                </div>
            )}

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="form-label" htmlFor="backupFile">
                            Backup ZIP file
                        </label>
                        <input
                            id="backupFile"
                            type="file"
                            accept=".zip"
                            onChange={handleFile}
                            disabled={busy}
                            style={{ display: 'block', marginTop: '0.4rem' }}
                        />
                        {file && (
                            <div className="small muted" style={{ marginTop: '0.4rem' }}>
                                Selected: <strong>{file.name}</strong> · {(file.size / (1024 * 1024)).toFixed(2)} MB
                            </div>
                        )}
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={wipe}
                            onChange={(e) => { setWipe(e.target.checked); setConfirmText(''); }}
                            disabled={busy}
                        />
                        <span><strong>Wipe data tables before restore</strong> (destructive)</span>
                    </label>

                    {wipe && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="form-label small" htmlFor="wipeConfirm">
                                Type <code>WIPE</code> to confirm:
                            </label>
                            <input
                                id="wipeConfirm"
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                disabled={busy}
                                style={{ marginTop: '0.3rem' }}
                            />
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                            {busy ? 'Restoring…' : 'Start restore'}
                        </button>
                        <Link to="/admin/migration-import" className="btn btn--ghost btn--small" style={{ alignSelf: 'center' }}>
                            ← Need Migration Import instead?
                        </Link>
                    </div>
                </form>
            </div>

            {(busy || jobState) && (
                <ProgressPanel jobState={jobState} elapsed={elapsed} />
            )}

            {error && (
                <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', borderLeft: '4px solid #b91c1c', color: '#b91c1c' }}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            {report && <RestoreReport report={report} />}
        </div>
    );
}


function ProgressPanel({ jobState, elapsed }) {
    const percent = computeOverallPercent(jobState);
    const phase = jobState?.phase || 'queued';
    const label = jobState?.phase_label || 'Job queued, waiting for backend…';
    const current = jobState?.current || 0;
    const total = jobState?.total || 0;
    const showCounter = total > 0;

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Restore in progress</h3>
                <span className="small muted">
                    Elapsed: {fmtElapsed(elapsed)}
                </span>
            </div>

            <div style={{
                position: 'relative',
                width: '100%',
                height: '22px',
                background: 'var(--surface-2)',
                borderRadius: '11px',
                overflow: 'hidden',
                border: '1px solid var(--border)',
                marginBottom: '0.75rem',
            }}>
                <div style={{
                    width: `${percent}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, var(--brand, #3b82f6), #6366f1)',
                    transition: 'width 0.4s ease',
                }} />
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)',
                    mixBlendMode: 'difference',
                }}>
                    {percent}%
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div className="small">
                    <strong>Phase:</strong> {phase}{' '}
                    <span className="muted">— {label}</span>
                </div>
                {showCounter && (
                    <div className="small muted" style={{ whiteSpace: 'nowrap' }}>
                        {current} / {total}
                    </div>
                )}
            </div>
        </div>
    );
}


function ExportProgressPanel({ jobState, elapsed, error }) {
    // Export ha una sola fase ("building"): la percentuale è semplicemente
    // current/total. Più semplice del restore che ha più fasi pesate.
    const current = jobState?.current || 0;
    const total = jobState?.total || 0;
    const percent = total > 0 ? Math.min(99, Math.round((current / total) * 100)) : 0;
    const finished = jobState?.finished;
    const displayPercent = finished && !error ? 100 : percent;
    const label = jobState?.phase_label || (finished ? (error ? 'Failed' : 'Done') : 'Starting…');

    return (
        <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="small"><strong>{label}</strong></span>
                <span className="small muted">
                    {total > 0 && `${current} / ${total} · `}
                    Elapsed: {fmtElapsed(elapsed)}
                </span>
            </div>
            <div style={{
                position: 'relative',
                width: '100%',
                height: '18px',
                background: 'var(--surface-2)',
                borderRadius: '9px',
                overflow: 'hidden',
                border: '1px solid var(--border)',
            }}>
                <div style={{
                    width: `${displayPercent}%`,
                    height: '100%',
                    background: error
                        ? '#b91c1c'
                        : 'linear-gradient(90deg, var(--brand, #3b82f6), #6366f1)',
                    transition: 'width 0.4s ease',
                }} />
                <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.72rem', fontWeight: 700, color: 'var(--text)',
                    mixBlendMode: 'difference',
                }}>
                    {displayPercent}%
                </div>
            </div>
            {error && (
                <div className="small" style={{ marginTop: '0.5rem', color: '#b91c1c' }}>
                    <strong>Error:</strong> {error}
                </div>
            )}
        </div>
    );
}


function RestoreReport({ report }) {
    const filesProcessed = report.files_processed || [];
    const filesSkipped = report.files_skipped || [];
    const langsRestored = report.languages_restored || [];
    const langsFailed = report.languages_failed || [];
    const errors = report.errors || [];
    const hasErrors = errors.length > 0 || langsFailed.length > 0;

    return (
        <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>
                {hasErrors ? 'Restore completed with warnings' : 'Restore completed'}
            </h3>
            <div className="small" style={{ marginBottom: '0.75rem' }}>
                <strong>Files processed:</strong> {filesProcessed.length}
                {filesSkipped.length > 0 && (
                    <span className="muted"> · {filesSkipped.length} skipped</span>
                )}
                {' · '}
                <strong>Languages:</strong> {langsRestored.length} restored
                {langsFailed.length > 0 && (
                    <span style={{ color: '#b91c1c' }}>, {langsFailed.length} failed</span>
                )}
                {' · '}
                <strong>Errors:</strong> {errors.length}
            </div>

            {langsFailed.length > 0 && (
                <div className="small" style={{ marginBottom: '0.5rem' }}>
                    <strong style={{ color: '#b91c1c' }}>Failed languages:</strong>{' '}
                    {langsFailed.join(', ')}
                </div>
            )}

            {errors.length > 0 && (
                <details style={{ marginTop: '0.75rem' }}>
                    <summary className="small" style={{ cursor: 'pointer' }}>
                        Show {errors.length} error(s)
                    </summary>
                    <ul className="small" style={{ marginTop: '0.5rem', maxHeight: '300px', overflow: 'auto' }}>
                        {errors.slice(0, 200).map((e, i) => (
                            <li key={i}>
                                <code>{e._file || e.sheet || '?'}</code>
                                {e.row ? `, row ${e.row}` : ''}
                                {e.value ? ` (${e.value})` : ''}
                                {' — '}
                                {e.reason}
                            </li>
                        ))}
                        {errors.length > 200 && (
                            <li className="muted">…and {errors.length - 200} more</li>
                        )}
                    </ul>
                </details>
            )}
        </div>
    );
}
