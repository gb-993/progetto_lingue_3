import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';
import ParameterBlock from './ParameterBlock';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import { readExampleClipboard, clearExampleClipboard } from '../../utils/exampleClipboard';

// Mappa etichette/descrizioni per lo status della lingua.
// I colori sono gestiti via CSS (.status-banner.is-<status>) per supportare dark mode.
const STATUS_META = {
    pending: {
        label: 'Pending',
        description: 'You are filling in this language. Changes persist between sessions.'
    },
    waiting_for_approval: {
        label: 'Waiting for approval',
        description: 'Awaiting admin review. The form is locked until a decision is made.'
    },
    approved: {
        label: 'Approved',
        description: 'Approved. The form is locked.'
    },
    rejected: {
        label: 'Rejected',
        description: 'Rejected. Reopen to edit and resubmit it.'
    },
};

export default function LanguageData() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionInProgress, setActionInProgress] = useState(false);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectNote, setRejectNote] = useState('');
    // Tracciamento delle modifiche non salvate del parametro corrente, sollevate
    // entrambe dal ParameterBlock:
    //  - adminNoteDirty: solo per admin, copre il textarea della admin note
    //  - blockDirty: copre risposte, comments, motivazioni ed esempi di tutte
    //    le questions del parametro (i dati di compilazione del linguista)
    // Insieme attivano il guard di navigazione e il confirm al cambio parametro.
    const [adminNoteDirty, setAdminNoteDirty] = useState(false);
    const [blockDirty, setBlockDirty] = useState(false);
    const anyDirty = adminNoteDirty || blockDirty;
    const [statusMenuOpen, setStatusMenuOpen] = useState(false);
    const statusMenuRef = useRef(null);

    useEffect(() => {
        if (!statusMenuOpen) return;
        const onDocClick = (e) => {
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target)) {
                setStatusMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [statusMenuOpen]);

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

    const handleSubmit = () => {
        if (!window.confirm("Submit this language for approval? Once submitted, you will not be able to edit it until an admin reviews it.")) return;
        callWorkflow('submit');
    };

    const handleReopen = () => {
        if (!window.confirm("Reopen the form? The status will go back to 'pending' and you will be able to edit it.")) return;
        callWorkflow('reopen');
    };

    // Admin: force transitions su qualsiasi stato corrente
    const handleForceApprove = () => {
        if (!window.confirm('Force this language to APPROVED? The DAG will run in background.')) return;
        callWorkflow('admin_force_approve');
    };

    const handleForceReject = () => {
        setRejectNote('');
        setShowRejectModal(true);
    };

    const submitReject = async () => {
        await callWorkflow('admin_force_reject', { note: rejectNote });
        setShowRejectModal(false);
    };

    const handleForcePending = () => {
        if (!window.confirm("Force this language to PENDING? Users will be able to edit it again.")) return;
        callWorkflow('admin_force_pending');
    };

    const handleForceWaiting = () => {
        if (!window.confirm('Force this language to WAITING FOR APPROVAL?')) return;
        callWorkflow('admin_force_waiting');
    };

    if (loading) return <div className="container" style={{ marginTop: '2rem' }}>Loading...</div>;
    if (error) return <div className="container alert alert-error" style={{ marginTop: '2rem' }}>{error}</div>;
    if (!data) return null;

    const { language, parameters } = data;
    const currentParam = parameters[activeIndex];
    const isAdmin = localStorage.getItem('role') === 'admin';

    const status = language.status || 'pending';
    const meta = STATUS_META[status] || STATUS_META.pending;
    const isLocked = status === 'waiting_for_approval' || status === 'approved';
    // Admin può sempre editare a prescindere dallo status; utenti normali vedono il lock.
    const isReadOnly = isAdmin ? false : isLocked;

    return (
        <main className="container" style={{ marginTop: '2rem', paddingBottom: '10rem' }}>

            {/* Header Lingua */}
            <div className="card lang-header-card" style={{ marginBottom: '1rem', padding: '1.5rem 2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0 }}>
                        {language.name_full} <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em' }}>({language.id})</span>
                    </h2>
                    <ExportParametricButton languageId={language.id} isAdmin={isAdmin} />
                </div>

                <LanguageMetaGrid language={language} isAdmin={isAdmin} />
            </div>

            {/* Banner Status */}
            <div className={`status-banner is-${status}`} style={{
                padding: '1rem 1.25rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                display: 'flex',
                gap: '1rem',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
            }}>
                <div style={{ flex: '1 1 300px' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
                        {meta.label}
                    </div>
                    <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{meta.description}</div>
                    {status === 'rejected' && language.rejection_note && (
                        <div className="status-banner__note">
                            <strong>Admin note:</strong> {language.rejection_note}
                        </div>
                    )}
                </div>

                {/* Bottoni di workflow */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                    {/* --- UTENTE NON ADMIN --- */}
                    {!isAdmin && status === 'pending' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleSubmit}>
                            {actionInProgress ? '...' : 'Submit for approval'}
                        </button>
                    )}
                    {!isAdmin && status === 'rejected' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleReopen}>
                            {actionInProgress ? '...' : 'Reopen'}
                        </button>
                    )}

                    {/* --- ADMIN: dropdown status + apply implication --- */}
                    {isAdmin && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end' }}>
                            <span className="small muted">Admin actions</span>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <Link
                                    to={`/languages/${language.id}/debug`}
                                    className="btn"
                                >
                                    Apply implicational condition(s)
                                </Link>
                                <div ref={statusMenuRef} style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        className="btn"
                                        disabled={actionInProgress}
                                        onClick={() => setStatusMenuOpen(o => !o)}
                                    >
                                        {actionInProgress ? '...' : 'Change Status ▾'}
                                    </button>
                                    {statusMenuOpen && (
                                        <div style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 'calc(100% + 4px)',
                                            background: 'var(--surface, #fff)',
                                            border: '1px solid var(--border)',
                                            borderRadius: '6px',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            zIndex: 100,
                                            minWidth: '200px',
                                            padding: '0.4rem',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.3rem',
                                        }}>
                                            {status !== 'approved' && (
                                                <button
                                                    className="btn"
                                                    style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d', width: '100%' }}
                                                    disabled={actionInProgress}
                                                    onClick={() => { setStatusMenuOpen(false); handleForceApprove(); }}
                                                >
                                                    Approve
                                                </button>
                                            )}
                                            {status !== 'rejected' && (
                                                <button
                                                    className="btn"
                                                    style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c', width: '100%' }}
                                                    disabled={actionInProgress}
                                                    onClick={() => { setStatusMenuOpen(false); handleForceReject(); }}
                                                >
                                                    Reject
                                                </button>
                                            )}
                                            {status !== 'pending' && (
                                                <button
                                                    className="btn"
                                                    style={{ width: '100%' }}
                                                    disabled={actionInProgress}
                                                    onClick={() => { setStatusMenuOpen(false); handleForcePending(); }}
                                                >
                                                    Mark as Pending
                                                </button>
                                            )}
                                            {status !== 'waiting_for_approval' && (
                                                <button
                                                    className="btn"
                                                    style={{ width: '100%' }}
                                                    disabled={actionInProgress}
                                                    onClick={() => { setStatusMenuOpen(false); handleForceWaiting(); }}
                                                >
                                                    Mark as Waiting
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Banner override admin: chiarisce che admin sta editando una lingua bloccata */}
            {isAdmin && isLocked && (
                <div className="admin-override-banner">
                    <strong>Admin override:</strong> you are editing a language in <code>{status}</code> state.
                    Your changes are saved immediately but the status does not change automatically.
                </div>
            )}

            {/* Modal Reject */}
            {showRejectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '500px', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0, color: 'var(--bad)' }}>Reject Language</h3>
                        <p className="small muted">Enter a note (optional) that will be shown to the assigned user.</p>
                        <textarea
                            rows="4"
                            value={rejectNote}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder="E.g.: section X is incomplete, please review the answers for parameters Y..."
                            style={{ width: '100%', padding: '0.5rem', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                            <button className="btn" onClick={() => setShowRejectModal(false)}>Cancel</button>
                            <button
                                className="btn"
                                style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c' }}
                                disabled={actionInProgress}
                                onClick={submitReject}
                            >
                                {actionInProgress ? '...' : 'Confirm Reject'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Navigazione Wizard (Quadratini) */}
            <div ref={wizardTopRef} className="param-nav" style={{ scrollMarginTop: '1rem' }}>
                {parameters.map((p, idx) => {
                    const { answered = 0, total = 0 } = p.stats || {};
                    const isFlagged = p.is_flagged || false;

                    let stateClass = 'is-empty';
                    if (isFlagged || (answered > 0 && answered < total)) {
                        stateClass = 'is-incomplete';
                    } else if (answered === total && total > 0) {
                        stateClass = 'is-complete';
                    }

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
                            className={`param-btn ${stateClass}${isActive ? ' is-active' : ''}`}
                            title={isFlagged ? "Marked as unsure" : `Progress: ${answered}/${total}`}
                        >
                            {p.id}
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
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            columnGap: '4rem',
            rowGap: '0.8rem',
            alignItems: 'start',
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Top-level family" value={language.top_level_family} />
                <MetaRow label="Subfamily" value={language.family} />
                <MetaRow label="Historical" value={language.historical_language ? 'Yes' : 'No'} />
                <MetaRow label="ISO code" value={language.isocode} />
                <MetaRow label="Glottocode" value={language.glottocode} />
                <MetaRow label="Location" value={language.location} />
                <MetaRow label="Latitude" value={fmtCoord(language.latitude)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Longitude" value={fmtCoord(language.longitude)} />
                <MetaRow label="Supervisor" value={language.supervisor} />
                <MetaRow label="Informant" value={language.informant} />
                <MetaRow label="Group" value={language.grp} />
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
