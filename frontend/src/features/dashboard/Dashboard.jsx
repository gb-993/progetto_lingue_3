import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ===== Palette status (coerente con LanguageList / LanguageData) =====
const STATUS_BADGE = {
    pending: { label: 'Pending', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
    waiting_for_approval: { label: 'Waiting', bg: '#fff8e1', color: '#92400e', border: '#fcd34d' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    rejected: { label: 'Rejected', bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5' },
};

function StatusBadge({ status }) {
    const meta = STATUS_BADGE[status] || STATUS_BADGE.pending;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
            background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
            padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem',
            fontWeight: 600, lineHeight: 1.6, whiteSpace: 'nowrap',
        }}>
            {meta.label}
        </span>
    );
}

const fmtDateShort = (iso) => iso ? new Date(iso).toLocaleDateString() : '—';

// ============================================================================
// Mini WYSIWYG editor con contentEditable + execCommand
// ============================================================================
function RichTextEditor({ initialHtml, onSave, onCancel, isSaving }) {
    const editorRef = useRef(null);

    useEffect(() => {
        if (editorRef.current && initialHtml !== undefined) {
            editorRef.current.innerHTML = initialHtml || '';
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const exec = (cmd, val = null) => {
        document.execCommand(cmd, false, val);
        editorRef.current?.focus();
    };

    const handleLink = () => {
        const url = window.prompt('Link URL:', 'https://');
        if (url) exec('createLink', url);
    };

    const handleSave = () => {
        const html = editorRef.current?.innerHTML || '';
        onSave(html);
    };

    const btnStyle = {
        padding: '0.3rem 0.55rem', border: '1px solid #cbd5e1', background: '#fff',
        borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', minWidth: '32px',
    };

    return (
        <div style={{ border: '1px solid #cbd5e1', borderRadius: '6px', background: '#fff' }}>
            <div style={{
                display: 'flex', gap: '0.3rem', padding: '0.4rem',
                borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap',
            }}>
                <button type="button" onClick={() => exec('bold')} style={{ ...btnStyle, fontWeight: 'bold' }} title="Bold">B</button>
                <button type="button" onClick={() => exec('italic')} style={{ ...btnStyle, fontStyle: 'italic' }} title="Italic">I</button>
                <button type="button" onClick={() => exec('underline')} style={{ ...btnStyle, textDecoration: 'underline' }} title="Underline">U</button>
                <button type="button" onClick={handleLink} style={btnStyle} title="Link">Link</button>
                <button type="button" onClick={() => exec('removeFormat')} style={btnStyle} title="Clear formatting">Clear</button>
            </div>
            <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                style={{
                    padding: '0.8rem', minHeight: '90px', fontSize: '0.9rem',
                    fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', borderTop: '1px solid #e2e8f0', justifyContent: 'flex-end', background: '#f8fafc' }}>
                <button type="button" className="btn btn--small" onClick={onCancel} disabled={isSaving}>Cancel</button>
                <button type="button" className="btn btn--small btn--primary" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Cite box: visualizza + permette edit inline (admin)
// ============================================================================
function CiteBox({ keyName, role, description, html, onSaved, isAdmin }) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        navigator.clipboard.writeText((tmp.innerText || '').trim()).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        });
    };

    const handleSave = async (newHtml) => {
        setSaving(true);
        try {
            await api.put(`/api/admin/site-content/${keyName}`, { content: newHtml });
            onSaved(keyName, newHtml);
            setEditing(false);
        } catch {
            alert('Error saving the citation.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.55rem 0.65rem', background: '#fff', marginBottom: '0.45rem' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {role}
            </div>
            <div className="small muted" style={{ marginBottom: '0.3rem', fontSize: '0.75rem' }}>{description}</div>

            {editing ? (
                <RichTextEditor
                    initialHtml={html}
                    onSave={handleSave}
                    onCancel={() => setEditing(false)}
                    isSaving={saving}
                />
            ) : (
                <>
                    <div style={{
                        background: '#f8f9fa', padding: '0.5rem 2.5rem 0.5rem 0.6rem',
                        borderRadius: '5px', border: '1px solid #e2e8f0', position: 'relative',
                        fontSize: '0.78rem', lineHeight: 1.4,
                    }}>
                        <button
                            type="button"
                            onClick={handleCopy}
                            style={{
                                position: 'absolute', top: '6px', right: '6px',
                                padding: '3px 7px', fontSize: '0.7rem', cursor: 'pointer',
                                background: copied ? '#16a34a' : '#fff',
                                color: copied ? '#fff' : '#475569',
                                border: '1px solid #cbd5e1', borderRadius: '4px', fontWeight: 600,
                            }}
                            title="Copy citation (plain text)"
                        >
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        <div dangerouslySetInnerHTML={{ __html: html }} />
                    </div>
                    {isAdmin && (
                        <div style={{ marginTop: '0.4rem', textAlign: 'right' }}>
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                className="btn btn--small"
                                style={{ fontSize: '0.78rem' }}
                            >
                                Edit reference
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

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
    const [siteContents, setSiteContents] = useState({});

    useEffect(() => {
        Promise.all([
            api.get('/api/admin/dashboard').then(r => r.data),
            api.get('/api/public/site-content').then(r => r.data).catch(() => ({})),
        ]).then(([dash, contents]) => {
            setData(dash);
            setSiteContents(contents || {});
        }).catch(err => {
            setError(err.response?.data?.detail || 'Error loading the dashboard.');
        }).finally(() => setLoading(false));
    }, []);

    const handleCiteSaved = (key, newHtml) => {
        setSiteContents(prev => ({ ...prev, [key]: newHtml }));
    };

    if (loading) return <div className="container">Loading...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;
    if (!data) return null;

    const { stats, to_review, recent_changes, languages_by_status } = data;

    return (
        <div className="dashboard-grid-admin">
            <div className="admin-counters">
                <PendingApprovalsCard count={stats.to_review_count} items={to_review} />
                <LanguagesByStatusCard byStatus={stats.by_status} byStatusList={languages_by_status} />
                <HowToCiteCard contents={siteContents} onSaved={handleCiteSaved} />
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
            <h3 className="admin-label">Waiting for Approvals</h3>
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
                            className="status-cell"
                            style={{
                                background: isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
                                border: isActive ? '1px solid #3b82f6' : '1px solid transparent',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                padding: '0.4rem',
                                font: 'inherit',
                                color: 'inherit',
                                textAlign: 'center',
                            }}
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
                    background: '#fff',
                }}>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.25rem 0.5rem', borderBottom: '1px solid var(--border)',
                        fontSize: '0.72rem', fontWeight: 600, color: '#475569',
                    }}>
                        <span>{expandedCell?.label} ({expandedList.length})</span>
                        <button
                            type="button"
                            onClick={() => setExpanded(null)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: '#64748b', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.2rem',
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

// ----- Card 3: How to cite (always open, compact) -----
function HowToCiteCard({ contents, onSaved }) {
    const paramsHtml = contents.params_cite || "Longobardi, Giuseppe & Cristina Guardiano. 2009. Evidence for syntax as a signal of historical relatedness. <em>Lingua</em> 119. 1679-1706.";
    const dataHtml = contents.data_cite || "Guardiano, Cristina, Paola Crisma, Giuseppe Longobardi, Marco Longhin, Giovanni Battista Matteazzi, Emanuela Li Destri, Gaia Sorge (eds.). 2026. The PCM_Hub (version 1).";

    return (
        <div className="card counter-card">
            <h3 className="admin-label">How to cite</h3>
            <p className="small muted" style={{ margin: '0.15rem 0 0.35rem', fontSize: '0.75rem' }}>
                Editable references shown to all site users.
            </p>
            <CiteBox
                keyName="params_cite"
                role="Parameters & Manifestations"
                description="Reference for parameters and manifestations."
                html={paramsHtml}
                onSaved={onSaved}
                isAdmin={true}
            />
            <CiteBox
                keyName="data_cite"
                role="Data, Map & Scripts"
                description="Reference for any other content of the PCM Hub."
                html={dataHtml}
                onSaved={onSaved}
                isAdmin={true}
            />
            <div style={{ marginTop: '0.25rem' }}>
                <Link to="/how-to-cite" className="small">View full public page →</Link>
            </div>
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
                            background: '#fff', border: '1px solid var(--border)', borderRadius: '8px',
                            padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginBottom: '0.2rem' }}>
                                    <span>Progress: {l.answered}/{l.total} answers</span>
                                    <span>{l.progress_pct}%</span>
                                </div>
                                <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${l.progress_pct}%`, height: '100%',
                                        background: l.status === 'approved' ? '#16a34a' : (l.status === 'rejected' ? '#dc2626' : '#3b82f6')
                                    }}/>
                                </div>
                            </div>
                            {l.status === 'rejected' && l.rejection_note && (
                                <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#7f1d1d', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.85rem' }}>
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
