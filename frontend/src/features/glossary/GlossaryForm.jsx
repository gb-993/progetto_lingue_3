import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function GlossaryForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        word: '',
        description: ''
    });
    const [error, setError] = useState('');

    useEffect(() => {
        if (isEditMode) {
            const fetchTerm = async () => {
                try {
                    const res = await api.get(`/api/admin/glossary/${id}`);
                    setFormData({
                        word: res.data.word || '',
                        description: res.data.description || ''
                    });
                } catch (err) {
                    console.error(err);
                    setError('Impossibile caricare il termine. Potrebbe essere stato eliminato.');
                }
            };
            fetchTerm();
        }
    }, [id, isEditMode]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            if (isEditMode) {
                await api.put(`/api/admin/glossary/${id}`, formData);
            } else {
                await api.post('/api/admin/glossary', formData);
            }
            navigate('/admin/glossary');
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Errore durante il salvataggio del termine.');
        }
    };

    return (
        <div className="container" style={{maxWidth: '600px', marginTop: '2rem'}}>
            <div className="card">
                <header style={{marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? 'Modifica Termine' : 'Aggiungi Termine al Glossario'}</h2>
                </header>

                {error && <div style={{color: 'red', marginBottom: '1rem', padding: '0.5rem', border: '1px solid red', borderRadius: '4px'}}>{error}</div>}

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div>
                        <label style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>Parola / Termine</label>
                        <input type="text" name="word" value={formData.word} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} placeholder="Es. Lingua flessiva" />
                    </div>

                    <div>
                        <label style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>Descrizione</label>
                        <textarea name="description" value={formData.description} onChange={handleChange} required rows="6" style={{width: '100%', padding: '0.5rem'}} placeholder="Inserisci la definizione dettagliata..." />
                    </div>

                    <div style={{display: 'flex', gap: '1rem', marginTop: '1rem'}}>
                        <button type="submit" className="btn btn--primary">Salva Termine</button>
                        <Link to="/admin/glossary" className="btn">Annulla</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}