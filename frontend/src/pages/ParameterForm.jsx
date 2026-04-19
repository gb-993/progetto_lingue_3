import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';

export default function ParameterForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '',
        name: '',
        position: 0,
        short_description: '',
        implicational_condition: '',
        is_active: true,
        schema: '',
        param_type: '',
        level_of_comparison: ''
    });
    const [error, setError] = useState('');

    useEffect(() => {
        if (isEditMode) {
            const fetchParameter = async () => {
                try {
                    const token = localStorage.getItem('token');
                    const res = await axios.get(`http://localhost:8000/api/admin/parameters/${id}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    // Riempiamo i campi curando i null
                    setFormData({
                        id: res.data.id || '',
                        name: res.data.name || '',
                        position: res.data.position || 0,
                        short_description: res.data.short_description || '',
                        implicational_condition: res.data.implicational_condition || '',
                        is_active: res.data.is_active ?? true,
                        schema: res.data.schema || '',
                        param_type: res.data.param_type || '',
                        level_of_comparison: res.data.level_of_comparison || ''
                    });
                } catch (err) {
                    console.error(err);
                    setError('Impossibile caricare il parametro.');
                }
            };
            fetchParameter();
        }
    }, [id, isEditMode]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
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

            // Converti la posizione in numero intero per il backend
            const payload = { ...formData, position: parseInt(formData.position, 10) };
            // Se stringa vuota passa null per la condizione implicazionale (come richiede il db in caso di assenza)
            if (payload.implicational_condition === "") payload.implicational_condition = null;

            if (isEditMode) {
                await axios.put(`http://localhost:8000/api/admin/parameters/${id}`, payload, config);
            } else {
                await axios.post('http://localhost:8000/api/admin/parameters', payload, config);
            }
            navigate('/admin/parameters');
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Errore durante il salvataggio.');
        }
    };

    return (
        <div className="container" style={{maxWidth: '800px', marginTop: '2rem'}}>
            <div className="card">
                <header style={{marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? `Edit Parameter: ${id}` : 'Add New Parameter'}</h2>
                </header>

                {error && <div style={{color: 'red', marginBottom: '1rem'}}>{error}</div>}

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>ID Parametro (es. P1)</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Position (Ordine di visualizzazione)</label>
                            <input type="number" name="position" value={formData.position} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Nome</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Breve Descrizione</label>
                        <textarea name="short_description" value={formData.short_description} onChange={handleChange} rows="3" style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Tipo (es. Nominal)</label>
                            <input type="text" name="param_type" value={formData.param_type} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Schema</label>
                            <input type="text" name="schema" value={formData.schema} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Level of Comparison</label>
                            <input type="text" name="level_of_comparison" value={formData.level_of_comparison} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Condizione Implicazionale</label>
                        <input type="text" name="implicational_condition" value={formData.implicational_condition} onChange={handleChange} placeholder="es. P1=+" style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                        <input type="checkbox" id="is_active" name="is_active" checked={formData.is_active} onChange={handleChange} />
                        <label htmlFor="is_active" style={{fontWeight: 'bold'}}>Parametro Attivo</label>
                    </div>

                    <div style={{display: 'flex', gap: '1rem', marginTop: '1rem'}}>
                        <button type="submit" className="btn btn--primary">Save Parameter</button>
                        <Link to="/admin/parameters" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}