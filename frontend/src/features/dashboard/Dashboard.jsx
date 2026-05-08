import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ===== Palette status (coerente con LanguageList / LanguageData) =====
const STATUS_BADGE = {
    pending: { label: 'Pending', cls: '' },
    waiting_for_approval: { label: 'Waiting', cls: 'warn' },
    approved: { label: 'Approved', cls: 'ok' },
    rejected: { label: 'Rejected', cls: 'bad' },
};

function StatusBadge({ status }) {
    const meta = STATUS_BADGE[status] || STATUS_BADGE.pending;
    return (
        <span className={`status ${meta.cls}`} style={{ fontSize: '0.72rem', padding: '0.1rem 0.5rem' }}>
            {meta.label}
        </span>
    );
}

const fmtDateShort = (iso) => iso ? new Date(iso).toLocaleDateString() : '—';

// ============================================================================
// Dashboard Root
// ============================================================================
export default function Dashboard() {
    const role = localStorage.getItem('role');
    const name = localStorage.getItem('name') || '';

    return (
        <>
            <header className="dashboard-hero" style={{ marginBottom: '1.25rem' }}>
                <h1 style={{ margin: 0 }}>Welcome, {name}</h1>
            </header>

            {role === 'admin' ? <AdminDashboard /> : <UserDashboard />}
        </>
    );
}

