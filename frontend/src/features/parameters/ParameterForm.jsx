import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api';

export default function ParameterForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '', name: '', position: 0, short_description: '',
        implicational_condition: '', is_active: true,
        schema: '', param_type: '', level_of_comparison: ''
    });

    const [questions, setQuestions] = useState([]);
    const [usage, setUsage] = useState([]);
    const [error, setError] = useState('');
    const [syntaxError, setSyntaxError] = useState('');

    const [lookups, setLookups] = useState({ schemas: [], types: [], levels: [] });
    const [newLookupInputs, setNewLookupInputs] = useState({ schema: '', type: '', level: '' });

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                const [schemasRes, typesRes, levelsRes] = await Promise.all([
                    api.get('/api/admin/parameters/lookups/schemas'),
                    api.get('/api/admin/parameters/lookups/types'),
                    api.get('/api/admin/parameters/lookups/levels')
                ]);
                setLookups({ schemas: schemasRes.data, types: typesRes.data, levels: levelsRes.data });

                if (isEditMode) {
                    const [paramRes, usageRes] = await Promise.all([
                        api.get(`/api/admin/parameters/${id}`),
                        api.get(`/api/admin/parameters/${id}/usage`)
                    ]);
                    const { questions: fetchedQuestions, ...paramData } = paramRes.data;
                    setFormData(paramData);
                    setQuestions(fetchedQuestions || []);
                    setUsage(usageRes.data || []);
                }
            } catch (err) {
                setError('Errore nel caricamento dei dati.');
            }
        };
        fetchInitialData();
    }, [id, isEditMode]);

    // --- DEBOUNCE PER IL TUO PARSER PYTHON ---
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (formData.implicational_condition !== undefined && formData.implicational_condition.trim() !== '') {
                try {
                    const res = await api.post('/api/admin/parameters/validate-condition', {
                        condition: formData.implicational_condition
                    });
                    if (res.data.valid) {
                        setSyntaxError('');
                    } else {
                        setSyntaxError(res.data.error);
                    }
                } catch (err) {
                    console.error("Errore di validazione server", err);
                }
            } else {
                setSyntaxError('');
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [formData.implicational_condition]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleAddLookup = async (typeCategory, endpoint, inputKey) => {
        const valueToAdd = newLookupInputs[inputKey].trim();
        if (!valueToAdd) return;
        try {
            const res = await api.post(`/api/admin/parameters/lookups/${endpoint}`, { label: valueToAdd });
            setLookups(prev => ({ ...prev, [typeCategory]: [...prev[typeCategory], res.data] }));
            const field = inputKey === 'type' ? 'param_type' : (inputKey === 'level' ? 'level_of_comparison' : 'schema');
            setFormData(prev => ({ ...prev, [field]: res.data.label }));
            setNewLookupInputs(prev => ({ ...prev, [inputKey]: '' }));
        } catch (err) { alert("Errore aggiunta lookup"); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (syntaxError) {
            alert("Correggi gli errori di sintassi nella formula prima di salvare!");
            return;
        }
        try {
            const payload = { ...formData, position: parseInt(formData.position, 10) };
            isEditMode ? await api.put(`/api/admin/parameters/${id}`, payload) : await api.post('/api/admin/parameters', payload);
            navigate('/admin/parameters');
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore salvataggio.');
        }
    };

    // --- ELIMINAZIONE DELLA DOMANDA ---
    const handleDeleteQuestion = async (questionId) => {
        if (!window.confirm(`Sei sicuro di voler eliminare la domanda ${questionId} in modo permanente?`)) return;

        try {
            await api.delete(`/api/admin/questions/${questionId}`);
            // Ricarica i dati del parametro per avere la lista domande aggiornata
            const paramRes = await api.get(`/api/admin/parameters/${id}`);
            setQuestions(paramRes.data.questions || []);
        } catch (err) {
            alert(err.response?.data?.detail || "Errore durante l'eliminazione della domanda.");
        }
    };

    // Separazione delle domande per la visualizzazione
    const normalQuestions = questions.filter(q => !q.is_stop_question);
    const stopQuestions = questions.filter(q => q.is_stop_question);

    // Stili riutilizzabili per le righe delle domande
    const qRowStyle = {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '0.75rem', padding: '0.75rem 0.9rem', marginBottom: '0.5rem',
        background: 'var(--surface, #fff)', border: '1px solid var(--border, #dadde2)',
        borderRadius: '0.6rem'
    };

    return (
        <div className="container" style={{maxWidth: '1200px', marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem'}}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="card">
                    <header style={{marginBottom: '1.5rem'}}>
                        <h2>{isEditMode ? `Edit Parameter: ${id}` : 'Add New Parameter'}</h2>
                    </header>

                    {error && <div className="alert alert-error" style={{marginBottom: '1rem'}}>{error}</div>}

                    <form onSubmit={handleSubmit}>
                        {/* --- INIZIO CAMPI FORM (Invariati) --- */}
                        <div className="grid grid-2" style={{gap: '1rem', marginBottom: '1rem'}}>
                            <div>
                                <label style={{fontWeight: 'bold'}}>ID Parametro</label>
                                <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{width: '100%', padding: '0.5rem'}} />
                            </div>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Position</label>
                                <input type="number" name="position" value={formData.position} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                            </div>
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Name</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                        </div>

                        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem', background: 'var(--surface-2)', padding: '1rem', borderRadius: '8px'}}>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Schema</label>
                                <select name="schema" value={formData.schema} onChange={handleChange} style={{width: '100%', padding: '0.5rem', marginBottom: '0.5rem'}}>
                                    <option value="">-- Select --</option>
                                    {lookups.schemas.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
                                </select>
                                <div style={{display: 'flex', gap: '0.25rem'}}>
                                    <input type="text" placeholder="Nuovo..." value={newLookupInputs.schema} onChange={e => setNewLookupInputs({...newLookupInputs, schema: e.target.value})} style={{flex: 1, padding: '0.25rem'}}/>
                                    <button type="button" onClick={() => handleAddLookup('schemas', 'schemas', 'schema')} className="btn btn--small">+</button>
                                </div>
                            </div>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Type</label>
                                <select name="param_type" value={formData.param_type} onChange={handleChange} style={{width: '100%', padding: '0.5rem', marginBottom: '0.5rem'}}>
                                    <option value="">-- Select --</option>
                                    {lookups.types.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
                                </select>
                                <div style={{display: 'flex', gap: '0.25rem'}}>
                                    <input type="text" placeholder="Nuovo..." value={newLookupInputs.type} onChange={e => setNewLookupInputs({...newLookupInputs, type: e.target.value})} style={{flex: 1, padding: '0.25rem'}}/>
                                    <button type="button" onClick={() => handleAddLookup('types', 'types', 'type')} className="btn btn--small">+</button>
                                </div>
                            </div>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Level</label>
                                <select name="level_of_comparison" value={formData.level_of_comparison} onChange={handleChange} style={{width: '100%', padding: '0.5rem', marginBottom: '0.5rem'}}>
                                    <option value="">-- Select --</option>
                                    {lookups.levels.map(l => <option key={l.id} value={l.label}>{l.label}</option>)}
                                </select>
                                <div style={{display: 'flex', gap: '0.25rem'}}>
                                    <input type="text" placeholder="Nuovo..." value={newLookupInputs.level} onChange={e => setNewLookupInputs({...newLookupInputs, level: e.target.value})} style={{flex: 1, padding: '0.25rem'}}/>
                                    <button type="button" onClick={() => handleAddLookup('levels', 'levels', 'level')} className="btn btn--small">+</button>
                                </div>
                            </div>
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Breve Descrizione</label>
                            <textarea name="short_description" value={formData.short_description} onChange={handleChange} rows="3" style={{width: '100%', padding: '0.5rem'}} />
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Condition</label>
                            <input
                                type="text"
                                name="implicational_condition"
                                value={formData.implicational_condition || ''}
                                onChange={handleChange}
                                placeholder="e.g. (+FGM | -ABC)"
                                style={{width: '100%', padding: '0.5rem', borderColor: syntaxError ? 'red' : 'inherit'}}
                            />
                            {syntaxError && <p style={{color: 'red', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 'bold'}}>⚠️ {syntaxError}</p>}
                        </div>

                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem'}}>
                            <input type="checkbox" id="is_active" name="is_active" checked={formData.is_active} onChange={handleChange} />
                            <label htmlFor="is_active" style={{fontWeight: 'bold'}}>Parametro Attivo</label>
                        </div>
                        {/* --- FINE CAMPI FORM --- */}

                        <hr style={{ margin: '2rem 0', borderColor: 'var(--border)' }} />

                        <button type="submit" className="btn btn--primary">Save Parameter</button>
                        <Link to="/admin/parameters" className="btn" style={{marginLeft: '1rem'}}>Cancel</Link>
                    </form>
                </div>

                {/* --- SEZIONE QUESTIONS (Visibile solo in Edit Mode) --- */}
                {isEditMode && (
                    <div className="card">
                        <h3>Questions</h3>
                        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1rem' }}>
                            {/* Colonna Domande Normali */}
                            <div>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Questions</label>
                                {normalQuestions.length > 0 ? (
                                    <div>
                                        {normalQuestions.map(q => (
                                            <div key={q.id} style={qRowStyle}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{q.id}</span>
                                                    <span>{q.text}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/questions/${q.id}/edit`} className="btn btn--small">Edit</Link>
                                                    <button type="button" onClick={() => handleDeleteQuestion(q.id)} className="btn btn--small" style={{ color: 'red', borderColor: 'red' }}>Delete</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ ...qRowStyle, justifyContent: 'center' }}><span className="muted">No questions</span></div>
                                )}
                            </div>

                            {/* Colonna Stop Questions */}
                            <div>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Stop questions</label>
                                {stopQuestions.length > 0 ? (
                                    <div>
                                        {stopQuestions.map(q => (
                                            <div key={q.id} style={qRowStyle}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{q.id}</span>
                                                    <span>{q.text}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/questions/${q.id}/edit`} className="btn btn--small">Edit</Link>
                                                    <button type="button" onClick={() => handleDeleteQuestion(q.id)} className="btn btn--small btn--danger" style={{ color: 'red', borderColor: 'red' }}>Delete</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ ...qRowStyle, justifyContent: 'center' }}><span className="muted">No stop questions</span></div>
                                )}
                            </div>
                        </div>

                        <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
                            {/* Assicurati che in React Router tu abbia una rotta per /admin/questions/add */}
                            <Link to={`/admin/questions/add?param_id=${id}`} className="btn btn--primary">
                                Add a new question
                            </Link>
                        </div>
                    </div>
                )}
            </div>

            <aside>
                <div className="card" style={{position: 'sticky', top: '2rem'}}>
                    <h3>Where Used</h3>
                    <p className="small muted" style={{marginBottom: '1rem'}}>
                        Other parameters that depend on this one.
                    </p>

                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                        {usage.map(p => (
                            <Link key={p.id} to={`/admin/parameters/${p.id}/edit`} className="card" style={{padding: '0.5rem', fontSize: '0.85rem', textDecoration: 'none', borderLeft: '4px solid var(--brand)'}}>
                                <strong>{p.id}</strong>: {p.name}
                            </Link>
                        ))}
                        {usage.length === 0 && <p className="muted italic small">Not used by other parameters.</p>}
                    </div>
                </div>
            </aside>
        </div>
    );
}