import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

const TYPE_LABELS = {
    terms_of_use: 'Terms of Use',
    privacy_notice: 'Privacy Notice',
};

// Hint testuale mostrato sotto al titolo di ogni card di upload. La copia
// e' "type-specific" — anche se il backend in realta' riconosce il tipo
// leggendo il PDF a prescindere dalla card in cui e' stato caricato, l'admin
// vede istruzioni mirate al singolo documento per coerenza visiva.
const TYPE_HINTS = {
    terms_of_use: 'Il PDF deve contenere "Terms of Use" nel titolo e la stringa "version X.Y" nel testo (es. version 1.0, di solito in header/footer).',
    privacy_notice: 'Il PDF deve contenere "Informativa" nel titolo e la stringa "version X.Y" nel testo (es. version 1.0, di solito in header/footer).',
};

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

/**
 * Pagina admin per gestire i documenti legali.
 *
 * Layout: due card di upload affiancate (Terms of Use / Privacy Notice) +
 * tabella in fondo con lo storico completo. Le due card sono visivamente
 * separate per coerenza con i due tipi di documento: tecnicamente fanno
 * la stessa identica chiamata al backend, e il backend riconosce il tipo
 * leggendo il PDF (non si fida del "type" suggerito dal frontend). Se in
 * futuro nascesse un terzo tipo di documento, aggiungere una terza card
 * e una entry in TYPE_LABELS / TYPE_HINTS.
 */
