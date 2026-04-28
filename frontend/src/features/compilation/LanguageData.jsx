import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api';
import ParameterBlock from './ParameterBlock';

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
                    <button
                        type="button"
                        className="btn btn--small"
                        onClick={async () => {
                            try {
                                const res = await api.get(`/api/export/language/${language.id}/xlsx`, { responseType: 'blob' });
                                const cd = res.headers['content-disposition'] || '';
                                const m = cd.match(/filename="?([^";]+)"?/);
                                const filename = m ? m[1] : `PCM_${language.id}.xlsx`;
                                const blob = new Blob([res.data]);
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = filename;
                                document.body.appendChild(a); a.click(); a.remove();
                                URL.revokeObjectURL(url);
                            } catch {
                                alert("Error during export.");
                            }
                        }}
                        title={isAdmin ? "Export everything (Database_model + Examples + Answers + schema)" : "Export the examples of this language"}
                    >
                        Export {isAdmin ? '(.xlsx full)' : '(.xlsx examples)'}
                    </button>
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

                    {/* --- ADMIN: pannello con tutte le force-transitions --- */}
                    {isAdmin && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'flex-end', minWidth: '200px' }}>
                            <span className="small muted" style={{ alignSelf: 'flex-end' }}>Admin: change status</span>
                            {status !== 'approved' && (
                                <button
                                    className="btn"
                                    style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d', width: '100%' }}
                                    disabled={actionInProgress}
                                    onClick={handleForceApprove}
                                >
                                    {actionInProgress ? '...' : 'Approve'}
                                </button>
                            )}
                            {status !== 'rejected' && (
                                <button
                                    className="btn"
                                    style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c', width: '100%' }}
                                    disabled={actionInProgress}
                                    onClick={handleForceReject}
                                >
                                    Reject
                                </button>
                            )}
                            {status !== 'pending' && (
                                <button
                                    className="btn"
                                    style={{ width: '100%' }}
                                    disabled={actionInProgress}
                                    onClick={handleForcePending}
                                >
                                    Mark as Pending
                                </button>
                            )}
                            {status !== 'waiting_for_approval' && (
                                <button
                                    className="btn"
                                    style={{ width: '100%' }}
                                    disabled={actionInProgress}
                                    onClick={handleForceWaiting}
                                >
                                    Mark as Waiting
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Banner override admin: chiarisce che admin sta editando una lingua bloccata */}
            {isAdmin && isLocked && (
                <div className="admin-override-banner">
                    <strong>Admin override:</strong> you are editing a language in <code>{status}</code> state.
                    Your changes are saved immediately and the status does not change automatically.
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
            <div className="param-nav">
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
                            onClick={() => setActiveIndex(idx)}
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
                    onSaved={() => {
                        fetchCompilationData();
                        if (activeIndex < parameters.length - 1) setActiveIndex(activeIndex + 1);
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
            <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text)', lineHeight: 1.4 }}>
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
