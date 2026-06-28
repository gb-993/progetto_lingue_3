import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import api from '../../api';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

// Stesso editor di Instructions (TinyMCE), caricato solo quando serve.
const InstructionsEditor = lazy(() => import('../instructions/InstructionsEditor'));

// Pagina super-admin per scrivere l'annuncio "What's New" mostrato agli utenti
// nel modale (vedi components/WhatsNewModal). Riusa lo store site_content
// (chiave whats_new) via gli endpoint /api/whats-new e /api/admin/whats-new.
export default function WhatsNew() {
    const [content, setContent] = useState('');
    const [draft, setDraft] = useState('');
    // Visibilità dell'annuncio: 'all' = tutti gli utenti, 'admins' = solo admin.
    // `audience` è il valore persistito, `draftAudience` quello in modifica.
    const [audience, setAudience] = useState('all');
    const [draftAudience, setDraftAudience] = useState('all');
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const editorRef = useRef(null);

    useEffect(() => {
        api.get('/api/whats-new')
            .then(res => {
                setContent(res.data?.content || '');
                setAudience(res.data?.audience === 'admins' ? 'admins' : 'all');
            })
            .catch(() => setContent(''))
            .finally(() => setLoading(false));
    }, []);

    const startEditing = () => {
        setDraft(content);
        setDraftAudience(audience);
        setError('');
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setDraft('');
        setError('');
        setIsEditing(false);
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const html = editorRef.current ? editorRef.current.getContent() : draft;
            await api.put('/api/admin/whats-new', { content: html, audience: draftAudience });
            setContent(html);
            setAudience(draftAudience);
            setIsEditing(false);
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Save failed. Please retry.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="container mt-2">
                <p className="muted">Loading…</p>
            </div>
        );
    }

    const hasContent = content.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;

    return (
        <div className="container">
            <header
                className="dashboard-hero"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem' }}
            >
                <h1 style={{ margin: 0 }}>What&apos;s New</h1>
                {!isEditing && (
                    <button type="button" className="btn" onClick={startEditing}>
                        Edit
                    </button>
                )}
            </header>

            <p className="muted" style={{ marginTop: '.25rem' }}>
                Annuncio mostrato una volta agli utenti nel modale di benvenuto.
                <strong> Salvare = pubblicare:</strong> se il contenuto è diverso dal precedente, chi rientra nella visibilità lo rivedrà una volta.
                Lasciandolo <strong>vuoto</strong> non viene mostrato nessun annuncio.
                {!isEditing && (
                    <> Visibile attualmente a: <strong>{audience === 'admins' ? 'solo amministratori' : 'tutti gli utenti'}</strong>.</>
                )}
            </p>

            {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ marginTop: '1rem', minHeight: '320px' }}>
                {isEditing ? (
                    <div className="instructions-editor">
                        <Suspense fallback={<p className="muted">Loading editor…</p>}>
                            <InstructionsEditor
                                initialValue={draft}
                                onReady={(editor) => { editorRef.current = editor; }}
                            />
                        </Suspense>

                        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '.9rem' }}>Visibile a:</strong>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="wn-audience"
                                    value="all"
                                    checked={draftAudience === 'all'}
                                    onChange={() => setDraftAudience('all')}
                                    disabled={saving}
                                />
                                Tutti gli utenti
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
                                <input
                                    type="radio"
                                    name="wn-audience"
                                    value="admins"
                                    checked={draftAudience === 'admins'}
                                    onChange={() => setDraftAudience('admins')}
                                    disabled={saving}
                                />
                                Solo amministratori
                            </label>
                        </div>

                        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
                            <button type="button" className="btn" onClick={cancelEditing} disabled={saving}>
                                Cancel
                            </button>
                            <button type="button" className="btn btn--primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Saving…' : 'Save & Publish'}
                            </button>
                        </div>
                    </div>
                ) : hasContent ? (
                    <div className="instructions-view" dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} />
                ) : (
                    <p className="muted">Nessun annuncio pubblicato. Clicca <strong>Edit</strong> per scriverne uno.</p>
                )}
            </div>
        </div>
    );
}
