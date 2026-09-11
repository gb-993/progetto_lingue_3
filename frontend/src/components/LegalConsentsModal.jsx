import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const TYPE_LABELS = {
    terms_of_use: 'Terms of Use',
    privacy_notice: 'Privacy Notice',
};

const VEXATIOUS_LABELS = {
    '7': 'Limitation of Liability',
    '8': 'Account Suspension or Termination',
    '9.2': 'License Grant (perpetual license on uploaded data)',
    '11': 'Amendments (unilateral modifications)',
};

export default function LegalConsentsModal() {
    const { requiredConsents, acceptConsents, logout } = useAuth();
    const [generalAccepted, setGeneralAccepted] = useState(false);
    const [vexatiousAccepted, setVexatiousAccepted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const requiredSignature = requiredConsents.map(d => d.id).sort().join(',');
    useEffect(() => {
        setGeneralAccepted(false);
        setVexatiousAccepted(false);
        setSubmitting(false);
        setError('');
    }, [requiredSignature]);

    const allVexatious = useMemo(
        () => requiredConsents.flatMap(d => d.vexatious_clauses || []),
        [requiredConsents]
    );
    const hasVexatious = allVexatious.length > 0;

    const vexatiousSections = useMemo(
        () => Array.from(new Set(allVexatious)).sort((a, b) => {
            const na = parseFloat(a), nb = parseFloat(b);
            return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
        }),
        [allVexatious]
    );

    const canSubmit = generalAccepted && (!hasVexatious || vexatiousAccepted) && !submitting;

    const handleAccept = async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError('');
        try {
            await acceptConsents({
                ids: requiredConsents.map(d => d.id),
                vexatiousApproved: vexatiousAccepted,
            });
        } catch (err) {
            setError(err.response?.data?.detail || 'Acceptance failed. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!requiredConsents || requiredConsents.length === 0) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-consents-title"
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '1rem',
            }}
        >
            <div
                className="card"
                style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderRadius: '8px',
                    maxWidth: '720px',
                    width: '100%',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    padding: '1.75rem',
                    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
                }}
            >
                <h2 id="legal-consents-title" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                    Terms of Use and Privacy Notice
                </h2>
                <p className="muted" style={{ marginTop: 0 }}>
                    To continue using the PCM Hub you must review and accept the
                    following document{requiredConsents.length > 1 ? 's' : ''}.
                </p>

                <div style={{ margin: '1.25rem 0' }}>
                    {requiredConsents.map(doc => (
                        <div
                            key={doc.id}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '0.75rem 1rem',
                                border: '1px solid var(--border)',
                                borderRadius: '6px',
                                marginBottom: '0.5rem',
                                background: 'var(--surface-2, transparent)',
                            }}
                        >
                            <div>
                                <strong>{TYPE_LABELS[doc.type] || doc.type}</strong>
                                <span className="muted small" style={{ marginLeft: '0.5rem' }}>
                                    {doc.version}
                                </span>
                            </div>
                            <a
                                href={doc.public_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn"
                            >
                                Open PDF
                            </a>
                        </div>
                    ))}
                </div>

                <label
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.6rem',
                        padding: '0.75rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        marginBottom: '0.75rem',
                    }}
                >
                    <input
                        type="checkbox"
                        checked={generalAccepted}
                        onChange={e => setGeneralAccepted(e.target.checked)}
                        style={{ marginTop: '0.2rem' }}
                    />
                    <span>
                        I have <strong>read and accept</strong> the Terms of Use,
                        and acknowledge the Privacy Notice.
                    </span>
                </label>

                {hasVexatious && (
                    <div
                        style={{
                            padding: '0.75rem 1rem',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            marginBottom: '1rem',
                            background: 'var(--surface-2, transparent)',
                        }}
                    >
                        <p className="small" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                            Pursuant to <strong>art. 1341 of the Italian Civil Code</strong>,
                            I specifically approve the following clauses of the
                            Terms of Use:
                        </p>
                        <ul className="small" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                            {vexatiousSections.map(s => (
                                <li key={s}>
                                    <strong>Section {s}</strong>
                                    {VEXATIOUS_LABELS[s] && (
                                        <> — {VEXATIOUS_LABELS[s]}</>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <label
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '0.6rem',
                                cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={vexatiousAccepted}
                                onChange={e => setVexatiousAccepted(e.target.checked)}
                                style={{ marginTop: '0.2rem' }}
                            />
                            <span>
                                I <strong>specifically approve</strong> the clauses listed above.
                            </span>
                        </label>
                    </div>
                )}

                {error && (
                    <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
                        {error}
                    </div>
                )}

                <div
                    style={{
                        display: 'flex',
                        gap: '0.75rem',
                        justifyContent: 'flex-end',
                        marginTop: '1rem',
                    }}
                >
                    <button
                        type="button"
                        className="btn"
                        onClick={() => logout('/login')}
                        disabled={submitting}
                    >
                        Logout
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handleAccept}
                        disabled={!canSubmit}
                    >
                        {submitting ? 'Saving...' : 'Accept & Continue'}
                    </button>
                </div>
            </div>
        </div>
    );
}
