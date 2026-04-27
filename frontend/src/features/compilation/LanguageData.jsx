import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api';
import ParameterBlock from './ParameterBlock';

// Mappa colori/etichette per lo status della lingua
const STATUS_META = {
    pending: {
        label: 'Pending',
        bg: '#f1f5f9',
        color: '#475569',
        border: '#cbd5e1',
        icon: '✏️',
        description: 'Stai compilando questa lingua. Le modifiche permangono fra sessioni.'
    },
    waiting_for_approval: {
        label: 'Waiting for approval',
        bg: '#fff8e1',
        color: '#92400e',
        border: '#fcd34d',
        icon: '⏳',
        description: 'In attesa di revisione admin. Compilazione bloccata fino a esito.'
    },
    approved: {
        label: 'Approved',
        bg: '#dcfce7',
        color: '#15803d',
        border: '#86efac',
        icon: '✅',
        description: 'Approvata. Compilazione bloccata.'
    },
    rejected: {
        label: 'Rejected',
        bg: '#fee2e2',
        color: '#b91c1c',
        border: '#fca5a5',
        icon: '⚠️',
        description: 'Rifiutata. Riapri per modificarla e re-inviarla.'
    },
};

export default function LanguageData() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [allExamples, setAllExamples] = useState([]);
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
            setError('Impossibile caricare i dati della lingua.');
        } finally {
            setLoading(false);
        }
    };

    const fetchAllExamples = async () => {
        try {
            const res = await api.get('/api/languages/examples/all');
            setAllExamples(res.data || []);
        } catch (err) {
            console.warn("Impossibile caricare gli esempi globali", err);
        }
    };

    useEffect(() => { fetchCompilationData(); }, [id]);
    useEffect(() => { fetchAllExamples(); }, []);

    const callWorkflow = async (action, body) => {
        try {
            setActionInProgress(true);
            const res = await api.post(`/api/languages/${id}/workflow/${action}`, body || {});
            alert(res.data.detail || 'Operazione eseguita.');
            await fetchCompilationData();
        } catch (err) {
            alert(err.response?.data?.detail || `Errore durante: ${action}`);
        } finally {
            setActionInProgress(false);
        }
    };

    const handleSubmit = () => {
        if (!window.confirm("Inviare questa lingua per approvazione? Dopo l'invio non potrai modificarla finché un admin non la revisiona.")) return;
        callWorkflow('submit');
    };

    const handleApprove = () => {
        if (!window.confirm('Approvare definitivamente questa lingua?')) return;
        callWorkflow('approve');
    };

    const handleReject = () => {
        setRejectNote('');
        setShowRejectModal(true);
    };

    const submitReject = async () => {
        await callWorkflow('reject', { note: rejectNote });
        setShowRejectModal(false);
    };

    const handleReopen = () => {
        if (!window.confirm("Riaprire la compilazione? Lo status tornerà a 'pending' e potrai modificarla.")) return;
        callWorkflow('reopen');
    };

    if (loading) return <div className="container" style={{ marginTop: '2rem' }}>Caricamento...</div>;
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
            <div className="card lang-header-card" style={{ marginBottom: '1rem' }}>
                <h2 style={{ margin: 0 }}>
                    {language.name_full} <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em' }}>({language.id})</span>
                </h2>
            </div>

            {/* Banner Status */}
            <div style={{
                background: meta.bg,
                color: meta.color,
                border: `1px solid ${meta.border}`,
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
                        {meta.icon} {meta.label}
                    </div>
                    <div style={{ fontSize: '0.9rem', marginTop: '0.25rem' }}>{meta.description}</div>
                    {status === 'rejected' && language.rejection_note && (
                        <div style={{
                            background: '#fff',
                            border: '1px solid #fca5a5',
                            borderRadius: '6px',
                            padding: '0.6rem 0.8rem',
                            marginTop: '0.6rem',
                            color: '#7f1d1d',
                            whiteSpace: 'pre-wrap',
                        }}>
                            <strong>Nota dell'admin:</strong> {language.rejection_note}
                        </div>
                    )}
                </div>

                {/* Bottoni di workflow */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                    {/* Submit: solo l'utente assegnato (non admin) */}
                    {!isAdmin && status === 'pending' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleSubmit}>
                            {actionInProgress ? '...' : 'Submit for approval'}
                        </button>
                    )}
                    {/* Reopen: utente assegnato o admin */}
                    {status === 'rejected' && (
                        <button className="btn btn--primary" disabled={actionInProgress} onClick={handleReopen}>
                            {actionInProgress ? '...' : 'Reopen'}
                        </button>
                    )}
                    {/* Approve/Reject: solo admin durante waiting_for_approval */}
                    {status === 'waiting_for_approval' && isAdmin && (
                        <>
                            <button className="btn" style={{ background: '#16a34a', color: '#fff', borderColor: '#15803d' }} disabled={actionInProgress} onClick={handleApprove}>
                                Approve
                            </button>
                            <button className="btn" style={{ background: '#dc2626', color: '#fff', borderColor: '#b91c1c' }} disabled={actionInProgress} onClick={handleReject}>
                                Reject
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Banner override admin: chiarisce che admin sta editando una lingua bloccata */}
            {isAdmin && isLocked && (
                <div style={{
                    background: '#eef2ff',
                    color: '#3730a3',
                    border: '1px solid #c7d2fe',
                    padding: '0.6rem 0.85rem',
                    borderRadius: '6px',
                    marginBottom: '1rem',
                    fontSize: '0.9rem',
                }}>
                    👑 <strong>Admin override:</strong> stai modificando una lingua in stato <code>{status}</code>.
                    Le tue modifiche vengono salvate immediatamente, lo status non cambia automaticamente.
                </div>
            )}

            {/* Modal Reject */}
            {showRejectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '500px', background: '#fff', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0, color: '#b91c1c' }}>Reject Language</h3>
                        <p className="small muted">Inserisci una nota (opzionale) che verrà mostrata all'utente assegnato.</p>
                        <textarea
                            rows="4"
                            value={rejectNote}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder="Es: la sezione X è incompleta, controllare le risposte sui parametri Y..."
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
            <div className="param-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem', background: '#fff', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                {parameters.map((p, idx) => {
                    const { answered = 0, total = 0 } = p.stats || {};
                    const isFlagged = p.is_flagged || false;

                    let bg = '#f8f9fa';
                    let color = '#333';
                    let borderColor = '#ddd';

                    if (isFlagged || (answered > 0 && answered < total)) {
                        bg = '#dc3545';
                        color = '#fff';
                        borderColor = '#a71d2a';
                    } else if (answered === total && total > 0) {
                        bg = '#198754';
                        color = '#fff';
                        borderColor = '#0f5132';
                    }

                    const isActive = idx === activeIndex;

                    return (
                        <button
                            key={p.id}
                            onClick={() => setActiveIndex(idx)}
                            className="param-btn"
                            style={{
                                background: bg,
                                color: color,
                                border: `1px solid ${borderColor}`,
                                borderBottom: isActive ? '3px solid #000' : `1px solid ${borderColor}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '2.5rem',
                                height: '2.5rem',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                padding: 0
                            }}
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
                    allExamples={allExamples}
                    onSaved={() => {
                        fetchCompilationData();
                        fetchAllExamples();
                        if (activeIndex < parameters.length - 1) setActiveIndex(activeIndex + 1);
                    }}
                />
            )}
        </main>
    );
}
