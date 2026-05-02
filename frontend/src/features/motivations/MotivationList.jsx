import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';

export default function MotivationList() {
    const [motivations, setMotivations] = useState([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({ code: '', label: '' });

    const fetchMotivations = async () => {
        setLoading(true);
        try {
            // /with-usage include il campo linked_questions per ogni motivation.
            const res = await api.get('/api/admin/motivations/with-usage');
            setMotivations(res.data);
        } catch (err) {
            setError("Could not load the motivations.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMotivations();
    }, []);

    // Suggerisce il prossimo codice MOT### libero. Trova il massimo numero
    // tra i code che matchano `MOT\d+`, +1, e zero-padda a 3 cifre (mantenendo
    // più cifre se serve oltre il 999). Se non c'è alcun MOT###, parte da MOT001.
    const suggestNextMotivationCode = () => {
        const re = /^MOT(\d+)$/i;
        let max = 0;
        for (const m of motivations) {
            const match = String(m.code || '').match(re);
            if (match) {
                const n = parseInt(match[1], 10);
                if (Number.isFinite(n) && n > max) max = n;
            }
        }
        const next = max + 1;
        return `MOT${String(next).padStart(3, '0')}`;
    };

    const handleOpenModal = (mot = null) => {
        if (mot) {
            setEditingId(mot.id);
            setFormData({ code: mot.code, label: mot.label });
        } else {
            setEditingId(null);
            setFormData({ code: suggestNextMotivationCode(), label: '' });
        }
        setShowModal(true);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        try {
            if (editingId) {
                await api.put(`/api/admin/motivations/${editingId}`, formData);
            } else {
                await api.post('/api/admin/motivations', formData);
            }
            setShowModal(false);
            fetchMotivations();
        } catch (err) {
            alert(err.response?.data?.detail || "Error while saving");
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this motivation? If it is in use, the operation will be blocked.")) return;
        try {
            await api.delete(`/api/admin/motivations/${id}`);
            fetchMotivations();
        } catch (err) {
            alert(err.response?.data?.detail || "Error during deletion");
        }
    };

    // Cerca su code, label, status (active/inactive testo se serve)
    const filteredMots = motivations.filter(m => searchMatches(m, search));

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Motivations</h1>
            </header>

            <section className="toolbar" style={{
                position: 'sticky',
                top: 'var(--topbar-height)',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '0.85rem 1rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                marginBottom: '1rem',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: '1rem',
            }}>
                <div className="toolbar__form" style={{ maxWidth: 'none', width: '100%' }}>
                    <input type="search" placeholder="Search every field (code, label, ...)" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="toolbar__add">
                    <button className="btn btn--primary" onClick={() => handleOpenModal()}>Add Motivation</button>
                </div>
            </section>

            {error && <div className="alert alert-error">{error}</div>}

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>Code</th>
                        <th>Description (Label)</th>
                        <th>Linked Questions</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredMots.map(m => (
                        <tr key={m.id}>
                            <td style={{fontWeight: 'bold'}}>{m.code}</td>
                            <td>{m.label}</td>
                            <td>
                                {(m.linked_questions || []).length === 0 ? (
                                    <span className="muted small" style={{ fontStyle: 'italic' }}>None</span>
                                ) : (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                        {m.linked_questions.map(qid => (
                                            <Link
                                                key={qid}
                                                to={`/admin/questions/${encodeURIComponent(qid)}/edit`}
                                                title={`Open question ${qid}`}
                                                style={{ textDecoration: 'none' }}
                                            >
                                                <code style={{
                                                    background: 'var(--surface-2)',
                                                    color: 'var(--text)',
                                                    padding: '0.15rem 0.4rem',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--border)',
                                                    fontSize: '0.78rem',
                                                }}>
                                                    {qid}
                                                </code>
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </td>
                            <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'right' }}>
                                <div className="row-actions" style={{ flexWrap: 'nowrap' }}>
                                    <button className="btn" onClick={() => handleOpenModal(m)}>Edit</button>
                                    <button className="btn btn--danger" style={{color: 'red'}} onClick={() => handleDelete(m.id)}>Delete</button>
                                </div>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {/* MODALE CREAZIONE/MODIFICA */}
            {showModal && (
                <div style={modalOverlayStyle}>
                    <div className="card" style={{ width: '460px' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>
                            {editingId ? 'Edit Motivation' : 'New Motivation'}
                        </h3>
                        <form onSubmit={handleSave}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{fontWeight: 'bold', display: 'block', marginBottom: '0.3rem'}}>Code</label>
                                <input
                                    type="text"
                                    value={formData.code}
                                    onChange={e => setFormData({...formData, code: e.target.value.toUpperCase()})}
                                    required
                                    readOnly={!!editingId}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem',
                                        background: editingId ? 'var(--surface-2)' : undefined,
                                        color: editingId ? 'var(--text-muted)' : undefined,
                                        cursor: editingId ? 'not-allowed' : undefined,
                                    }}
                                />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{fontWeight: 'bold', display: 'block', marginBottom: '0.3rem'}}>Description</label>
                                <textarea rows="3" value={formData.label} onChange={e => setFormData({...formData, label: e.target.value})} required style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--primary">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', justifyContent: 'center', alignItems: 'center'
};