import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api';

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
                    setError('Could not load the term. It may have been deleted.');
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
            // CORREZIONE: Ora reindirizza alla pagina unificata corretta
            navigate('/glossary');
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Error while saving the term.');
        }
    };

    return (
        <div className="container" style={{maxWidth: '600px', marginTop: '2rem'}}>
            <div className="card">
                <header style={{marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? 'Edit Term' : 'Add Term to Glossary'}</h2>
                </header>

                {error && <div style={{color: 'red', marginBottom: '1rem', padding: '0.5rem', border: '1px solid red', borderRadius: '4px'}}>{error}</div>}

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div>
                        <label style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>Word / Term</label>
                        <input type="text" name="word" value={formData.word} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} placeholder="E.g. Inflectional language" />
                    </div>

                    <div>
                        <label style={{display: 'block', marginBottom: '0.5rem', fontWeight: 'bold'}}>Description</label>
                        <textarea name="description" value={formData.description} onChange={handleChange} required rows="6" style={{width: '100%', padding: '0.5rem'}} placeholder="Enter the detailed definition..." />
                    </div>

                    <div style={{display: 'flex', gap: '1rem', marginTop: '1rem'}}>
                        <button type="submit" className="btn btn--primary">Save Term</button>
                        {/* CORREZIONE: Anche il tasto annulla punta alla pagina corretta */}
                        <Link to="/glossary" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}