import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api';

export default function LanguageForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '', name_full: '', position: 0, family: '',
        top_level_family: '', grp: '', latitude: '', longitude: '',
        historical_language: false, assigned_user_id: '',
        isocode: '', glottocode: '', informant: '', supervisor: '',
        source: '', location: ''
    });

    const [users, setUsers] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Carica utenti per la tendina
                const usersRes = await api.get('/api/admin/accounts');
                setUsers(usersRes.data.filter(u => u.role === 'user'));

                if (isEditMode) {
                    const langRes = await api.get(`/api/admin/languages/${id}`);
                    setFormData({
                        ...langRes.data,
                        latitude: langRes.data.latitude ?? '',
                        longitude: langRes.data.longitude ?? '',
                        assigned_user_id: langRes.data.assigned_user_id ?? ''
                    });
                }
            } catch (err) {
                setError('Impossibile caricare i dati.');
            }
        };
        fetchData();
    }, [id, isEditMode]);

    // Funzione fondamentale per gestire la scrittura nei campi del form
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                position: parseInt(formData.position, 10),
                latitude: formData.latitude === '' ? null : parseFloat(formData.latitude),
                longitude: formData.longitude === '' ? null : parseFloat(formData.longitude),
                assigned_user_id: formData.assigned_user_id === '' ? null : parseInt(formData.assigned_user_id, 10)
            };

            if (isEditMode) {
                await api.put(`/api/admin/languages/${id}`, payload);
            } else {
                await api.post('/api/admin/languages', payload);
            }
            navigate('/languages');
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore durante il salvataggio.');
        }
    };

    return (
        <div className="container" style={{maxWidth: '800px', marginTop: '2rem'}}>
            <div className="card">
                <header style={{marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? `Edit Language: ${id}` : 'Add New Language'}</h2>
                </header>

                {error && <div className="alert alert-error" style={{marginBottom: '1rem'}}>{error}</div>}

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>ID Lingua (es. eng)</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Position (Ordine)</label>
                            <input type="number" name="position" value={formData.position} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Nome Completo</label>
                        <input type="text" name="name_full" value={formData.name_full} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Top-level Family</label>
                            <input type="text" name="top_level_family" value={formData.top_level_family} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Family</label>
                            <input type="text" name="family" value={formData.family} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Group</label>
                            <input type="text" name="grp" value={formData.grp} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>ISO code</label>
                            <input type="text" name="isocode" value={formData.isocode} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Glottocode</label>
                            <input type="text" name="glottocode" value={formData.glottocode} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Location</label>
                        <input type="text" name="location" value={formData.location} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Latitudine</label>
                            <input type="number" step="any" name="latitude" value={formData.latitude} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Longitudine</label>
                            <input type="number" step="any" name="longitude" value={formData.longitude} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Supervisor</label>
                            <input type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Informant</label>
                            <input type="text" name="informant" value={formData.informant} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Source</label>
                        <textarea name="source" value={formData.source} onChange={handleChange} rows="2" style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                        <input type="checkbox" id="historical_language" name="historical_language" checked={formData.historical_language} onChange={handleChange} />
                        <label htmlFor="historical_language" style={{fontWeight: 'bold'}}>Lingua Storica</label>
                    </div>

                    <div style={{marginTop: '0.5rem'}}>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Assegna a un utente</label>
                        <select name="assigned_user_id" value={formData.assigned_user_id} onChange={handleChange} style={{width: '100%', padding: '0.5rem', marginTop: '0.25rem'}}>
                            <option value="">-- Nessun utente assegnato --</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.name} {u.surname} ({u.email})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{display: 'flex', gap: '1rem', marginTop: '1.5rem'}}>
                        <button type="submit" className="btn btn--primary">Save Language</button>
                        <Link to="/languages" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}