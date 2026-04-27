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
    const [formData, setFormData] = useState({ code: '', label: '', is_active: true });

    const fetchMotivations = async () => {
        setLoading(true);
        try {
            // Include anche quelle inattive per la pagina di gestione
            const res = await api.get('/api/admin/motivations?include_inactive=true');
            setMotivations(res.data);
        } catch (err) {
            setError("Impossibile caricare le motivazioni.");
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
            setFormData({ code: mot.code, label: mot.label, is_active: mot.is_active });
        } else {
            setEditingId(null);
            setFormData({ code: '', label: '', is_active: true });
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
            alert(err.response?.data?.detail || "Errore nel salvataggio");
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Sei sicuro di voler eliminare questa motivazione? Se è usata, l'operazione verrà bloccata.")) return;
        try {
            await api.delete(`/api/admin/motivations/${id}`);
            fetchMotivations();
        } catch (err) {
            alert(err.response?.data?.detail || "Errore durante l'eliminazione");
        }
    };

    // Cerca su code, label, status (active/inactive testo se serve)
    const filteredMots = motivations.filter(m => searchMatches(m, search));

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Motivations</h1>
                <p className="muted dashboard-copy">Global dictionary for answer motivations</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input type="search" placeholder="Cerca in ogni campo (code, label, ...)" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                        <th>Status</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {!loading && filteredMots.map(m => (
                        <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.5 }}>
                            <td style={{fontWeight: 'bold'}}>{m.code}</td>
                            <td>{m.label}</td>
                            <td>{m.is_active ? <span className="badge">Active</span> : <span className="badge badge--error">Inactive</span>}</td>
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
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{fontWeight: 'bold', display: 'block', marginBottom: '0.3rem'}}>Description</label>
                                <textarea rows="3" value={formData.label} onChange={e => setFormData({...formData, label: e.target.value})} required style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input type="checkbox" id="is_active" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
                                <label htmlFor="is_active" style={{fontWeight: 'bold'}}>Is Active</label>
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