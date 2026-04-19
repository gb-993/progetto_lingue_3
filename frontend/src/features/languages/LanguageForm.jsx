import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';

export default function LanguageForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '',
        name_full: '',
        position: 0,
        family: '',
        top_level_family: '',
        latitude: '',
        longitude: '',
        historical_language: false,
        assigned_user_id: ''
    });

    // Nuovo stato per la lista degli utenti
    const [users, setUsers] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const token = localStorage.getItem('token');
                const config = { headers: { Authorization: `Bearer ${token}` } };

                // 1. Fetch degli utenti disponibili (escludendo gli admin)
                const usersRes = await axios.get('http://localhost:8000/api/admin/accounts', config);
                const standardUsers = usersRes.data.filter(u => u.role === 'user');
                setUsers(standardUsers);

                // 2. Se in modifica, fetch dei dati della lingua
                if (isEditMode) {
                    const langRes = await axios.get(`http://localhost:8000/api/admin/languages/${id}`, config);
                    setFormData({
                        id: langRes.data.id || '',
                        name_full: langRes.data.name_full || '',
                        position: langRes.data.position || 0,
                        family: langRes.data.family || '',
                        top_level_family: langRes.data.top_level_family || '',
                        latitude: langRes.data.latitude ?? '',
                        longitude: langRes.data.longitude ?? '',
                        historical_language: langRes.data.historical_language ?? false,
                        assigned_user_id: langRes.data.assigned_user_id ?? ''
                    });
                }
            } catch (err) {
                console.error(err);
                setError('Impossibile caricare i dati.');
            }
        };

        fetchData();
    }, [id, isEditMode]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const token = localStorage.getItem('token');
            const config = { headers: { Authorization: `Bearer ${token}` } };

            const payload = {
                ...formData,
                id: formData.id.trim(),
                name_full: formData.name_full.trim(),
                position: parseInt(formData.position, 10),
                family: formData.family.trim(),
                top_level_family: formData.top_level_family.trim(),
                latitude: formData.latitude === '' ? null : parseFloat(formData.latitude),
                longitude: formData.longitude === '' ? null : parseFloat(formData.longitude),
                // Se la stringa è vuota (Nessun utente), manda null al database
                assigned_user_id: formData.assigned_user_id === '' ? null : parseInt(formData.assigned_user_id, 10)
            };

            if (isEditMode) {
                await axios.put(`http://localhost:8000/api/admin/languages/${id}`, payload, config);
            } else {
                await axios.post('http://localhost:8000/api/admin/languages', payload, config);
            }

            navigate('/languages');
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Errore durante il salvataggio della lingua.');
        }
    };

    return (
        <div className="container" style={{ maxWidth: '900px', marginTop: '2rem' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem' }}>
                    <h2>{isEditMode ? `Edit Language: ${id}` : 'Add New Language'}</h2>
                </header>

                {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Language ID (es. ita)</label>
                            <input
                                type="text"
                                name="id"
                                value={formData.id}
                                onChange={handleChange}
                                required
                                disabled={isEditMode}
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Position</label>
                            <input
                                type="number"
                                name="position"
                                value={formData.position}
                                onChange={handleChange}
                                required
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold' }}>Full Name</label>
                        <input
                            type="text"
                            name="name_full"
                            value={formData.name_full}
                            onChange={handleChange}
                            required
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Family</label>
                            <input
                                type="text"
                                name="family"
                                value={formData.family}
                                onChange={handleChange}
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Top Level Family</label>
                            <input
                                type="text"
                                name="top_level_family"
                                value={formData.top_level_family}
                                onChange={handleChange}
                                style={{ width: '100%', padding: '0.5rem' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Latitude</label>
                            <input
                                type="number"
                                step="any"
                                name="latitude"
                                value={formData.latitude}
                                onChange={handleChange}
                                style={{ width: '100%', padding: '0.5rem' }}
                                placeholder="Es. 44.4949"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Longitude</label>
                            <input
                                type="number"
                                step="any"
                                name="longitude"
                                value={formData.longitude}
                                onChange={handleChange}
                                style={{ width: '100%', padding: '0.5rem' }}
                                placeholder="Es. 11.3426"
                            />
                        </div>
                    </div>

                    {/* MENU A TENDINA PER GLI UTENTI */}
                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold' }}>Assigned User (opzionale)</label>
                        <select
                            name="assigned_user_id"
                            value={formData.assigned_user_id}
                            onChange={handleChange}
                            style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border)', borderRadius: '10px' }}
                        >
                            <option value="">-- Nessun utente assegnato --</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.name} {u.surname} ({u.email})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            id="historical_language"
                            name="historical_language"
                            checked={formData.historical_language}
                            onChange={handleChange}
                        />
                        <label htmlFor="historical_language" style={{ fontWeight: 'bold' }}>Historical Language</label>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        <button type="submit" className="btn btn--primary">Save Language</button>
                        <Link to="/languages" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}