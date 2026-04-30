import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api';

// ==========================================
// Pagina di dettaglio per una versione archiviata di una question.
// Mostra: snapshot della question (testo/istruzioni/motivations al momento
// dell'archiviazione) + tabella con tutte le risposte per lingua, esempi e
// motivazioni selezionate. Bottone per scaricare lo stesso contenuto in xlsx.
// ==========================================

function downloadBlob(data, filename) {
    const url = window.URL.createObjectURL(new Blob([data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

export default function ArchivedQuestionDetail() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setLoading(true);
            try {
                const res = await api.get(`/api/admin/archived-questions/${id}`);
                if (mounted) setData(res.data);
            } catch (err) {
                if (mounted) setError(err.response?.data?.detail || 'Could not load the archived question.');
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, [id]);

    const handleDownloadXlsx = async () => {
        try {
            const res = await api.get(`/api/admin/archived-questions/${id}/xlsx`, { responseType: 'blob' });
            const cd = res.headers['content-disposition'] || '';
            const m = cd.match(/filename="?([^"]+)"?/);
            const fname = m ? m[1] : `archived_question_${id}.xlsx`;
            downloadBlob(res.data, fname);
        } catch {
            alert('Could not download the archive.');
        }
    };

    if (loading) {
        return <div className="container"><div className="card" style={{ padding: '2rem' }}>Loading…</div></div>;
    }
    if (error) {
        return (
            <div className="container">
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
                <Link to="/admin/history?tab=old_questions" className="btn">Back to History</Link>
            </div>
        );
    }
    if (!data) return null;

    return (
        <div className="container">
            <header className="dashboard-hero" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ marginBottom: '0.25rem' }}>Archived: {data.original_question_id}</h1>
                    <div className="muted" style={{ fontSize: '0.9rem' }}>
                        Parameter <code>{data.parameter_id}</code> — {data.parameter_name}
                    </div>
                    <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                        Archived on <strong>{new Date(data.archived_at).toLocaleString()}</strong> by <em>{data.archived_by}</em>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="btn btn--primary" onClick={handleDownloadXlsx}>Download .xlsx</button>
                    <Link to="/admin/history?tab=old_questions" className="btn">Back</Link>
                </div>
            </header>

            {/* SNAPSHOT DELLA QUESTION (vecchia versione) */}
            <section className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0 }}>Question snapshot (old version)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
                    <SnapField label="Question text" value={data.text} />
                    {data.instruction && <SnapField label="General instructions" value={data.instruction} />}
                    {data.instruction_yes && <SnapField label="Instruction for YES" value={data.instruction_yes} accent="green" />}
                    {data.instruction_no && <SnapField label="Instruction for NO" value={data.instruction_no} accent="red" />}
                    {data.example_yes && <SnapField label="Example for YES" value={data.example_yes} />}
                    {data.help_info && <SnapField label="Help info" value={data.help_info} />}
                </div>
                {data.allowed_motivations?.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                        <strong>Allowed motivations:</strong>{' '}
                        {data.allowed_motivations.map((m, i) => (
                            <span key={i} style={{ display: 'inline-block', background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.15rem 0.5rem', marginRight: '0.4rem', fontSize: '0.82rem' }}>
                                <code>{m.code}</code> {m.label && <span className="muted">— {m.label}</span>}
                            </span>
                        ))}
                    </div>
                )}
                {data.archive_note && (
                    <div className="alert" style={{ marginTop: '1rem', background: '#fff3cd', border: '1px solid #ffe69c', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
                        <strong>Archive note:</strong> {data.archive_note}
                    </div>
                )}
            </section>

            {/* TABELLA RISPOSTE */}
            <section className="card" style={{ padding: 0 }}>
                <header style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>
                        Linked data: {data.answers.length} language{data.answers.length === 1 ? '' : 's'},{' '}
                        {data.examples_count} example{data.examples_count === 1 ? '' : 's'}
                    </h3>
                </header>

                {data.answers.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center' }}>No answer was archived.</div>
                ) : (
                    <table className="table table-hover">
                        <thead>
                            <tr>
                                <th>Language</th>
                                <th>Answer</th>
                                <th>Comments</th>
                                <th>Motivations</th>
                                <th>Examples</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.answers.map((a) => (
                                <tr key={a.id}>
                                    <td>
                                        <div style={{ fontWeight: 'bold' }}>{a.language_name_full || '-'}</div>
                                        <div className="muted" style={{ fontSize: '0.78rem' }}>{a.language_id}</div>
                                    </td>
                                    <td>
                                        {a.response_text === 'yes' && <span style={{ color: 'green', fontWeight: 'bold' }}>YES</span>}
                                        {a.response_text === 'no' && <span style={{ color: 'red', fontWeight: 'bold' }}>NO</span>}
                                        {!a.response_text && <span className="muted">—</span>}
                                    </td>
                                    <td style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{a.comments || ''}</td>
                                    <td>
                                        {a.motivations?.length > 0 ? (
                                            <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.82rem' }}>
                                                {a.motivations.map((m, i) => (
                                                    <li key={i}><code>{m.code}</code> {m.label && <span className="muted">— {m.label}</span>}</li>
                                                ))}
                                            </ul>
                                        ) : <span className="muted">—</span>}
                                    </td>
                                    <td>
                                        {a.examples?.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {a.examples.map((ex, i) => (
                                                    <div key={i} style={{ background: 'var(--surface-2, #f8fafc)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}>
                                                        {ex.number && <div className="muted" style={{ fontSize: '0.72rem' }}>#{ex.number}</div>}
                                                        {ex.textarea && <div><strong>Text:</strong> {ex.textarea}</div>}
                                                        {ex.transliteration && <div><strong>Translit:</strong> {ex.transliteration}</div>}
                                                        {ex.gloss && <div><strong>Gloss:</strong> {ex.gloss}</div>}
                                                        {ex.translation && <div><strong>Transl:</strong> {ex.translation}</div>}
                                                        {ex.reference && <div className="muted"><strong>Ref:</strong> {ex.reference}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : <span className="muted">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}

function SnapField({ label, value, accent }) {
    const borderLeft = accent === 'green' ? '4px solid green'
        : accent === 'red' ? '4px solid red'
        : '4px solid var(--border)';
    return (
        <div style={{ borderLeft, paddingLeft: '0.75rem' }}>
            <div className="small" style={{ fontWeight: 'bold', color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.95rem' }}>{value}</div>
        </div>
    );
}
