import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';

// Sotto-componente per l'Accordion (sostituisce il vecchio JS vanilla)
const AccordionItem = ({ title, defaultOpen = false, children }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div style={{ border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '1rem', overflow: 'hidden', background: 'var(--surface)', color: 'var(--text)' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="backup-accordion-head"
                style={{
                    padding: '1rem 1.5rem', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    userSelect: 'none', transition: 'background 0.2s',
                }}
            >
                <strong style={{ fontSize: '1.1rem', color: 'var(--text)' }}>{title}</strong>
                <span style={{
                    fontSize: '0.8rem', color: 'var(--text-muted)',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.3s ease'
                }}>
                    ▼
                </span>
            </div>
            {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default function BackupDetail() {
    const { id } = useParams();
    const [sub, setSub] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchDetail = async () => {
            setLoading(true);
            try {
                const res = await api.get(`/api/admin/backups/submissions/${id}`);
                setSub(res.data);
            } catch (err) {
                console.error('Errore nel recupero dei dettagli', err);
                setError('Could not load the backup data.');
            } finally {
                setLoading(false);
            }
        };
        fetchDetail();
    }, [id]);

    if (loading) return <div className="container"><p>Loading backup details...</p></div>;
    if (error) return <div className="container"><div className="alert alert-error">{error}</div></div>;
    if (!sub) return null;

    const displayDate = new Date(sub.submitted_at).toLocaleString();

    return (
        <div className="container">
            <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                <Link to={`/admin/backups/${encodeURIComponent(sub.submitted_at)}`} className="btn btn-outline-secondary">
                    ← Back to Folder
                </Link>
                <h1 className="m-0">Backup #{sub.id}</h1>
            </header>

            {/* HEADER CARD (Identica al tuo CSS originale) */}
            <div className="card" style={{ padding: '1.5rem 2rem', marginBottom: '2rem', border: '1px solid var(--border)' }}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.8rem', color: 'var(--brand)' }}>
                        {sub.language ? sub.language.name : 'Unknown Language'}
                        <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em', verticalAlign: 'middle', marginLeft: '0.5rem' }}>
                            ({sub.language ? sub.language.id : 'N/A'})
                        </span>
                    </h2>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', columnGap: '4rem', rowGap: '0.8rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Backup Date</span>
                        <span style={{ fontSize: '1rem', fontWeight: 500 }}>{displayDate}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem', alignItems: 'baseline' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Created By</span>
                        <span style={{ fontSize: '1rem', fontWeight: 500 }}>{sub.submitted_by}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '1rem', alignItems: 'baseline', gridColumn: '1 / -1' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'right' }}>Note</span>
                        <span style={{ fontSize: '1rem', fontWeight: 500 }}>{sub.note || <span className="muted">—</span>}</span>
                    </div>
                </div>
            </div>

            {/* ACCORDION SECTIONS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

                <AccordionItem title="Parameters values" defaultOpen={true}>
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <thead className="table-light">
                            <tr>
                                <th>Parameter</th>
                                <th>Initial value</th>
                                <th>Warn (init)</th>
                                <th>Final value</th>
                                <th>Warn (final)</th>
                            </tr>
                            </thead>
                            <tbody>
                            {sub.params.length === 0 ? (
                                <tr><td colSpan="5" className="p-3 text-muted">No parameters recorded.</td></tr>
                            ) : (
                                sub.params.map((p, idx) => (
                                    <tr key={idx}>
                                        <td>{p.parameter_id}</td>
                                        <td>{p.value_orig || ""}</td>
                                        <td>{p.warning_orig ? "yes" : ""}</td>
                                        <td>{p.value_eval || ""}</td>
                                        <td>{p.warning_eval ? "yes" : ""}</td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                </AccordionItem>

                <AccordionItem title="Answers">
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <thead className="table-light">
                            <tr>
                                <th>Question</th>
                                <th>Answer</th>
                                <th>Motivations</th>
                                <th>Comments</th>
                            </tr>
                            </thead>
                            <tbody>
                            {sub.answers.length === 0 ? (
                                <tr><td colSpan="4" className="p-3 text-muted">No answers recorded.</td></tr>
                            ) : (
                                sub.answers.map((a, idx) => (
                                    <tr key={idx}>
                                        <td>{a.question_code}</td>
                                        <td>
                                            {a.response_text === 'yes' ? (
                                                <span style={{ color: '#28a745', fontWeight: 'bold' }}>Yes</span>
                                            ) : a.response_text === 'no' ? (
                                                <span style={{ color: '#dc3545', fontWeight: 'bold' }}>No</span>
                                            ) : (
                                                a.response_text
                                            )}
                                        </td>
                                        <td><small>{a.motivations.join(', ')}</small></td>
                                        <td><small>{a.comments}</small></td>
                                    </tr>
                                ))
                            )}
                            </tbody>
                        </table>
                    </div>
                </AccordionItem>

                <AccordionItem title="Language examples">
                    <div className="table-responsive">
                        <table className="table table-sm table-striped mb-0">
                            <thead className="table-light">
                            <tr>
                                <th>Question</th>
                                <th>Example text</th>
                                <th>Transliteration</th>
                                <th>Gloss</th>
                                <th>Translation</th>
                                <th>Ref</th>
                            </tr>
                            </thead>
                            <tbody>
                            {sub.examples.length === 0 ? (
                                <tr><td colSpan="6" className="p-3 text-muted">No examples provided.</td></tr>
                            ) : (
                                sub.examples.map((e, idx) => (
                                    <tr key={idx}>
                                        <td>{e.question_code}</td>
                                        <td>{e.textarea}</td>
                                        <td><small className="muted">{e.transliteration}</small></td>
                                        <td><small className="muted">{e.gloss}</small></td>
                                        <td>{e.translation}</td>
                                        <td><small>{e.reference}</small></td>
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
