import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// Ordine e pesi delle fasi del backend (in services/migration_import.py).
// I pesi sono stime: compilation e dag sono di gran lunga le fasi piĂą lunghe.
const PHASE_ORDER = [
    'queued',
    'opening_zip',
    'wipe',
    'motivations',
    'parameters',
    'questions',
    'qam',
    'glossary',
    'question_versions',
    'languages',
    'compilation',
    'unsure_flags',
    'dag',
    'admin',
    'done',
];
const PHASE_WEIGHTS = {
    queued: 0,
    opening_zip: 1,
    wipe: 2,
    motivations: 1,
    parameters: 1,
    questions: 1,
    qam: 1,
    glossary: 1,
    question_versions: 1,
    languages: 2,
    compilation: 50,
    unsure_flags: 1,
    dag: 35,
    admin: 1,
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
    // Cap a 99 finchĂ© il backend non risponde finished:true (cosĂ¬ il 100% rappresenta solo il done effettivo).
    return Math.min(99, Math.round((cumulative / TOTAL_WEIGHT) * 100));
}

function fmtElapsed(seconds) {
    if (seconds == null) return '';
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

export default function MigrationImport() {
    const [file, setFile] = useState(null);
    const [wipe, setWipe] = useState(true);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');

    // Job tracking
    const [jobId, setJobId] = useState(null);
    const [jobState, setJobState] = useState(null);
    const [elapsed, setElapsed] = useState(0);
    const startedAtRef = useRef(null);

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
                `/api/admin/migration/import-bundle?wipe=${wipe ? 'true' : 'false'}`,
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
            setError(err.response?.data?.detail || 'Error starting migration import.');
            setBusy(false);
        }
    };

    // Polling dello stato del job.
    // Bug precedente: il guard `if (jobState?.finished)` dentro l'intervallo
    // leggeva una closure stale, quindi le richieste continuavano anche dopo
    // che il job era finito. Ora fermiamo l'interval esplicitamente appena la
    // response dice finished:true.
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
                const res = await api.get(`/api/admin/migration/status/${jobId}`);
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

    // Timer "elapsed" lato client
    useEffect(() => {
        if (!busy) return;
        const id = setInterval(() => {
            if (startedAtRef.current) {
                setElapsed((Date.now() - startedAtRef.current) / 1000);
            }
        }, 500);
        return () => clearInterval(id);
    }, [busy]);

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Restore Database</h1>
                <p className="muted">
                    Carica il <strong>Migration Bundle ZIP</strong> generato dal vecchio sito
                    per popolare il nuovo DB con lingue, parametri, domande, motivazioni e
                    risposte già compilate.
                </p>
            </header>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid #b91c1c' }}>
                <h3 style={{ marginTop: 0, color: '#b91c1c' }}>⚠ Operazione distruttiva</h3>
                <ul className="small" style={{ lineHeight: 1.7, marginBottom: 0 }}>
                    <li>Con <code>wipe</code> attivo, vengono <strong>cancellate tutte le tabelle dati</strong> (lingue, parametri, domande, risposte, esempi, motivazioni, glossario, snapshots, change logs, tassonomia).</li>
                    <li>Gli utenti esistenti NON vengono toccati. Viene comunque (ri)creato l'admin di default con le credenziali da env <code>ADMIN_EMAIL</code>/<code>ADMIN_PASSWORD</code> (default: <code>admin@pcm.local</code>/<code>admin</code>).</li>
                    <li>Tutte le risposte importate sono salvate come <strong>pending</strong> e il DAG viene eseguito per ogni lingua a fine import (Tabella A e dashboard saranno subito popolate).</li>
                    <li>Pensato per essere usato <strong>una sola volta</strong> al primo avvio del nuovo sito. Dopo, nascondi/rimuovi questo bottone.</li>
                </ul>
            </div>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Contenuto atteso del bundle</h3>
                <pre className="small" style={{
                    background: 'var(--surface-2, #f1f3f5)', padding: '1rem',
                    borderRadius: '6px', overflowX: 'auto', margin: 0,
                }}>
{`PCM_migration_<ts>.zip
├── 00_languages.xlsx                       (anagrafica + family/top/group)
├── 01_motivations.xlsx                     (ID, Code, Label)
├── 02_parameters.xlsx                      (ID, Position, Name, ...)
├── 03_questions.xlsx                       (ID, Parameter ID, Text, ...)
├── 04_question_allowed_motivations.xlsx    (Question ID, Motivation Code)
├── 06_glossary.xlsx                        (Word, Description)        [opzionale]
├── 08_unsure_flags.xlsx                    (Language ID, Parameter ID) [opzionale]
└── data/
    ├── <Lingua1>.xlsx                      (foglio Database_model)
    └── ...`}
                </pre>
            </div>

            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                            Bundle ZIP (max 200 MB)
                        </label>
                        <input
                            type="file"
                            accept=".zip"
                            onChange={handleFile}
                            disabled={busy}
                            style={{
                                display: 'block', padding: '0.5rem',
                                border: '1px solid var(--border)', borderRadius: '4px',
                                width: '100%', maxWidth: '500px',
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                                type="checkbox"
                                checked={wipe}
                                onChange={(e) => setWipe(e.target.checked)}
                                disabled={busy}
                            />
                            <span>
                                <strong>Wipe completo</strong> prima dell'import
                                <span className="muted small"> (consigliato per la prima migrazione)</span>
                            </span>
                        </label>
                    </div>

                    {wipe && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.4rem' }}>
                                Per confermare il wipe, scrivi <code>WIPE</code> qui sotto:
                            </label>
                            <input
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                disabled={busy}
                                placeholder="WIPE"
                                style={{
                                    padding: '0.5rem', border: '1px solid var(--border)',
                                    borderRadius: '4px', width: '200px',
                                }}
                            />
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={!canSubmit}
                        >
                            {busy ? 'Importing...' : 'Start migration import'}
                        </button>
                        <Link to="/dashboard" className={`btn ${busy ? 'is-disabled' : ''}`}>Cancel</Link>
                    </div>
                </form>
            </div>

            {busy && (
                <ProgressPanel jobState={jobState} elapsed={elapsed} />
            )}

            {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {report && <MigrationReport report={report} />}
        </div>
    );
}


function ProgressPanel({ jobState, elapsed }) {
    const percent = computeOverallPercent(jobState);
    const phase = jobState?.phase || 'queued';
    const label = jobState?.phase_label || 'Job queued, waiting for backend...';
    const current = jobState?.current || 0;
    const total = jobState?.total || 0;
    const showPhaseCounter = total > 0;

    return (
        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>Migration in progress</h3>
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
                {showPhaseCounter && (
                    <div className="small muted" style={{ whiteSpace: 'nowrap' }}>
                        {current} / {total}
                    </div>
                )}
            </div>

            <div className="small muted" style={{ marginTop: '0.75rem' }}>
                Operazione lunga (può richiedere alcuni minuti). Non chiudere la pagina —
                potrai farlo riaprendola con la stessa URL, ma non vedresti il progresso live.
            </div>
        </div>
    );
}


function MigrationReport({ report }) {
    const sections = report.sections || [];
    const hasErrors = (report.errors?.length || 0) > 0;
    const hasDagFails = (report.languages_dag_failed?.length || 0) > 0;

    return (
        <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>
                {hasErrors || hasDagFails ? 'Migrazione completata con avvertimenti' : 'Migrazione completata'}
            </h3>

            <div className="small muted" style={{ marginBottom: '1rem' }}>
                {report.wipe_performed && <span>✔ Wipe eseguito.&nbsp;</span>}
                {report.admin_email && <span>✔ Admin: <strong>{report.admin_email}</strong>.&nbsp;</span>}
                <span>✔ {report.languages_imported?.length || 0} lingue importate.</span>
            </div>

            <h4 style={{ marginBottom: '0.5rem' }}>Riassunto per sezione</h4>
            <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ marginBottom: '1.5rem' }}>
                    <thead>
                        <tr>
                            <th>Sezione</th>
                            <th style={{ textAlign: 'right' }}>Righe</th>
                            <th style={{ textAlign: 'right' }}>Inseriti</th>
                            <th style={{ textAlign: 'right' }}>Aggiornati</th>
                            <th style={{ textAlign: 'right' }}>Saltati</th>
                            <th style={{ textAlign: 'right' }}>Errori</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sections.map((name) => {
                            const s = report.by_section[name] || {};
                            return (
                                <tr key={name}>
                                    <td><strong>{name}</strong></td>
                                    <td style={{ textAlign: 'right' }}>{s.rows_total || 0}</td>
                                    <td style={{ textAlign: 'right', color: s.inserted > 0 ? '#15803d' : 'inherit' }}>{s.inserted || 0}</td>
                                    <td style={{ textAlign: 'right', color: s.updated > 0 ? '#15803d' : 'inherit' }}>{s.updated || 0}</td>
                                    <td style={{ textAlign: 'right' }}>{s.skipped || 0}</td>
                                    <td style={{
                                        textAlign: 'right',
                                        color: s.errors > 0 ? '#b91c1c' : 'inherit',
                                        fontWeight: s.errors > 0 ? 'bold' : 'normal',
                                    }}>
                                        {s.errors || 0}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {hasDagFails && (
                <>
                    <h4 style={{ marginBottom: '0.5rem' }}>Lingue con DAG fallito ({report.languages_dag_failed.length})</h4>
                    <ul className="small" style={{ marginBottom: '1.5rem', color: '#b91c1c' }}>
                        {report.languages_dag_failed.map((d, i) => (
                            <li key={i}><strong>{d.language_id}</strong>: {d.error}</li>
                        ))}
                    </ul>
                </>
            )}

            {hasErrors && (
                <>
                    <h4 style={{ marginBottom: '0.5rem' }}>Errori ({report.errors.length})</h4>
                    <div style={{
                        maxHeight: '500px', overflowY: 'auto',
                        border: '1px solid var(--border)', borderRadius: '6px',
                    }}>
                        <table className="table" style={{ marginBottom: 0 }}>
                            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)' }}>
                                <tr>
                                    <th>Sezione</th>
                                    <th>Riga</th>
                                    <th>Colonna</th>
                                    <th>Valore</th>
                                    <th>Motivo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.errors.map((e, i) => (
                                    <tr key={i}>
                                        <td className="small">{e.section}</td>
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
                </>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
                <Link to="/languages" className="btn btn--primary">Vai alla lista lingue</Link>
                <Link to="/dashboard" className="btn">Dashboard</Link>
            </div>
        </div>
    );
}