// ============================================================================
// ADMIN — layout 50/50 (left: 4 counter card; right: latest changes table)
// ============================================================================
function AdminDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get('/api/admin/dashboard')
            .then(res => setData(res.data))
            .catch(err => setError(err.response?.data?.detail || 'Error loading the dashboard.'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="container">Loading...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;
    if (!data) return null;

    const { stats, to_review, recent_changes, red_by_language, languages_by_status } = data;

    return (
        <div className="dashboard-grid-admin">
            <div className="admin-counters">
                <PendingApprovalsCard count={stats.to_review_count} items={to_review} />
                <LanguagesByStatusCard byStatus={stats.by_status} byStatusList={languages_by_status} />
                <RedParamsCard total={stats.total_red_params} languages={red_by_language} />
            </div>
            <div className="admin-activity">
                <LatestChangesCard items={recent_changes} />
            </div>
        </div>
    );
}

// ----- Card 1: Pending Approvals -----
function PendingApprovalsCard({ count, items }) {
    return (
        <div className={`card counter-card${count > 0 ? ' border-bad' : ''}`}>
            <h3 className="admin-label">Waiting for Approval</h3>
            <div className="admin-big-number">{count}</div>
            {items.length > 0 ? (
                <div style={{ marginTop: '0.3rem', maxHeight: '120px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    {items.map(l => (
                        <div key={l.id} style={{ marginBottom: '0.2rem', fontSize: '0.85rem' }}>
                            <Link
                                to={`/languages/${l.id}/data`}
                                style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--brand)' }}
                            >
                                → Review {l.name_full}
                            </Link>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="muted small" style={{ margin: '0.15rem 0 0' }}>No waiting reviews.</p>
            )}
        </div>
    );
}

// ----- Card 2: Languages by Status -----
function LanguagesByStatusCard({ byStatus, byStatusList }) {
    const safe = byStatus || {};
    const lists = byStatusList || {};
    const [expanded, setExpanded] = useState(null);

    const total =
        (safe.pending || 0) +
        (safe.waiting_for_approval || 0) +
        (safe.approved || 0) +
        (safe.rejected || 0);

    const cells = [
        { key: 'pending', label: 'Pending', color: 'var(--text-muted)' },
        { key: 'waiting_for_approval', label: 'Waiting', color: '#92400e' },
        { key: 'approved', label: 'Approved', color: 'var(--ok)' },
        { key: 'rejected', label: 'Rejected', color: 'var(--bad)' },
    ];

    const toggle = (key) => setExpanded(prev => (prev === key ? null : key));
    const expandedCell = cells.find(c => c.key === expanded);
    const expandedList = expanded ? (lists[expanded] || []) : [];

    return (
        <div className="card counter-card">
            <h3 className="admin-label">Languages by Status</h3>
            <div className="status-grid">
                {cells.map(c => {
                    const isActive = expanded === c.key;
                    return (
                        <button
                            key={c.key}
                            type="button"
                            onClick={() => toggle(c.key)}
                            className={`status-cell${isActive ? ' is-active' : ''}`}
                            title={`Show ${c.label.toLowerCase()} languages`}
                        >
                            <div className="status-num" style={{ color: c.color }}>
                                {safe[c.key] || 0}
                            </div>
                            <div className="status-lab">{c.label}</div>
                        </button>
                    );
                })}
            </div>

            {expanded && (
                <div style={{
                    marginTop: '0.4rem',
                    border: '1px solid var(--border)',
                    borderRadius: '5px',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                }}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border)',
                        fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
                    }}>
                        <span>{expandedCell?.label} ({expandedList.length})</span>
                        <button
                            type="button"
                            onClick={() => setExpanded(null)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.2rem',
                            }}
                            title="Close"
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>
                    {expandedList.length === 0 ? (
                        <p className="muted small" style={{ margin: 0, padding: '0.4rem 0.5rem' }}>
                            No languages with this status.
                        </p>
                    ) : (
                        <div style={{ maxHeight: '160px', overflowY: 'auto', padding: '0.2rem 0.5rem' }}>
                            {expandedList.map(l => (
                                <div key={l.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    fontSize: '0.78rem', padding: '0.15rem 0',
                                    borderBottom: '1px solid var(--border)',
                                }}>
                                    <Link
                                        to={`/languages/${l.id}/data`}
                                        style={{ textDecoration: 'none', color: 'inherit' }}
                                        title={l.name_full}
                                    >
                                        {l.name_full}
                                    </Link>
                                    <span className="muted" style={{ fontSize: '0.7rem' }}>{l.id}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="muted small" style={{ marginTop: '0.4rem', textAlign: 'right', fontSize: '0.75rem' }}>
                Total: <strong>{total}</strong>
            </div>
        </div>
    );
}

// ----- Card 3: Red Parameters (unsure or partially compiled) -----
function RedParamsCard({ total, languages }) {
    const list = languages || [];
    return (
        <div className={`card counter-card${total > 0 ? ' border-bad' : ''}`}>
            <h3 className="admin-label">Flagged/Unsure Parameters</h3>
            <p className="muted small" style={{ margin: '0.1rem 0 0.25rem', fontSize: '0.72rem' }}>
                Unsure or partially compiled (empty parameters excluded).
            </p>
            <div className="admin-big-number">{total || 0}</div>
            {list.length > 0 ? (
                <div style={{ maxHeight: '140px', overflowY: 'auto', paddingRight: '0.4rem', marginTop: '0.25rem' }}>
                    {list.map(l => (
                        <div
                            key={l.language_id}
                            style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                fontSize: '0.82rem', marginBottom: '0.2rem',
                                borderBottom: '1px solid var(--border)', paddingBottom: '0.15rem',
                            }}
                        >
                            <Link
                                to={`/languages/${l.language_id}/data`}
                                style={{ textDecoration: 'none', color: 'inherit' }}
                                title={l.language_name}
                            >
                                {l.language_name.length > 28 ? l.language_name.slice(0, 28) + '…' : l.language_name}
                            </Link>
                            <strong style={{ color: 'var(--bad)' }}>{l.red_count}</strong>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="muted small" style={{ margin: '0.25rem 0 0' }}>No flagged/unsure parameters.</p>
            )}
        </div>
    );
}

// ----- Right column: Latest Changes table -----
function truncateWords(text, n) {
    if (!text) return '';
    const words = text.split(/\s+/);
    if (words.length <= n) return text;
    return words.slice(0, n).join(' ') + '…';
}

function LatestChangesCard({ items }) {
    return (
        <section className="card latest-changes-card">
            <div className="latest-changes-head">
                <h3 className="admin-label" style={{ margin: 0 }}>Latest Changes</h3>
            </div>
            <div className="latest-changes-body">
                {items.length === 0 ? (
                    <p className="muted small" style={{ padding: '1rem 1.25rem', textAlign: 'center' }}>
                        No recent changes found.
                    </p>
                ) : (
                    <table className="table" style={{ margin: 0, width: '100%' }}>
                        <thead>
                            <tr>
                                <th style={{ paddingLeft: '1.25rem' }}>Param</th>
                                <th>Note</th>
                                <th>By</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(c => (
                                <tr key={c.id}>
                                    <td style={{ paddingLeft: '1.25rem', fontWeight: 'bold' }}>
                                        <Link
                                            to={`/admin/parameters/${c.parameter_id}/edit`}
                                            style={{ textDecoration: 'none', color: 'inherit' }}
                                        >
                                            {c.parameter_id}
                                        </Link>
                                    </td>
                                    <td style={{ maxWidth: '250px' }}>
                                        {c.change_note ? (
                                            <span title={c.change_note}>{truncateWords(c.change_note, 10)}</span>
                                        ) : (
                                            <span className="muted">—</span>
                                        )}
                                    </td>
                                    <td>{c.user?.name || '—'}</td>
                                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateShort(c.created_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
}

// ============================================================================
// USER (immutato, dashboard semplice)
// ============================================================================
function UserDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get('/api/user/dashboard')
            .then(res => setData(res.data))
            .catch(err => setError(err.response?.data?.detail || 'Error loading the dashboard.'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="container">Loading...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;
    if (!data) return null;

    const { languages } = data;

    return (
        <section className="card dashboard-section">
            <h3 style={{ marginTop: 0 }}>Your assigned languages ({languages.length})</h3>
            {languages.length === 0 ? (
                <p className="muted">No languages assigned. Contact an admin if you think this is an error.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {languages.map(l => (
                        <div key={l.id} style={{
                            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px',
                            padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
                            color: 'var(--text)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 'bold' }}>{l.id}</span>
                                    <span>{l.name_full}</span>
                                    <StatusBadge status={l.status} />
                                </div>
                                <Link to={`/languages/${l.id}/data`} className="btn btn--primary btn--small">
                                    {l.status === 'rejected' ? 'View rejection and reopen' : 'Fill in'}
                                </Link>
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                                    <span>Progress: {l.answered}/{l.total} answers</span>
                                    <span>{l.progress_pct}%</span>
                                </div>
                                <div style={{ height: '8px', background: 'var(--surface-2)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${l.progress_pct}%`, height: '100%',
                                        background: l.status === 'approved' ? '#16a34a' : (l.status === 'rejected' ? '#dc2626' : '#3b82f6')
                                    }}/>
                                </div>
                            </div>
                            {l.status === 'rejected' && l.rejection_note && (
                                <div className="lang-rejection-note">
                                    <strong>Admin note:</strong> {l.rejection_note}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
