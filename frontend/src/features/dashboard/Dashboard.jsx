import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// ===== Palette status (coerente con LanguageList / LanguageData) =====
const STATUS_BADGE = {
    pending: { label: 'Pending', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1', icon: '✏️' },
    waiting_for_approval: { label: 'Waiting', bg: '#fff8e1', color: '#92400e', border: '#fcd34d', icon: '⏳' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#15803d', border: '#86efac', icon: '✅' },
    rejected: { label: 'Rejected', bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5', icon: '⚠️' },
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
            <span aria-hidden="true">{meta.icon}</span>{meta.label}
        </span>
    );
}

const fmtDate = (iso) => iso ? new Date(iso).toLocaleString() : '—';
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
        const url = window.prompt('URL del link:', 'https://');
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
                <button type="button" onClick={handleLink} style={btnStyle} title="Link">🔗</button>
                <button type="button" onClick={() => exec('removeFormat')} style={btnStyle} title="Clear formatting">⌫</button>
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
            alert('Errore nel salvataggio della citazione.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '0.85rem', background: '#fff', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {role}
            </div>
            <div className="small muted" style={{ marginBottom: '0.5rem' }}>{description}</div>

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
                        background: '#f8f9fa', padding: '0.85rem 3rem 0.85rem 0.85rem',
                        borderRadius: '6px', border: '1px solid #e2e8f0', position: 'relative',
                        fontSize: '0.83rem', lineHeight: 1.5,
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
                            title="Copia citazione (testo semplice)"
                        >
                            {copied ? '✓ Copied' : 'Copy'}
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
                                ✏️ Edit reference
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ============================================================================
// Collapsible section (accordion default aperto)
// ============================================================================
function CollapsibleSection({ id, title, badge, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section id={id} className="card dashboard-section" style={{ padding: 0 }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.85rem 1rem', background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: '1rem', fontWeight: 600, textAlign: 'left', color: 'inherit',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {title}
                    {badge !== undefined && (
                        <span style={{
                            background: '#e2e8f0', color: '#475569',
                            padding: '0.05rem 0.5rem', borderRadius: '999px',
                            fontSize: '0.75rem', fontWeight: 700,
                        }}>{badge}</span>
                    )}
                </span>
                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{open ? '▾' : '▸'}</span>
            </button>
            {open && (
                <div style={{ padding: '0 1rem 1rem 1rem' }}>
                    {children}
                </div>
            )}
        </section>
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
                <h1 style={{ marginBottom: '0.25rem' }}>Welcome, {name}</h1>
                <p className="muted dashboard-copy" style={{ margin: 0 }}>
                    {role === 'admin' ? 'Pannello di controllo amministratore.' : 'Le tue lingue assegnate.'}
                </p>
            </header>

            {role === 'admin' ? <AdminDashboard /> : <UserDashboard />}
        </>
    );
}

// ============================================================================
// ADMIN — layout 2 colonne (left: contatori + sezioni; right: cronologia)
// ============================================================================
function AdminDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Citazioni dinamiche dal SiteContent
    const [siteContents, setSiteContents] = useState({});

    useEffect(() => {
        Promise.all([
            api.get('/api/admin/dashboard').then(r => r.data),
            api.get('/api/public/site-content').then(r => r.data).catch(() => ({})),
        ]).then(([dash, contents]) => {
            setData(dash);
            setSiteContents(contents || {});
        }).catch(err => {
            setError(err.response?.data?.detail || 'Errore caricamento dashboard.');
        }).finally(() => setLoading(false));
    }, []);

    const handleCiteSaved = (key, newHtml) => {
        setSiteContents(prev => ({ ...prev, [key]: newHtml }));
    };

    if (loading) return <div className="container">Caricamento...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;
    if (!data) return null;

    const { stats } = data;

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)',
            gap: '1.25rem',
            alignItems: 'start',
        }}>
            {/* ============ COLONNA SINISTRA ============ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>

                {/* Stat strip: 4 card verbose con numero + descrizione + link */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    <VerboseStatCard
                        label="Da revisionare"
                        value={stats.to_review_count}
                        accent="#f59e0b"
                        link={{ to: "/languages?status=waiting_for_approval", text: "Vedi lista →" }}
                        anchor="#section-review"
                    />
                    <VerboseStatCard
                        label="Completate"
                        value={stats.completed_count}
                        accent="#16a34a"
                        link={{ to: "/languages?status=approved", text: "Lingue approvate →" }}
                        anchor="#section-completed"
                    />
                    <VerboseStatCard
                        label="Lingue con red flags"
                        value={stats.languages_with_red}
                        accent="#dc2626"
                        anchor="#section-red"
                        link={{ to: "/languages", text: "Tutte le lingue →" }}
                    />
                    <VerboseStatCard
                        label="Parametri rossi totali"
                        value={stats.total_red_params}
                        accent="#b91c1c"
                        anchor="#section-red"
                        link={{ to: "/admin/parameters", text: "Vai ai parametri →" }}
                    />
                </div>

                <ToReviewSection items={data.to_review} />
                <CompletedSection items={data.completed} />
                <RedParamsSection items={data.red_by_language} />
                <HowToCiteSection contents={siteContents} onSaved={handleCiteSaved} isAdmin={true} />
            </div>

            {/* ============ COLONNA DESTRA: cronologia modifiche ============ */}
            <div style={{ minWidth: 0, position: 'sticky', top: '1rem' }}>
                <RecentChangesSection items={data.recent_changes} />
            </div>
        </div>
    );
}

