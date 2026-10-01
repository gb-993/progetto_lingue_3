import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../context/AuthContext';
import ParameterBlock from './ParameterBlock';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import { readExampleClipboard, clearExampleClipboard } from '../../utils/exampleClipboard';

// Asse B (review): senza colori
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

// Asse A (completamento): colori dei quadratini
const COMPLETION_META = {
    empty: { label: 'Empty', cls: '' },
    incomplete: { label: 'Incomplete', cls: 'warn' },
    complete: { label: 'Complete', cls: 'ok' },
};

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
    const [adminNoteDirty, setAdminNoteDirty] = useState(false);
    const [blockDirty, setBlockDirty] = useState(false);
    const anyDirty = adminNoteDirty || blockDirty;
    const [overrideMenuOpen, setOverrideMenuOpen] = useState(false);
    const overrideMenuRef = useRef(null);

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

    useUnsavedChangesGuard(
        anyDirty,
        'You have unsaved changes for this parameter. If you leave now they will be lost. Continue?'
    );

    const confirmDiscardCurrentBlock = () => {
        if (!anyDirty) return true;
        return window.confirm(
            'You have unsaved changes for this parameter. Switching parameter will discard them. Continue?'
        );
    };

    const wizardTopRef = useRef(null);
    const skipInitialScrollRef = useRef(true);
    useEffect(() => {
        if (skipInitialScrollRef.current) {
            skipInitialScrollRef.current = false;
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

    useEffect(() => {
        const clipboard = readExampleClipboard();
        if (clipboard && clipboard.langId !== id) {
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
        if (!window.confirm("Confirm this language? Once confirmed you will not be able to edit it until an admin reviews it.")) return;
        callWorkflow('submit');
    };

    const handleValidate = () => {
        if (!window.confirm('Validate this language? It becomes read-only for everyone until an admin reopens it. The DAG will run in background.')) return;
        callWorkflow('validate');
    };

    const handleSendBack = () => {
        setSendBackNote('');
        setShowSendBackModal(true);
    };

    const submitSendBack = async () => {
        await callWorkflow('send_back', { note: sendBackNote });
        setShowSendBackModal(false);
    };

    const handleReopen = () => {
        if (!window.confirm("Reopen this validated language? It goes back to draft and becomes editable again.")) return;
        callWorkflow('reopen');
    };

    // super-admin: null = calcolo automatico
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

    const handleParamSearch = (e) => {
        if (e) e.preventDefault();
        const term = searchTerm.trim().toLowerCase();
        if (!term) return;
        const list = (data && data.parameters) || [];
        const match =
            list.find(param => (param.id || '').toLowerCase() === term) ||
            list.find(param => (param.id || '').toLowerCase().includes(term)) ||
            list.find(param => (param.name || '').toLowerCase().includes(term));
        if (!match) {
            setFoundId(null);
            setSearchMsg('No parameter found.');
            return;
        }
        setSearchMsg('');
        if (foundTimerRef.current) clearTimeout(foundTimerRef.current);
        // così l'animazione riparte ogni volta
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

    const status = language.status || 'draft';
    const meta = STATUS_META[status] || STATUS_META.draft;
    const completion = language.completion || 'empty';
    const completionMeta = COMPLETION_META[completion] || COMPLETION_META.empty;
    const hasOverride = !!language.completion_override;
    const isReadOnly = isAdmin ? false : status !== 'draft';

    return (
        <main className="container" style={{ marginTop: 'var(--form-page-top, 2rem)', paddingBottom: '10rem' }}>

            <div className="card lang-header-card" style={{ marginBottom: '1rem', padding: 'var(--ld-header-pad, 1.5rem 2rem)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: 'var(--form-col-gap, 1.5rem)' }}>
                    <h2 style={{ margin: 0 }}>
                        {language.name_full} <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em' }}>({language.id})</span>
                    </h2>
                    <ExportParametricButton languageId={language.id} isAdmin={isAdmin} />
                </div>

                <LanguageMetaGrid language={language} isAdmin={isAdmin} />
            </div>

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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                    {!isAdmin && status === 'draft' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleSubmit}>
                            {actionInProgress ? '...' : 'Confirm'}
                        </button>
                    )}

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

                            {isSuperAdmin && (
                                <div ref={overrideMenuRef} style={{ position: 'relative' }}>
                                    <button
                                        type="button"
                                        className="btn btn--small"
                                        disabled={actionInProgress}
                                        onClick={() => setOverrideMenuOpen(open => !open)}
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

            <div ref={wizardTopRef} className="param-nav" style={{ scrollMarginTop: '1rem' }}>
                {parameters.map((param, idx) => {
                    const { answered = 0, total = 0 } = param.stats || {};
                    const stateClass = COLOR_CLASS[param.color] || 'is-empty';
                    const needsReview = !!param.needs_review;

                    const isActive = idx === activeIndex;

                    return (
                        <button
                            key={param.id}
                            onClick={() => {
                                if (idx === activeIndex) return;
                                if (!confirmDiscardCurrentBlock()) return;
                                setAdminNoteDirty(false);
                                setBlockDirty(false);
                                setActiveIndex(idx);
                            }}
                            className={`param-btn ${stateClass}${isActive ? ' is-active' : ''}${param.id === foundId ? ' is-found' : ''}`}
                            title={`${COLOR_TITLE[param.color] || ''} — ${answered}/${total} answered${needsReview ? ' — ✎ a modified question needs re-check & re-save' : ''}`}
                        >
                            {param.id}
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
                        // prima ricarica, poi avanza
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
    const formatCoord = (value) => (value === null || value === undefined ? null : Number(value).toFixed(2));
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
            <div style={{ flex: '0 1 auto', minWidth: 'min(300px, 100%)', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Top-level family" value={language.top_level_family} />
                <MetaRow label="Subfamily" value={language.family} />
                <MetaRow label="Group" value={language.grp} />
                <MetaRow label="Historical" value={language.historical_language ? 'Yes' : 'No'} />
                <MetaRow label="ISO code" value={language.isocode} />
                <MetaRow label="Glottocode" value={language.glottocode} />
            </div>
            <div style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <MetaRow label="Location" value={language.location} />
                <MetaRow label="Latitude" value={formatCoord(language.latitude)} />
                <MetaRow label="Longitude" value={formatCoord(language.longitude)} />
                <MetaRow label="Supervisor" value={language.supervisor} />
                <MetaRow label="Informant" value={language.informant} />
                <MetaRow label="Source" value={language.source} />
                {isAdmin && <MetaRow label="Assigned to" value={assigned} />}
            </div>
        </div>
    );
}

function ExportParametricButton({ languageId, isAdmin }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
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
            const contentDisposition = res.headers['content-disposition'] || '';
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            const fallback = format === 'pdf'
                ? `PCM_${languageId}.pdf`
                : `PCM_${languageId}.xlsx`;
            const filename = filenameMatch ? filenameMatch[1] : fallback;
            const blob = new Blob([res.data]);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url; link.download = filename;
            document.body.appendChild(link); link.click(); link.remove();
            URL.revokeObjectURL(url);
        } catch {
            alert("Error during export.");
        } finally {
            setBusy(false);
            setOpen(false);
        }
    };

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

    return (
        <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
            <button
                type="button"
                className="btn btn--small"
                onClick={() => setOpen(prev => !prev)}
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
