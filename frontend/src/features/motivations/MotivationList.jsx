import { useState, useEffect } from 'react';
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
            const res = await api.get('/api/admin/motivations');
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

    const handleOpenModal = (mot = null) => {
        if (mot) {
            setEditingId(mot.id);
            setFormData({ code: mot.code, label: mot.label });
        } else {
            setEditingId(null);
            setFormData({ code: '', label: '' });
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
                top: '5rem',
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
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredMots.map(m => (
                        <tr key={m.id}>
                            <td style={{fontWeight: 'bold'}}>{m.code}</td>
                            <td>{m.label}</td>
                            <td className="row-actions">
                                <button className="btn" onClick={() => handleOpenModal(m)}>Edit</button>
                                <button className="btn btn--danger" style={{color: 'red'}} onClick={() => handleDelete(m.id)}>Delete</button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>

            {/* MODALE CREAZIONE/MODIFICA */}
            {showModal && (
                <div style={modalOverlayStyle}>
                    <div className="card" style={{ width: '400px' }}>
                        <h3>{editingId ? 'Edit Motivation' : 'New Motivation'}</h3>
                        <form onSubmit={handleSave}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{fontWeight: 'bold', display: 'block', marginBottom: '0.3rem'}}>Code</label>
                                <input type="text" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value.toUpperCase()})} required style={{ width: '100%', padding: '0.5rem' }} />
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