function VerboseStatCard({ label, value, accent = '#3b82f6', link, anchor }) {
    return (
        <div className="card stat-card" style={{
            borderLeft: `4px solid ${accent}`,
            padding: '0.85rem 1rem',
            display: 'flex', flexDirection: 'column', gap: '0.4rem',
        }}>
            <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {label}
            </div>
            <div style={{ fontSize: '1.9rem', fontWeight: 700, color: accent, lineHeight: 1 }}>
                {value}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                {anchor && (
                    <a href={anchor} style={{ fontSize: '0.78rem', color: accent, textDecoration: 'none', fontWeight: 600 }}>
                        Scrolla giù ↓
                    </a>
                )}
                {link && (
                    <Link to={link.to} style={{ fontSize: '0.78rem', color: '#475569', textDecoration: 'none', fontWeight: 600 }}>
                        {link.text}
                    </Link>
                )}
            </div>
        </div>
    );
}

// ----- 1. To Review -----
function ToReviewSection({ items }) {
    return (
        <CollapsibleSection id="section-review" title="⏳ Lingue da revisionare" badge={items.length}>
            {items.length === 0 ? (
                <p className="muted small">Nessuna lingua in attesa di approvazione.</p>
            ) : (
                <table className="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Lingua</th>
                            <th>Inviata da</th>
                            <th>Inviata il</th>
                            <th style={{ textAlign: 'right' }}>Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(l => (
                            <tr key={l.id}>
                                <td style={{ fontWeight: 'bold' }}>{l.id}</td>
                                <td>{l.name_full}</td>
                                <td className="small">{l.assigned_user?.name || '—'}</td>
                                <td className="small">{fmtDate(l.submitted_at)}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <Link to={`/languages/${l.id}/data`} className="btn btn--primary btn--small">Review</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </CollapsibleSection>
    );
}

// ----- 2. Completed -----
function CompletedSection({ items }) {
    return (
        <CollapsibleSection id="section-completed" title="✅ Lingue completate" badge={items.length} defaultOpen={false}>
            {items.length === 0 ? (
                <p className="muted small">Nessuna lingua approvata finora.</p>
            ) : (
                <table className="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Lingua</th>
                            <th>Compilata da</th>
                            <th>Approvata il</th>
                            <th style={{ textAlign: 'right' }}>Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(l => (
                            <tr key={l.id}>
                                <td style={{ fontWeight: 'bold' }}>{l.id}</td>
                                <td>{l.name_full}</td>
                                <td className="small">{l.assigned_user?.name || '—'}</td>
                                <td className="small">{fmtDate(l.reviewed_at)}</td>
                                <td style={{ textAlign: 'right', display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                                    <Link to={`/languages/${l.id}/data`} className="btn btn--small">View</Link>
                                    <Link to={`/languages/${l.id}/debug`} className="btn btn--small">Debug</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </CollapsibleSection>
    );
}

// ----- 3. Red params per lingua (accordion annidato) -----
function RedParamsSection({ items }) {
    const [expanded, setExpanded] = useState(() => new Set());
    const toggle = (id) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    return (
        <CollapsibleSection id="section-red" title="🚩 Parametri rossi per lingua" badge={items.length}>
            <p className="small muted" style={{ marginTop: 0 }}>
                <strong>Unsure</strong>: blocco marcato come incerto.
                <strong> Incomplete</strong>: domande senza risposta.
            </p>
            {items.length === 0 ? (
                <p className="muted small">Nessun blocco rosso. Tutto pulito.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {items.map(g => {
                        const isOpen = expanded.has(g.language_id);
                        return (
                            <div key={g.language_id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                <button
                                    type="button"
                                    onClick={() => toggle(g.language_id)}
                                    style={{
                                        display: 'flex', width: '100%', padding: '0.6rem 0.85rem',
                                        gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between',
                                        background: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left'
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 'bold' }}>{g.language_id}</span>
                                        <span>{g.language_name}</span>
                                        <StatusBadge status={g.language_status} />
                                        {g.assigned_user && <span className="small muted">— {g.assigned_user.name}</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span style={{
                                            background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5',
                                            padding: '0.05rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                                        }}>
                                            {g.red_count}
                                        </span>
                                        <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{isOpen ? '▾' : '▸'}</span>
                                    </div>
                                </button>
                                {isOpen && (
                                    <div style={{ borderTop: '1px solid var(--border)', padding: '0.6rem 0.85rem', background: '#fafafa' }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
                                            {g.params.map(p => (
                                                <div key={p.id} style={{
                                                    background: '#fff', border: '1px solid #fca5a5', borderRadius: '5px',
                                                    padding: '0.3rem 0.55rem', display: 'flex', flexDirection: 'column', gap: '0.15rem',
                                                }}>
                                                    <div style={{ fontSize: '0.85rem' }}>
                                                        <strong style={{ color: '#b91c1c' }}>{p.id}</strong>
                                                        <span className="small muted"> — {p.name}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                                        {p.is_unsure && (
                                                            <span style={{ background: '#fff7ed', color: '#9a3412', padding: '0.05rem 0.35rem', borderRadius: '3px', fontSize: '0.68rem', fontWeight: 600 }}>
                                                                unsure
                                                            </span>
                                                        )}
                                                        {p.is_incomplete && (
                                                            <span style={{ background: '#fee2e2', color: '#7f1d1d', padding: '0.05rem 0.35rem', borderRadius: '3px', fontSize: '0.68rem', fontWeight: 600 }}>
                                                                {p.answered}/{p.total}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <Link to={`/languages/${g.language_id}/data`} className="btn btn--primary btn--small">Apri compilazione</Link>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </CollapsibleSection>
    );
}

// ----- 4. How to cite -----
function HowToCiteSection({ contents, onSaved, isAdmin }) {
    const paramsHtml = contents.params_cite || "Longobardi, Giuseppe & Cristina Guardiano. 2009. Evidence for syntax as a signal of historical relatedness. <em>Lingua</em> 119. 1679-1706.";
    const dataHtml = contents.data_cite || "Guardiano, Cristina, Paola Crisma, Giuseppe Longobardi, Marco Longhin, Giovanni Battista Matteazzi, Emanuela Li Destri, Gaia Sorge (eds.). 2026. The PCM_Hub (version 1).";

    return (
        <CollapsibleSection id="section-cite" title="📖 How to cite" defaultOpen={false}>
            <p className="small muted" style={{ marginTop: 0 }}>
                Citazioni dinamiche modificabili (HTML rich text). Le modifiche sono visibili a tutti gli utenti del sito.
            </p>
            <CiteBox
                keyName="params_cite"
                role="Parameters & Manifestations"
                description="Riferimento per parametri e manifestazioni."
                html={paramsHtml}
                onSaved={onSaved}
                isAdmin={isAdmin}
            />
            <CiteBox
                keyName="data_cite"
                role="Data, Map & Scripts"
                description="Riferimento per ogni altro contenuto del PCM Hub."
                html={dataHtml}
                onSaved={onSaved}
                isAdmin={isAdmin}
            />
            <div style={{ marginTop: '0.5rem' }}>
                <Link to="/how-to-cite" className="small">Vedi pagina pubblica completa →</Link>
            </div>
        </CollapsibleSection>
    );
}

// ----- 5. Recent changes (colonna destra) -----
function RecentChangesSection({ items }) {
    return (
        <section className="card dashboard-section" style={{ padding: '0.85rem 1rem' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.6rem', fontSize: '1rem' }}>
                📋 Cronologia modifiche
                <span style={{
                    marginLeft: '0.5rem', background: '#e2e8f0', color: '#475569',
                    padding: '0.05rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                }}>{items.length}</span>
            </h3>
            {items.length === 0 ? (
                <p className="muted small">Nessuna modifica registrata.</p>
            ) : (
                <div style={{ maxHeight: 'calc(100vh - 12rem)', overflowY: 'auto', paddingRight: '0.25rem' }}>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {items.map(c => (
                            <li key={c.id} style={{
                                borderLeft: '3px solid #cbd5e1',
                                padding: '0.4rem 0.6rem',
                                background: '#fafafa',
                                borderRadius: '0 4px 4px 0',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.4rem' }}>
                                    <Link to={`/admin/parameters/${c.parameter_id}/edit`} style={{ fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}>
                                        {c.parameter_id}
                                    </Link>
                                    <span style={{ fontSize: '0.72rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                                        {fmtDateShort(c.created_at)}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.82rem', color: '#334155', marginTop: '0.15rem', wordBreak: 'break-word' }}>
                                    {c.change_note}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.15rem' }}>
                                    {c.user?.name || '—'}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
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
            .catch(err => setError(err.response?.data?.detail || 'Errore caricamento dashboard.'))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="container">Caricamento...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;
    if (!data) return null;

    const { languages } = data;

    return (
        <section className="card dashboard-section">
            <h3 style={{ marginTop: 0 }}>Le tue lingue assegnate ({languages.length})</h3>
            {languages.length === 0 ? (
                <p className="muted">Nessuna lingua assegnata. Contatta un admin se pensi sia un errore.</p>
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
                                    {l.status === 'rejected' ? 'Vedi rifiuto e riapri' : 'Compila'}
                                </Link>
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b', marginBottom: '0.2rem' }}>
                                    <span>Progresso: {l.answered}/{l.total} risposte</span>
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
                                    <strong>Nota admin:</strong> {l.rejection_note}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
