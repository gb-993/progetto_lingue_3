import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api';

export default function ParameterForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [initialData, setInitialData] = useState(null);
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

    // Stati per logica Modifiche
    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);

    // Stati per il Modal di Disattivazione
    const [showDeactivateModal, setShowDeactivateModal] = useState(false);
    const [deactivateForm, setDeactivateForm] = useState({ password: '', reason: '' });

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
                    const { questions: fetchedQuestions, change_logs: fetchedLogs, ...paramData } = paramRes.data;
                    setFormData(paramData);
                    setInitialData(paramData);
                    setQuestions(fetchedQuestions || []);
                    setChangeLogs(fetchedLogs || []);
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
            const payload = { ...formData, position: parseInt(formData.position, 10), change_note: changeNote };
            isEditMode ? await api.put(`/api/admin/parameters/${id}`, payload) : await api.post('/api/admin/parameters', payload);
            navigate('/admin/parameters');
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore salvataggio.');
        }
    };

    // --- DISATTIVAZIONE / RIATTIVAZIONE DEL PARAMETRO ---
    const handleToggleActiveClick = async (e) => {
        e.preventDefault();
        if (!isEditMode) return;

        if (formData.is_active) {
            if (usage.length > 0) {
                alert("Non puoi disattivare questo parametro perché è menzionato nelle condizioni implicazionali di altri parametri (vedi sidebar).");
                return;
            }
            setShowDeactivateModal(true);
        } else {
            if(window.confirm("Vuoi riattivare questo parametro?")) {
                try {
                    await api.post(`/api/admin/parameters/${id}/reactivate`);
                    setFormData(prev => ({ ...prev, is_active: true }));
                } catch (err) {
                    alert(err.response?.data?.detail || 'Errore durante la riattivazione');
                }
            }
        }
    };

    const submitDeactivation = async (e) => {
        e.preventDefault();
        try {
            await api.post(`/api/admin/parameters/${id}/deactivate`, deactivateForm);
            setShowDeactivateModal(false);
            setDeactivateForm({ password: '', reason: '' });
            setFormData(prev => ({ ...prev, is_active: false }));
            alert("Parametro disattivato con successo.");
        } catch (err) {
            alert(err.response?.data?.detail || "Errore durante la disattivazione. Password corretta?");
        }
    };

    // --- DISATTIVAZIONE / RIATTIVAZIONE DELLA DOMANDA ---
    const handleToggleQuestionActive = async (questionId, currentStatus) => {
        const actionText = currentStatus ? 'disattivare' : 'riattivare';
        if (!window.confirm(`Sei sicuro di voler ${actionText} la domanda ${questionId}? (Scomparirà dalla compilazione)`)) return;

        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            // Ricarica i dati per avere la lista aggiornata
            const paramRes = await api.get(`/api/admin/parameters/${id}`);
            setQuestions(paramRes.data.questions || []);
        } catch (err) {
            alert(err.response?.data?.detail || `Errore durante il cambio di stato della domanda.`);
        }
    };

    // Verifica se ci sono state modifiche per abilitare la textarea delle motivazioni
    const safeString = (val) => val === null || val === undefined ? '' : String(val);
    const isDirty = isEditMode && initialData && (
        safeString(formData.name) !== safeString(initialData.name) ||
        safeString(formData.position) !== safeString(initialData.position) ||
        safeString(formData.short_description) !== safeString(initialData.short_description) ||
        safeString(formData.implicational_condition) !== safeString(initialData.implicational_condition) ||
        safeString(formData.schema) !== safeString(initialData.schema) ||
        safeString(formData.param_type) !== safeString(initialData.param_type) ||
        safeString(formData.level_of_comparison) !== safeString(initialData.level_of_comparison)
    );

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

            {/* MODAL DISATTIVAZIONE */}
            {showDeactivateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '400px', background: '#fff', padding: '2rem' }}>
                        <h3 style={{ color: 'red', marginTop: 0 }}>Disattiva Parametro</h3>
                        <p className="small muted">Inserisci la tua password di amministratore per confermare l'operazione.</p>
                        <form onSubmit={submitDeactivation}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ fontWeight: 'bold' }}>Admin Password</label>
                                <input type="password" required value={deactivateForm.password} onChange={e => setDeactivateForm({...deactivateForm, password: e.target.value})} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ fontWeight: 'bold' }}>Motivo (Opzionale)</label>
                                <textarea rows="2" value={deactivateForm.reason} onChange={e => setDeactivateForm({...deactivateForm, reason: e.target.value})} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" className="btn" onClick={() => setShowDeactivateModal(false)}>Annulla</button>
                                <button type="submit" className="btn btn--danger" style={{ background: 'red', color: 'white' }}>Conferma Disattivazione</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="card">
                    <header style={{marginBottom: '1.5rem'}}>
                        <h2>{isEditMode ? `Edit Parameter: ${id}` : 'Add New Parameter'}</h2>
                    </header>

                    {error && <div className="alert alert-error" style={{marginBottom: '1rem'}}>{error}</div>}

                    <form onSubmit={handleSubmit}>
                        {/* --- INIZIO CAMPI FORM --- */}
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

                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', background: 'var(--surface-2)', padding: '1rem', borderRadius: '8px'}}>
                            <input
                                type="checkbox"
                                id="is_active"
                                checked={formData.is_active}
                                onChange={() => {}}
                                readOnly
                            />
                            <label style={{fontWeight: 'bold'}}>
                                Parametro Attivo
                            </label>
                            {isEditMode && (
                                <button
                                    type="button"
                                    onClick={handleToggleActiveClick}
                                    className={`btn btn--small ${usage.length > 0 && formData.is_active ? 'btn--disabled' : ''}`}
                                    style={{ marginLeft: 'auto' }}
                                    title={usage.length > 0 ? "Bloccato: usato in altre condizioni" : ""}
                                >
                                    {formData.is_active ? 'Disattiva Parametro...' : 'Riattiva Parametro'}
                                </button>
                            )}
                            {usage.length > 0 && formData.is_active && (
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>🔒 Bloccato dalle dipendenze</span>
                            )}
                        </div>
                        {/* --- FINE CAMPI FORM --- */}

                        <hr style={{ margin: '2rem 0', borderColor: 'var(--border)' }} />

                        {/* --- SEZIONE MOTIVAZIONE MODIFICA (Sempre visibile in Edit Mode) --- */}
                        {isEditMode && (
                            <div style={{
                                background: isDirty ? '#fff3cd' : 'var(--surface-2, #f8fafc)',
                                padding: '1.5rem',
                                borderRadius: '8px',
                                border: isDirty ? '1px solid #ffe69c' : '1px solid var(--border)',
                                marginBottom: '1.5rem'
                            }}>
                                <h4 style={{ marginTop: 0, color: isDirty ? '#664d03' : 'inherit', marginBottom: '0.5rem' }}>
                                    {isDirty ? '⚠️ Modifiche Rilevate' : 'Audit Log & Note'}
                                </h4>
                                <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                    {isDirty
                                        ? 'Hai modificato i dati di questo parametro. Devi inserire una motivazione per poter salvare.'
                                        : 'Nessuna modifica rilevata. Modifica almeno un campo per abilitare il salvataggio e inserire una nota.'}
                                </p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div>
                                        <textarea
                                            value={changeNote}
                                            onChange={e => setChangeNote(e.target.value)}
                                            rows="4"
                                            placeholder="Descrivi il motivo della modifica..."
                                            disabled={!isDirty} // Disabilitata se non ci sono modifiche
                                            style={{
                                                width: '100%',
                                                padding: '0.5rem',
                                                borderColor: (isDirty && !changeNote.trim()) ? 'red' : 'var(--border)',
                                                borderRadius: '4px',
                                                backgroundColor: !isDirty ? 'var(--surface-2, #e2e8f0)' : '#fff',
                                                cursor: !isDirty ? 'not-allowed' : 'text',
                                                opacity: !isDirty ? 0.7 : 1
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn--small"
                                            style={{
                                                marginTop: '0.5rem',
                                                opacity: !isDirty ? 0.5 : 1,
                                                cursor: !isDirty ? 'not-allowed' : 'pointer'
                                            }}
                                            disabled={!isDirty} // Disabilitato se non ci sono modifiche
                                            onClick={() => setChangeNote("Modifica di test")}
                                        >
                                            Modifica di test
                                        </button>
                                    </div>

                                    <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '130px', overflowY: 'auto' }}>
                                        <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Ultime Modifiche Registrate</h5>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {changeLogs
                                                .filter(log => log.change_note !== "Modifica di test" && !log.change_note.startsWith("DEACTIVATED"))
                                                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                                .map(log => (
                                                    <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
                                                        <strong style={{ color: '#0056b3' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                                    </div>
                                                ))
                                            }
                                            {changeLogs.filter(log => log.change_note !== "Modifica di test" && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
                                                <span style={{ fontSize: '0.8rem', color: '#999' }}>Nessuna modifica recente registrata.</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={isEditMode && (!isDirty || !changeNote.trim())} // Disabilitato se !isDirty
                        >
                            Save Parameter
                        </button>
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
                                            <div key={q.id} style={{ ...qRowStyle, opacity: q.is_active ? 1 : 0.5 }}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{q.id}</span>
                                                    <span>{q.text} {q.is_active ? '' : '(Inattiva)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/questions/${q.id}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(q.id, q.is_active)}
                                                        className={`btn btn--small ${q.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: q.is_active ? 'red' : 'green', borderColor: q.is_active ? 'red' : 'green' }}
                                                    >
                                                        {q.is_active ? 'Disattiva' : 'Riattiva'}
                                                    </button>
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
                                            <div key={q.id} style={{ ...qRowStyle, opacity: q.is_active ? 1 : 0.5 }}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{q.id}</span>
                                                    <span>{q.text} {q.is_active ? '' : '(Inattiva)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/questions/${q.id}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(q.id, q.is_active)}
                                                        className={`btn btn--small ${q.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: q.is_active ? 'red' : 'green', borderColor: q.is_active ? 'red' : 'green' }}
                                                    >
                                                        {q.is_active ? 'Disattiva' : 'Riattiva'}
                                                    </button>
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