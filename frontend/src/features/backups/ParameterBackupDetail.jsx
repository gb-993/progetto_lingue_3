import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';
import { formatBackendDate } from '../../utils/dateFormat';

// Accordion riusato dallo stile di BackupDetail (ripetuto per evitare di
// dover esportare il sotto-componente da un altro file).
const AccordionItem = ({ title, defaultOpen = false, children }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '1rem', overflow: 'hidden', background: 'var(--surface)', color: 'var(--text)' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="backup-accordion-head"
                style={{ padding: '1rem 1.5rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none', transition: 'background 0.2s' }}
            >
                <strong style={{ fontSize: '1.1rem', color: 'var(--text)' }}>{title}</strong>
                <span style={{
                    fontSize: '0.8rem', color: 'var(--text-muted)',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s ease'
                }}>▼</span>
            </div>
            {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default function ParameterBackupDetail() {
    const { id } = useParams();
    const [sub, setSub] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/api/admin/backups/parameters/submissions/${id}`);
                setSub(res.data);
            } catch (err) {
                console.error('Errore nel recupero dei dettagli del backup parametro', err);
                setError('Could not load the parameter backup data.');
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [id]);

    if (loading) return <div className="container"><p>Loading parameter backup details...</p></div>;
    if (error) return <div className="container"><div className="alert alert-error">{error}</div></div>;
    if (!sub) return null;

    const displayDate = formatBackendDate(sub.submitted_at);
    const p = sub.parameter || {};

    return (
        <div className="container">
            <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <Link to={`/admin/backups/parameters/${encodeURIComponent(sub.submitted_at)}`} className="btn btn-outline-secondary">
                    ← Back to Folder
                </Link>
                <h1 className="m-0">Parameter backup #{sub.id}</h1>
            </header>

            {/* HEADER CARD */}
            <div className="card" style={{ padding: '1.5rem 2rem', marginBottom: '2rem', border: '1px solid var(--border)' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--brand)' }}>
                        {p.name || 'Unknown Parameter'}
                        <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em', verticalAlign: 'middle', marginLeft: '0.5rem' }}>
                            ({p.id || 'N/A'})
                        </span>
                    </h2>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', columnGap: '4rem', rowGap: '0.8rem' }}>
                    <HeaderRow label="Backup Date" value={displayDate} />
                    <HeaderRow label="Created By" value={sub.submitted_by} />
                    <HeaderRow label="Note" value={sub.note || <span className="muted">—</span>} fullRow />
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

                <AccordionItem title="Parameter definition" defaultOpen={true}>
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <tbody>
                                <DefRow k="Schema" v={p.schema || '—'} />
                                <DefRow k="Type" v={p.param_type || '—'} />
                                <DefRow k="Level of comparison" v={p.level_of_comparison || '—'} />
                                <DefRow k="Position" v={p.position ?? '—'} />
                                <DefRow k="Active" v={p.is_active ? 'yes' : 'no'} />
                                <DefRow k="Implicational condition" v={p.implicational_condition || '—'} />
                                <DefRow k="Description of impl. condition" v={p.description_of_the_implicational_condition || '—'} preWrap />
                                <DefRow k="Short description" v={p.short_description || '—'} preWrap />
                                <DefRow k="Long description" v={p.long_description || '—'} preWrap />
                            </tbody>
                        </table>
                    </div>
                </AccordionItem>

                <AccordionItem title={`Questions (${sub.questions.length})`}>
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <thead className="table-light">
                            <tr>
                                <th>Code</th>
                                <th>Text</th>
                                <th>Template</th>
                                <th>Stop?</th>
                                <th>Active</th>
                                <th>Allowed motivations</th>
                            </tr>
                            </thead>
                            <tbody>
                            {sub.questions.length === 0 ? (
                                <tr><td colSpan="6" className="p-3 text-muted">No questions recorded.</td></tr>
                            ) : (
                                sub.questions.map((q, idx) => (
                                    <tr key={idx}>
                                        <td><code>{q.question_code}</code></td>
                                        <td style={{ whiteSpace: 'pre-wrap' }}>{q.text}</td>
                                        <td><small className="muted">{q.template_type || '—'}</small></td>
                                        <td>{q.is_stop_question ? 'yes' : ''}</td>
                                        <td>{q.is_active ? 'yes' : 'no'}</td>
                                        <td>
                                            <small>
                                                {q.allowed_motivations && q.allowed_motivations.length > 0
                                                    ? q.allowed_motivations.map(m => m.code).join(', ')
                                                    : '—'}
                                            </small>
                                        </td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                </AccordionItem>

                <AccordionItem title="Question instructions & examples">
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <thead className="table-light">
                            <tr>
                                <th>Code</th>
                                <th>Instruction</th>
                                <th>Instruction (yes)</th>
                                <th>Instruction (no)</th>
                                <th>Example (yes)</th>
                                <th>Help info</th>
                            </tr>
                            </thead>
                            <tbody>
                            {sub.questions.length === 0 ? (
                                <tr><td colSpan="6" className="p-3 text-muted">No questions recorded.</td></tr>
                            ) : (
                                sub.questions.map((q, idx) => (
                                    <tr key={idx}>
                                        <td><code>{q.question_code}</code></td>
                                        <td><small style={{ whiteSpace: 'pre-wrap' }}>{q.instruction || '—'}</small></td>
                                        <td><small style={{ whiteSpace: 'pre-wrap' }}>{q.instruction_yes || '—'}</small></td>
                                        <td><small style={{ whiteSpace: 'pre-wrap' }}>{q.instruction_no || '—'}</small></td>
                                        <td><small style={{ whiteSpace: 'pre-wrap' }}>{q.example_yes || '—'}</small></td>
                                        <td><small style={{ whiteSpace: 'pre-wrap' }}>{q.help_info || '—'}</small></td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                </AccordionItem>
            </div>
        </div>
    );
}

function HeaderRow({ label, value, fullRow = false }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1rem', alignItems: 'baseline', gridColumn: fullRow ? '1 / -1' : undefined }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>{label}</span>
            <span style={{ fontSize: '1rem', fontWeight: 500 }}>{value}</span>
        </div>
    );
}

function DefRow({ k, v, preWrap = false }) {
    return (
        <tr>
            <th style={{ width: '220px' }}>{k}</th>
            <td style={{ whiteSpace: preWrap ? 'pre-wrap' : 'normal' }}>{v}</td>
        </tr>
    );
}
