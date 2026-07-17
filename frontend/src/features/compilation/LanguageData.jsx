import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import ParameterBlock from './ParameterBlock';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import { readExampleClipboard, clearExampleClipboard } from '../../utils/exampleClipboard';

// ASSE B — Stato di compilazione/review (draft → submitted → validated).
// Volutamente NEUTRO (niente colori traffico): i colori restano all'asse A
// (completamento) per non confondere i due assi.
const STATUS_META = {
    draft: {
        label: 'Draft',
        description: 'You are filling in this language. Changes persist between sessions.'
    },
    submitted: {
        label: 'Under review',
        description: 'Confirmed and awaiting admin review. The form is locked until an admin decides (except for admins).'
    },
    validated: {
        label: 'Validated',
        description: 'Validated by an admin. Read-only for users; admins can still edit it.'
    },
};

// ASSE A — Completamento della lingua (calcolato dai quadratini). I colori
// rispecchiano i quadratini: vuoto→grigio, incompleto→giallo, completo→verde.
const COMPLETION_META = {
    empty: { label: 'Empty', cls: '' },
    incomplete: { label: 'Incomplete', cls: 'warn' },
    complete: { label: 'Complete', cls: 'ok' },
};

// Mappa il colore calcolato dal backend (grey/red/yellow/green) alla classe CSS
// del quadratino e a un tooltip leggibile.
const COLOR_CLASS = { green: 'is-complete', red: 'is-incomplete', yellow: 'is-warning', grey: 'is-empty' };
const COLOR_TITLE = {
    green: 'Complete',
    red: 'Incomplete / missing answers',
    yellow: 'Needs attention (missing examples, test example, or edited question)',
    grey: 'Empty',
};