export default function LegalDocuments() {
    const [docs, setDocs] = useState([]);
    const [loadingList, setLoadingList] = useState(true);
    const [listError, setListError] = useState('');

    const refreshList = async () => {
        setLoadingList(true);
        setListError('');
        try {
            const res = await api.get('/api/admin/legal-documents');
            setDocs(res.data || []);
        } catch (err) {
            setListError(err.response?.data?.detail || 'Error loading documents.');
        } finally {
            setLoadingList(false);
        }
    };

    useEffect(() => {
        refreshList();
    }, []);

    return (
        <div className="container" style={{ maxWidth: '1100px', marginTop: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem' }}>
                <h1>Legal Documents</h1>
                <p className="muted">
                    Gestisci le versioni di <strong>Terms of Use</strong> e
                    <strong> Privacy Notice</strong>. Caricando un nuovo PDF, gli
                    utenti dovranno ri-accettarlo al prossimo login.
                </p>
            </header>

            {/* Due card di upload affiancate. In viewport stretti vanno
                in colonna (auto-fit). */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
                    gap: '1.5rem',
                    marginBottom: '2rem',
                }}
            >
                <UploadCard
                    type="terms_of_use"
                    title="Upload Terms of Use"
                    hint={TYPE_HINTS.terms_of_use}
                    onPublished={refreshList}
                />
                <UploadCard
                    type="privacy_notice"
                    title="Upload Privacy Notice"
                    hint={TYPE_HINTS.privacy_notice}
                    onPublished={refreshList}
                />
            </div>

            <div className="card" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>All versions</h3>

                {loadingList && <div className="muted">Loading...</div>}
                {listError && <div className="alert alert-error">{listError}</div>}

                {!loadingList && !listError && docs.length === 0 && (
                    <div className="muted small">
                        Nessun documento ancora caricato. Carica la prima versione
                        di Terms of Use e Privacy Notice qui sopra.
                    </div>
                )}

                {!loadingList && docs.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Version</th>
                                    <th>Published</th>
                                    <th>Status</th>
                                    <th>File</th>
                                </tr>
                            </thead>
                            <tbody>
                                {docs.map(d => (
                                    <tr key={d.id} style={d.is_current ? { background: 'var(--surface-2, #f1f5f9)' } : undefined}>
                                        <td><strong>{TYPE_LABELS[d.type] || d.type}</strong></td>
                                        <td>{d.version}</td>
                                        <td className="small">{fmtDate(d.published_at)}</td>
                                        <td>
                                            {d.is_current ? (
                                                <span style={{ color: '#15803d', fontWeight: 600 }}>● current</span>
                                            ) : (
                                                <span className="muted small">superseded</span>
                                            )}
                                        </td>
                                        <td>
                                            <a href={d.public_url} target="_blank" rel="noopener noreferrer" className="btn small">
                                                Open
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '1.5rem' }}>
                <Link to="/dashboard" className="btn">Back to dashboard</Link>
            </div>
        </div>
    );
}


/**
 * Card singola di upload. Indipendente dalle altre: ha il suo state
 * (file selezionato, preview, success/error). `type` e' usato SOLO per
 * generare l'id univoco dell'input file (cosi' i reset visivi non
 * confliggono tra le due card); il backend ignora qualunque type passato
 * dal client e riconosce il documento leggendo il PDF.
 *
 * Flow:
 *   1) Select file -> Analyze -> mostra mini-preview (type + version)
 *   2) Confirm -> publish -> banner verde + reset form + refresh tabella
 */
function UploadCard({ type, title, hint, onPublished }) {
    const inputId = `legal-doc-file-${type}`;

    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState('');
    const [analyzing, setAnalyzing] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [publishError, setPublishError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const reset = () => {
        setFile(null);
        setPreview(null);
        setPreviewError('');
        setPublishError('');
        const input = document.getElementById(inputId);
        if (input) input.value = '';
    };

    const handleFile = (e) => {
        setFile(e.target.files[0] || null);
        setPreview(null);
        setPreviewError('');
        setPublishError('');
        setSuccessMsg('');
    };

    const handleAnalyze = async () => {
        if (!file) return;
        setAnalyzing(true);
        setPreview(null);
        setPreviewError('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post(
                '/api/admin/legal-documents/preview',
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            setPreview(res.data);
        } catch (err) {
            setPreviewError(err.response?.data?.detail || 'Errore durante l\'analisi del PDF.');
        } finally {
            setAnalyzing(false);
        }
    };

    const handlePublish = async () => {
        if (!file || !preview || preview.already_exists) return;
        setPublishing(true);
        setPublishError('');
        try {
            const fd = new FormData();
            fd.append('file', file);
            await api.post(
                '/api/admin/legal-documents',
                fd,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            );
            const published = TYPE_LABELS[preview.type] || preview.type;
            setSuccessMsg(`✓ ${published} ${preview.version} pubblicata.`);
            reset();
            await onPublished();
        } catch (err) {
            setPublishError(err.response?.data?.detail || 'Errore durante la pubblicazione.');
        } finally {
            setPublishing(false);
        }
    };

    // Banner di successo: sparisce da solo dopo 4 secondi. Senza un cleanup
    // di useEffect basta cosi' (lo state si resetta al prossimo upload o
    // rimane finche' l'utente non interagisce di nuovo).
    useEffect(() => {
        if (!successMsg) return;
        const id = setTimeout(() => setSuccessMsg(''), 4000);
        return () => clearTimeout(id);
    }, [successMsg]);

    return (
        <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            <p className="small muted" style={{ marginTop: '-0.25rem' }}>{hint}</p>

            {successMsg && (
                <div
                    style={{
                        padding: '0.6rem 0.85rem',
                        borderRadius: '4px',
                        background: '#dcfce7',
                        color: '#166534',
                        border: '1px solid #86efac',
                        marginBottom: '1rem',
                        fontSize: '0.9rem',
                    }}
                >
                    {successMsg}
                </div>
            )}

            <div style={{ marginBottom: '0.75rem' }}>
                <input
                    id={inputId}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFile}
                    disabled={analyzing || publishing}
                    style={{
                        display: 'block', padding: '0.5rem',
                        border: '1px solid var(--border)', borderRadius: '4px',
                        width: '100%',
                    }}
                />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {!preview && (
                    <button
                        type="button"
                        className="btn"
                        onClick={handleAnalyze}
                        disabled={!file || analyzing || publishing}
                    >
                        {analyzing ? 'Analyzing...' : 'Analyze PDF'}
                    </button>
                )}
                {(preview || previewError) && (
                    <button
                        type="button"
                        className="btn"
                        onClick={reset}
                        disabled={analyzing || publishing}
                    >
                        Reset
                    </button>
                )}
            </div>

            {previewError && (
                <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
                    {previewError}
                </div>
            )}

            {preview && (
                <div
                    style={{
                        marginTop: '1rem',
                        padding: '0.85rem 1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: 'var(--surface-2, transparent)',
                    }}
                >
                    <div style={{ marginBottom: '0.5rem' }}>
                        <strong>{TYPE_LABELS[preview.type] || preview.type}</strong>
                        {' '}
                        <span className="muted">{preview.version}</span>
                    </div>
                    {preview.would_replace && (
                        <div className="small muted" style={{ marginBottom: '0.5rem' }}>
                            Sostituira' la versione {preview.would_replace.version}.
                        </div>
                    )}

                    {preview.already_exists && (
                        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
                            Questa versione esiste già. Incrementa il numero di versione nel PDF.
                        </div>
                    )}

                    {publishError && (
                        <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
                            {publishError}
                        </div>
                    )}

                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handlePublish}
                        disabled={publishing || preview.already_exists}
                    >
                        {publishing ? 'Publishing...' : 'Confirm and publish'}
                    </button>
                </div>
            )}
        </div>
    );
}
