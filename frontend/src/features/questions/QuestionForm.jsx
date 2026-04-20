import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function QuestionForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '',
        parameter_id: '',
        text: '',
        instruction: '',
        is_stop_question: false
    });
    const [parameters, setParameters] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                // Chiamata centralizzata
                const paramsRes = await api.get('/api/admin/parameters');
                setParameters(paramsRes.data || []);

                if (isEditMode) {
                    // Chiamata centralizzata
                    const questionRes = await api.get(`/api/admin/questions/${id}`);
                    setFormData({
                        id: questionRes.data.id || '',
                        parameter_id: questionRes.data.parameter_id || '',
                        text: questionRes.data.text || '',
                        instruction: questionRes.data.instruction || '',
                        is_stop_question: questionRes.data.is_stop_question ?? false
                    });
                }
            } catch (err) {
                console.error(err);
                setError('Impossibile caricare i dati della domanda.');
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

        if (!formData.id.trim() || !formData.parameter_id.trim() || !formData.text.trim()) {
            setError('ID, parametro e testo sono obbligatori.');
            return;
        }

        try {
            const payload = {
                ...formData,
                id: formData.id.trim(),
                parameter_id: formData.parameter_id.trim(),
                text: formData.text.trim(),
                instruction: formData.instruction.trim() === '' ? null : formData.instruction.trim()
            };

            // Chiamate centralizzate
            if (isEditMode) {
                await api.put(`/api/admin/questions/${id}`, payload);
            } else {
                await api.post('/api/admin/questions', payload);
            }

            navigate('/admin/questions');
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.detail || 'Errore durante il salvataggio della domanda.');
        }
    };

    return (
        <div className="container" style={{ maxWidth: '800px', marginTop: '2rem' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem' }}>
                    <h2>{isEditMode ? `Edit Question: ${id}` : 'Add New Question'}</h2>
                </header>

                {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Question ID (es. Q_1.1)</label>
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
                            <label style={{ display: 'block', fontWeight: 'bold' }}>Parametro</label>
                            <select
                                name="parameter_id"
                                value={formData.parameter_id}
                                onChange={handleChange}
                                required
                                style={{ width: '100%', padding: '0.5rem' }}
                            >
                                <option value="">Seleziona un parametro</option>
                                {parameters.map((param) => (
                                    <option key={param.id} value={param.id}>
                                        {param.id} - {param.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold' }}>Testo della domanda</label>
                        <textarea
                            name="text"
                            value={formData.text}
                            onChange={handleChange}
                            required
                            rows="4"
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold' }}>Istruzione (opzionale)</label>
                        <textarea
                            name="instruction"
                            value={formData.instruction}
                            onChange={handleChange}
                            rows="3"
                            style={{ width: '100%', padding: '0.5rem' }}
                            placeholder="Indicazioni aggiuntive per il compilatore"
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <input
                            type="checkbox"
                            id="is_stop_question"
                            name="is_stop_question"
                            checked={formData.is_stop_question}
                            onChange={handleChange}
                        />
                        <label htmlFor="is_stop_question" style={{ fontWeight: 'bold' }}>Stop Question</label>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        <button type="submit" className="btn btn--primary">Save Question</button>
                        <Link to="/admin/questions" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}