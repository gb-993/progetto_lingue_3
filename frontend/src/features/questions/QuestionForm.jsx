import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import CreatableSelect from 'react-select/creatable';
import api from '../../api';

export default function QuestionForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);
    const [searchParams] = useSearchParams();
    const paramFromUrl = searchParams.get('param_id');

    const [formData, setFormData] = useState({
        id: '',
        parameter_id: '',
        text: '',
        instruction: '',
        instruction_yes: '', // <-- AGGIUNTO
        instruction_no: '',  // <-- AGGIUNTO
        is_stop_question: false,
        allowed_motivations: []
    });

    const [parameters, setParameters] = useState([]);
    const [allMotivations, setAllMotivations] = useState([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [showCreator, setShowCreator] = useState(false);
    const [newMotData, setNewMotData] = useState({ code: '', label: '' });

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [paramsRes, motsRes] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/motivations?include_inactive=false')
                ]);
                setParameters(paramsRes.data || []);
                setAllMotivations(motsRes.data || []);

                if (isEditMode) {
                    const questionRes = await api.get(`/api/admin/questions/${id}`);
                    setFormData({
                        id: questionRes.data.id || '',
                        parameter_id: questionRes.data.parameter_id || '',
                        text: questionRes.data.text || '',
                        instruction: questionRes.data.instruction || '',
                        instruction_yes: questionRes.data.instruction_yes || '', // <-- AGGIUNTO
                        instruction_no: questionRes.data.instruction_no || '',   // <-- AGGIUNTO
                        is_stop_question: questionRes.data.is_stop_question ?? false,
                        allowed_motivations: questionRes.data.allowed_motivations || []
                    });
                } else if (paramFromUrl) {
                    setFormData((prev) => ({ ...prev, parameter_id: paramFromUrl }));
                }
            } catch (err) {
                setError('Impossibile caricare i dati.');
            }
        };
        fetchData();
    }, [id, isEditMode, paramFromUrl]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const selectedOptions = allMotivations
        .filter(m => formData.allowed_motivations.includes(m.id))
        .map(m => ({ value: m.id, label: `${m.code} - ${m.label}` }));

    const handleSelectChange = (newValue) => {
        setFormData(prev => ({
            ...prev,
            allowed_motivations: newValue ? newValue.map(v => v.value) : []
        }));
    };

    const handleCreateOption = (inputValue) => {
        setNewMotData({ code: inputValue.toUpperCase(), label: '' });
        setShowCreator(true);
    };

    const saveNewMotivation = async () => {
        if (!newMotData.code || !newMotData.label) return;
        try {
            const res = await api.post('/api/admin/motivations', newMotData);
            setAllMotivations(prev => [...prev, res.data]);
            setFormData(prev => ({
                ...prev,
                allowed_motivations: [...prev.allowed_motivations, res.data.id]
            }));
            setShowCreator(false);
        } catch (err) {
            alert("Errore nella creazione della motivazione.");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            // Pulizia spazi bianchi extra prima di salvare
            const payload = {
                ...formData,
                instruction: formData.instruction?.trim() || null,
                instruction_yes: formData.instruction_yes?.trim() || null, // <-- AGGIUNTO
                instruction_no: formData.instruction_no?.trim() || null    // <-- AGGIUNTO
            };

            if (isEditMode) {
                await api.put(`/api/admin/questions/${id}`, payload);
            } else {
                await api.post('/api/admin/questions', payload);
            }
            navigate(`/admin/parameters/${formData.parameter_id}/edit`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore durante il salvataggio.');
        } finally {
            setIsLoading(false);
        }
    };

    const cancelLink = formData.parameter_id
        ? `/admin/parameters/${formData.parameter_id}/edit`
        : (paramFromUrl ? `/admin/parameters/${paramFromUrl}/edit` : '/admin/questions');

    return (
        <div className="container" style={{ maxWidth: '900px', marginTop: '2rem', position: 'relative' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? `Edit Question: ${id}` : 'Add New Question'}</h2>
                </header>

                {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Question ID</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{ width: '100%', padding: '0.6rem' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Parameter</label>
                            <select name="parameter_id" value={formData.parameter_id} onChange={handleChange} required style={{ width: '100%', padding: '0.6rem' }}>
                                <option value="">Select parameter...</option>
                                {parameters.map((p) => <option key={p.id} value={p.id}>{p.id} - {p.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Question Text</label>
                        <textarea name="text" value={formData.text} onChange={handleChange} required rows="3" style={{ width: '100%', padding: '0.6rem' }} />
                    </div>

                    {/* SEZIONE ISTRUZIONI */}
                    <div style={{ background: 'var(--surface, #fafafa)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h4 style={{marginTop: 0, marginBottom: '1rem'}}>Instructions</h4>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>General Instructions (optional)</label>
                            <textarea name="instruction" value={formData.instruction} onChange={handleChange} rows="2" style={{ width: '100%', padding: '0.6rem' }} placeholder="Shown to users regardless of their answer..." />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem', color: 'green' }}>Instruction for YES</label>
                                <textarea name="instruction_yes" value={formData.instruction_yes} onChange={handleChange} rows="3" style={{ width: '100%', padding: '0.6rem', borderLeft: '4px solid green' }} placeholder="Specific instruction if the user answers YES..." />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem', color: 'red' }}>Instruction for NO</label>
                                <textarea name="instruction_no" value={formData.instruction_no} onChange={handleChange} rows="3" style={{ width: '100%', padding: '0.6rem', borderLeft: '4px solid red' }} placeholder="Specific instruction if the user answers NO..." />
                            </div>
                        </div>
                    </div>

                    <div style={{ background: 'var(--surface-2, #f8fafc)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                            Allowed Motivations (for NO answers)
                        </label>
                        <p className="small muted" style={{ marginBottom: '0.8rem' }}>
                            Select existing motivations or type a new code to create one on the fly. Manage the global dictionary in the Motivations menu.
                        </p>
                        <CreatableSelect
                            isMulti
                            options={allMotivations.map(m => ({ value: m.id, label: `${m.code} - ${m.label}` }))}
                            value={selectedOptions}
                            onChange={handleSelectChange}
                            onCreateOption={handleCreateOption}
                            placeholder="Search or create motivation..."
                            formatCreateLabel={(inputValue) => `Create new: "${inputValue.toUpperCase()}"`}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="checkbox" id="is_stop_question" name="is_stop_question" checked={formData.is_stop_question} onChange={handleChange} />
                        <label htmlFor="is_stop_question" style={{ fontWeight: 'bold' }}>Stop Question</label>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                        <button type="submit" className="btn btn--primary" disabled={isLoading}>
                            {isLoading ? 'Saving...' : 'Save Question'}
                        </button>
                        <Link to={cancelLink} className="btn">Cancel</Link>
                    </div>
                </form>
            </div>

            {/* MODAL CREAZIONE AL VOLO (Invariato) */}
            {showCreator && (
                <div style={modalOverlayStyle}>
                    <div className="card" style={{ width: '400px' }}>
                        <h3>New Motivation</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="small">Code</label>
                            <input type="text" value={newMotData.code} onChange={e => setNewMotData({...newMotData, code: e.target.value.toUpperCase()})} style={{ width: '100%', padding: '0.4rem' }} />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="small">Description (Label)</label>
                            <textarea rows="3" value={newMotData.label} onChange={e => setNewMotData({...newMotData, label: e.target.value})} style={{ width: '100%', padding: '0.4rem' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn" onClick={() => setShowCreator(false)}>Cancel</button>
                            <button className="btn btn--primary" onClick={saveNewMotivation}>Create & Add</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
};