export default function LanguageData() {
    const { id } = useParams();
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionInProgress, setActionInProgress] = useState(false);
    const [showSendBackModal, setShowSendBackModal] = useState(false);
    const [sendBackNote, setSendBackNote] = useState('');
    // Tracciamento delle modifiche non salvate del parametro corrente, sollevate
    // entrambe dal ParameterBlock:
    //  - adminNoteDirty: solo per admin, copre il textarea della admin note
    //  - blockDirty: copre risposte, comments, motivazioni ed esempi di tutte
    //    le questions del parametro (i dati di compilazione del linguista)
    // Insieme attivano il guard di navigazione e il confirm al cambio parametro.
    const [adminNoteDirty, setAdminNoteDirty] = useState(false);
    const [blockDirty, setBlockDirty] = useState(false);
    const anyDirty = adminNoteDirty || blockDirty;
    const [overrideMenuOpen, setOverrideMenuOpen] = useState(false);
    const overrideMenuRef = useRef(null);

    // Ricerca parametro nel wizard: fa lampeggiare il quadratino trovato per
    // qualche istante, senza cambiare il parametro attivo (niente discard).
    const [searchTerm, setSearchTerm] = useState('');
    const [foundId, setFoundId] = useState(null);
    const [searchMsg, setSearchMsg] = useState('');
    const foundTimerRef = useRef(null);
    useEffect(() => () => { if (foundTimerRef.current) clearTimeout(foundTimerRef.current); }, []);

    useEffect(() => {
        if (!overrideMenuOpen) return;
        const onDocClick = (e) => {
            if (overrideMenuRef.current && !overrideMenuRef.current.contains(e.target)) {
                setOverrideMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [overrideMenuOpen]);

    // Guard unificato: copre chiusura tab/refresh (beforeunload) e navigazione
    // interna React Router (Link, breadcrumb, back-button). Sostituisce il
    // beforeunload custom che proteggeva solo la admin-note: ora copre anche
    // risposte/esempi/motivazioni del blocco corrente.
    useUnsavedChangesGuard(
        anyDirty,
        'You have unsaved changes for this parameter. If you leave now they will be lost. Continue?'
    );

    // Chiamato prima di cambiare parametro nel wizard. Il cambio parametro
    // rimonta ParameterBlock e scarta lo stato locale, quindi qui chiediamo
    // conferma esplicita.
    const confirmDiscardCurrentBlock = () => {
        if (!anyDirty) return true;
        return window.confirm(
            'You have unsaved changes for this parameter. Switching parameter will discard them. Continue?'
        );
    };

    // Scroll automatico in cima al wizard quando si cambia parametro.
    // Evitato al primo mount così l'utente non viene "saltato" su all'apertura.
    const wizardTopRef = useRef(null);
    const skipScrollRef = useRef(true);
    useEffect(() => {
        if (skipScrollRef.current) {
            skipScrollRef.current = false;
            return;
        }
        if (wizardTopRef.current) {
            wizardTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [activeIndex]);

    const fetchCompilationData = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/api/languages/${id}/compilation`);
            setData(res.data);
            setError('');
        } catch (err) {
            console.error(err);
            setError('Could not load the language data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchCompilationData(); }, [id]);

    // Pulisce il clipboard degli esempi quando si entra in una lingua diversa
    // da quella di origine. Evita di trascinare un esempio orfano (con campi
    // di un'altra lingua) attraverso le sessioni di compilazione.
    useEffect(() => {
        const c = readExampleClipboard();
        if (c && c.langId !== id) {
            clearExampleClipboard();
        }
    }, [id]);

    const callWorkflow = async (action, body) => {
        try {
            setActionInProgress(true);
            const res = await api.post(`/api/languages/${id}/workflow/${action}`, body || {});
            alert(res.data.detail || 'Operation completed.');
            await fetchCompilationData();
        } catch (err) {
            alert(err.response?.data?.detail || `Error during: ${action}`);
        } finally {
            setActionInProgress(false);
        }
    };

    // Utente assegnato: conferma la compilazione (draft → submitted)
    const handleSubmit = () => {
        if (!window.confirm("Confirm this language? Once confirmed you will not be able to edit it until an admin reviews it.")) return;
        callWorkflow('submit');
    };

    // Admin: valida (submitted → validated). Diventa sola lettura per tutti; fa girare il DAG.
    const handleValidate = () => {
        if (!window.confirm('Validate this language? It becomes read-only for everyone until an admin reopens it. The DAG will run in background.')) return;
        callWorkflow('validate');
    };

    // Admin: rimanda indietro (submitted → draft) con nota opzionale per l'utente
    const handleSendBack = () => {
        setSendBackNote('');
        setShowSendBackModal(true);
    };

    const submitSendBack = async () => {
        await callWorkflow('send_back', { note: sendBackNote });
        setShowSendBackModal(false);
    };

    // Admin: riapre una lingua validata (validated → draft)
    const handleReopen = () => {
        if (!window.confirm("Reopen this validated language? It goes back to draft and becomes editable again.")) return;
        callWorkflow('reopen');
    };

    // Super-admin: forza/azzera il completamento (asse A). value: 'empty' | 'incomplete' | 'complete' | null (auto)
    const handleSetCompletionOverride = async (value) => {
        setOverrideMenuOpen(false);
        try {
            setActionInProgress(true);
            await api.put(`/api/languages/${id}/completion-override`, { override: value });
            await fetchCompilationData();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error updating the completion override.');
        } finally {
            setActionInProgress(false);
        }
    };

    // Cerca un parametro per id (match esatto, poi sottostringa) o per nome e
    // ne fa lampeggiare il quadratino per ~2,5s. Non apre il parametro.
    const handleParamSearch = (e) => {
        if (e) e.preventDefault();
        const term = searchTerm.trim().toLowerCase();
        if (!term) return;
        const list = (data && data.parameters) || [];
        const match =
            list.find(p => (p.id || '').toLowerCase() === term) ||
            list.find(p => (p.id || '').toLowerCase().includes(term)) ||
            list.find(p => (p.name || '').toLowerCase().includes(term));
        if (!match) {
            setFoundId(null);
            setSearchMsg('No parameter found.');
            return;
        }
        setSearchMsg('');
        if (foundTimerRef.current) clearTimeout(foundTimerRef.current);
        // Azzera e re-imposta al frame successivo così l'animazione riparte
        // anche cercando lo stesso parametro due volte di fila.
        setFoundId(null);
        requestAnimationFrame(() => {
            setFoundId(match.id);
            foundTimerRef.current = setTimeout(() => setFoundId(null), 2500);
        });
    };

    if (loading) return <div className="container" style={{ marginTop: 'var(--form-page-top, 2rem)' }}>Loading...</div>;
    if (error) return <div className="container alert alert-error" style={{ marginTop: 'var(--form-page-top, 2rem)' }}>{error}</div>;
    if (!data) return null;

    const { language, parameters } = data;
    const currentParam = parameters[activeIndex];
    const isAdmin = user?.role === 'admin';
    const isSuperAdmin = !!user?.is_super_admin;

    // Asse B (review)
    const status = language.status || 'draft';
    const meta = STATUS_META[status] || STATUS_META.draft;
    // Asse A (completamento, calcolato dal backend; può essere forzato dal super-admin)
    const completion = language.completion || 'empty';
    const completionMeta = COMPLETION_META[completion] || COMPLETION_META.empty;
    const hasOverride = !!language.completion_override;
    // Lock di scrittura: l'admin può SEMPRE editare (anche submitted/validated);
    // l'utente assegnato solo in draft.
    const isReadOnly = isAdmin ? false : status !== 'draft';

    return (
        <main className="container" style={{ marginTop: 'var(--form-page-top, 2rem)', paddingBottom: '10rem' }}>

            {/* Header Lingua */}
            <div className="card lang-header-card" style={{ marginBottom: '1rem', padding: 'var(--ld-header-pad, 1.5rem 2rem)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: 'var(--form-col-gap, 1.5rem)' }}>
                    <h2 style={{ margin: 0 }}>
                        {language.name_full} <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em' }}>({language.id})</span>
                    </h2>
                    <ExportParametricButton languageId={language.id} isAdmin={isAdmin} />
                </div>

                <LanguageMetaGrid language={language} isAdmin={isAdmin} />
            </div>

            {/* Banner Status */}
            <div className={`status-banner is-${status}`} style={{
                padding: 'var(--ld-banner-pad, 1rem 1.25rem)',
                borderRadius: '8px',
                marginBottom: '1rem',
                display: 'flex',
                gap: '1rem',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
            }}>
                <div style={{ flex: '1 1 300px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{meta.label}</span>
                        <span
                            className={`status ${completionMeta.cls}`}
                            style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem' }}
                            title={hasOverride ? 'Completion forced by a super-admin' : 'Computed from the parameter squares'}
                        >
                            {completionMeta.label}{hasOverride ? ' (forced)' : ''}
                        </span>
                    </div>
                    <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{meta.description}</div>
                    {status === 'draft' && language.rejection_note && (
                        <div className="status-banner__note">
                            <strong>Admin feedback:</strong> {language.rejection_note}
                        </div>
                    )}
                </div>

                {/* Bottoni di workflow */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                    {/* --- UTENTE ASSEGNATO: conferma (draft → submitted) --- */}
                    {!isAdmin && status === 'draft' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleSubmit}>
                            {actionInProgress ? '...' : 'Confirm'}
                        </button>
                    )}

                    {/* --- ADMIN (tutti): review asse B + (super-admin) override asse A --- */}
                    {isAdmin && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                            <span className="small muted">Admin actions</span>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <Link to={`/languages/${language.id}/debug`} className="btn">
                                    Apply implicational condition(s)
                                </Link>
                                {status === 'submitted' && (
                                    <>
                                        <button
                                            className="btn"
                                            style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d' }}
                                            disabled={actionInProgress}
                                            onClick={handleValidate}
                                        >
                                            {actionInProgress ? '...' : 'Validate'}
                                        </button>
                                        <button
                                            className="btn"
                                            style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c' }}
                                            disabled={actionInProgress}
                                            onClick={handleSendBack}
                                        >
                                            {actionInProgress ? '...' : 'Send back'}
                                        </button>
                                    </>
                                )}
                                {status === 'validated' && (
                                    <button className="btn" disabled={actionInProgress} onClick={handleReopen}>
                                        {actionInProgress ? '...' : 'Reopen'}
                                    </button>
                                )}
                            </div>

                            {/* Solo super-admin: forza/azzera il completamento (asse A) */}
                            {isSuperAdmin && (
                                <div ref={overrideMenuRef} style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        className="btn btn--small"
                                        disabled={actionInProgress}
                                        onClick={() => setOverrideMenuOpen(o => !o)}
                                        title="Force or reset the completion (super-admin only)"
                                    >
                                        {actionInProgress ? '...' : `Completion: ${hasOverride ? completionMeta.label + ' (forced)' : 'Auto'} ▾`}
                                    </button>
                                    {overrideMenuOpen && (
                                        <div style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 'calc(100% + 4px)',
                                            background: 'var(--surface, #fff)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '6px',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            zIndex: 100,
                                            minWidth: '210px',
                                            padding: '0.4rem',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.3rem',
                                        }}>
                                            <span className="small muted" style={{ padding: '0 0.2rem' }}>Force completion (super-admin)</span>
                                            <button className="btn" style={{ width: '100%' }} disabled={actionInProgress} onClick={() => handleSetCompletionOverride('empty')}>Empty</button>
                                            <button className="btn" style={{ width: '100%' }} disabled={actionInProgress} onClick={() => handleSetCompletionOverride('incomplete')}>Incomplete</button>
                                            <button className="btn" style={{ width: '100%' }} disabled={actionInProgress} onClick={() => handleSetCompletionOverride('complete')}>Complete</button>
                                            <button className="btn" style={{ width: '100%' }} disabled={actionInProgress || !hasOverride} onClick={() => handleSetCompletionOverride(null)}>Reset to automatic</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal Send back */}
            {showSendBackModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '500px', maxWidth: '92vw', padding: 'var(--form-box-pad-lg, 1.5rem)' }}>
                        <h3 style={{ marginTop: 0, color: 'var(--bad)' }}>Send back to the user</h3>
                        <p className="small muted">The language goes back to draft and the user can edit it again. Enter a note (optional) that will be shown to them.</p>
                        <textarea
                            rows="4"
                            value={sendBackNote}
                            onChange={e => setSendBackNote(e.target.value)}
                            placeholder="E.g.: section X is incomplete, please review the answers for parameters Y..."
                            style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                            <button className="btn" onClick={() => setShowSendBackModal(false)}>Cancel</button>
                            <button
                                className="btn"
                                style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c' }}
                                disabled={actionInProgress}
                                onClick={submitSendBack}
                            >
                                {actionInProgress ? '...' : 'Confirm send back'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Ricerca parametro nel wizard (evidenzia il quadratino, non lo apre) */}
            <form
                onSubmit={handleParamSearch}
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}
            >
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); if (searchMsg) setSearchMsg(''); }}
                    placeholder="Search parameter by id or name…"
                    aria-label="Search parameter"
                    style={{ flex: '0 1 260px', padding: 'var(--form-input-pad, 0.5rem)' }}
                />
                <button type="submit" className="btn btn--small">Search</button>
                {searchMsg && <span className="small muted">{searchMsg}</span>}
            </form>

            {/* Navigazione Wizard (Quadratini) */}
            <div ref={wizardTopRef} className="param-nav" style={{ scrollMarginTop: '1rem' }}>
                {parameters.map((p, idx) => {
                    const { answered = 0, total = 0 } = p.stats || {};
                    // Colore calcolato dal backend: grey/red/yellow/green.
                    const stateClass = COLOR_CLASS[p.color] || 'is-empty';
                    // Giallo "da ricontrollare": una question è stata modificata.
                    const needsReview = !!p.needs_review;

                    const isActive = idx === activeIndex;

                    return (
                        <button
                            key={p.id}
                            onClick={() => {
                                if (idx === activeIndex) return;
                                if (!confirmDiscardCurrentBlock()) return;
                                setAdminNoteDirty(false);
                                setBlockDirty(false);
                                setActiveIndex(idx);
                            }}
                            className={`param-btn ${stateClass}${isActive ? ' is-active' : ''}${p.id === foundId ? ' is-found' : ''}`}
                            title={`${COLOR_TITLE[p.color] || ''} — ${answered}/${total} answered${needsReview ? ' — ✎ a modified question needs re-check & re-save' : ''}`}
                        >
                            {p.id}
                            {needsReview && (
                                <span
                                    className="badge-review"
                                    title="A question was modified — re-check and re-save this parameter"
                                >
                                    ✎
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Blocco Parametro Corrente */}
            {currentParam && (
                <ParameterBlock
                    key={currentParam.id}
                    parameter={currentParam}
                    langId={language.id}
                    isReadOnly={isReadOnly}
                    isAdmin={isAdmin}
                    onAdminNoteDirtyChange={setAdminNoteDirty}
                    onBlockDirtyChange={setBlockDirty}
                    onSaved={async () => {
                        // Aspetta il refetch PRIMA di cambiare parametro: altrimenti
                        // setLoading(true) di fetchCompilationData smonta il wizard
                        // (`Loading...` lo sostituisce) e il ref usato per lo scroll
                        // diventa null nel render in cui activeIndex cambia,
                        // facendo perdere lo scroll automatico in cima.
                        await fetchCompilationData();
                        if (activeIndex < parameters.length - 1) {
                            setAdminNoteDirty(false);
                            setBlockDirty(false);
                            setActiveIndex(activeIndex + 1);
                        }
                    }}
                />
            )}
        </main>
    );
}

function MetaRow({ label, value }) {
    const display = value === null || value === undefined || value === '' ? <span className="muted">—</span> : value;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'baseline', gap: '1rem' }}>
            <span style={{
                fontSize: '0.75rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                textAlign: 'right',
            }}>{label}</span>
            <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text)', lineHeight: 1.4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {display}
            </span>
        </div>
    );
}

function LanguageMetaGrid({ language, isAdmin }) {
    const fmtCoord = (v) => (v === null || v === undefined ? null : Number(v).toFixed(2));
    const assigned = language.assigned_user
        ? `${language.assigned_user.name || ''} ${language.assigned_user.surname || ''}`.trim() || null
        : null;

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: 'var(--ld-meta-colgap, 4rem)',
            rowGap: '0.8rem',
            alignItems: 'flex-start',
        }}>
            {/* Colonna sinistra: classificazione linguistica + identificatori.
                Ha solo valori corti, quindi prende lo spazio dei suoi contenuti
                (con un tetto): tutto il resto va alla colonna destra, che
                contiene i campi lunghi (Source) e arriva fino al margine
                destro della card. Prima erano due colonne al 50% e le fonti,
                strette, si allungavano in verticale lasciando un grande vuoto
                sotto la colonna sinistra. */}
            <div style={{ flex: '0 1 auto', minWidth: 'min(300px, 100%)', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Top-level family" value={language.top_level_family} />
                <MetaRow label="Subfamily" value={language.family} />
                <MetaRow label="Group" value={language.grp} />
                <MetaRow label="Historical" value={language.historical_language ? 'Yes' : 'No'} />
                <MetaRow label="ISO code" value={language.isocode} />
                <MetaRow label="Glottocode" value={language.glottocode} />
            </div>
            {/* Colonna destra: geografia + persone + provenienza. */}
            <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Location" value={language.location} />
                <MetaRow label="Latitude" value={fmtCoord(language.latitude)} />
                <MetaRow label="Longitude" value={fmtCoord(language.longitude)} />
                <MetaRow label="Supervisor" value={language.supervisor} />
                <MetaRow label="Informant" value={language.informant} />
                <MetaRow label="Source" value={language.source} />
                {isAdmin && <MetaRow label="Assigned to" value={assigned} />}
            </div>
        </div>
    );
}


// Bottone export "Parametric data":
//   - Admin: dropdown con Excel (.xlsx) + PDF (.pdf)
//   - User assegnato: bottone semplice "Export examples (.xlsx)" (il backend
//     restituisce comunque solo lo sheet Examples per i non-admin)
function ExportParametricButton({ languageId, isAdmin }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const ref = useRef(null);

    // Chiusura su click fuori dropdown
    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [open]);

    const download = async (format) => {
        setBusy(true);
        try {
            const res = await api.get(
                `/api/export/language/${languageId}/${format}`,
                { responseType: 'blob' }
            );
            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^";]+)"?/);
            const fallback = format === 'pdf'
                ? `PCM_${languageId}.pdf`
                : `PCM_${languageId}.xlsx`;
            const filename = m ? m[1] : fallback;
            const blob = new Blob([res.data]);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch {
            alert("Error during export.");
        } finally {
            setBusy(false);
            setOpen(false);
        }
    };

    // Non-admin: bottone Excel diretto (il PDF e' admin-only)
    if (!isAdmin) {
        return (
            <button
                type="button"
                className="btn btn--small"
                onClick={() => download('xlsx')}
                disabled={busy}
                title="Export the examples of this language"
            >
                {busy ? 'Exporting…' : 'Export examples (.xlsx)'}
            </button>
        );
    }

    // Admin: dropdown
    return (
        <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <button
                type="button"
                className="btn btn--small"
                onClick={() => setOpen(o => !o)}
                disabled={busy}
                title="Export Database_model + Examples + Answers + Admin Notes"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {busy ? 'Exporting…' : 'Export parametric data ▾'}
            </button>
            {open && (
                <div
                    role="menu"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 4px)',
                        right: 0,
                        minWidth: 220,
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
                        zIndex: 50,
                        overflow: 'hidden',
                    }}
                >
                    <DropdownItem onClick={() => download('xlsx')}>Excel (.xlsx)</DropdownItem>
                    <DropdownItem onClick={() => download('pdf')}>PDF (.pdf)</DropdownItem>
                </div>
            )}
        </div>
    );
}

function DropdownItem({ onClick, children }) {
    return (
        <button
            type="button"
            role="menuitem"
            onClick={onClick}
            style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.55rem 0.9rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
            {children}
        </button>
    );
}
