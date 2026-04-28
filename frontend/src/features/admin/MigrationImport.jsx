import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function MigrationImport() {
    const [file, setFile] = useState(null);
    const [wipe, setWipe] = useState(true);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [report, setReport] = useState(null);
    const [error, setError] = useState('');

    const canSubmit = !!file && !busy && (!wipe || confirmText === 'WIPE');

    const handleFile = (e) => {
        setFile(e.target.files[0] || null);
        setReport(null);
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        setError('');
        setReport(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post(
                `/api/admin/migration/import-bundle?wipe=${wipe ? 'true' : 'false'}`,
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            setReport(res.data);
        } catch (err) {
            setError(err.response?.data?.detail || 'Error during migration import.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Migration Import (one-shot)</h1>
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
                    <li>Tutte le risposte importate sono salvate come <strong>approved</strong> e il DAG viene eseguito per ogni lingua a fine import (Tabella A e dashboard saranno subito popolate).</li>
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
                        <Link to="/dashboard" className="btn">Cancel</Link>
                        {busy && (
                            <span className="small muted">
                                Operazione lunga (può richiedere alcuni minuti). Non chiudere la pagina.
                            </span>
                        )}
                    </div>
                </form>
            </div>

            {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {report && <MigrationReport report={report} />}
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
                            <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa' }}>
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
