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

    const [initialData, setInitialData] = useState(null);
    const [formData, setFormData] = useState({
        id: '',
        parameter_id: '',
        text: '',
        instruction: '',
        instruction_yes: '',
        instruction_no: '',
        is_stop_question: false,
        is_active: true,
        allowed_motivations: []
    });

    const [parameters, setParameters] = useState([]);
    const [allMotivations, setAllMotivations] = useState([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [showCreator, setShowCreator] = useState(false);
    const [newMotData, setNewMotData] = useState({ code: '', label: '' });

    // Stati per Audit Log (mutuati da ParameterForm)
    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);

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
                    const qData = {
                        id: questionRes.data.id || '',
                        parameter_id: questionRes.data.parameter_id || '',
                        text: questionRes.data.text || '',
                        instruction: questionRes.data.instruction || '',
                        instruction_yes: questionRes.data.instruction_yes || '',
                        instruction_no: questionRes.data.instruction_no || '',
                        is_stop_question: questionRes.data.is_stop_question ?? false,
                        is_active: questionRes.data.is_active ?? true,
                        allowed_motivations: questionRes.data.allowed_motivations || []
                    };

                    setFormData(qData);
                    setInitialData(qData);

                    // Carica anche i log del parametro per visualizzarli nella UI
                    try {
                        const paramRes = await api.get(`/api/admin/parameters/${qData.parameter_id}`);
                        setChangeLogs(paramRes.data.change_logs || []);
                    } catch(err) {
                        console.warn("Impossibile caricare i log del parametro", err);
                    }

                } else if (paramFromUrl) {
                    setFormData((prev) => ({ ...prev, parameter_id: paramFromUrl }));
                    // Anche in creazione carichiamo i log del parametro genitore per il recap
                    try {
                        const paramRes = await api.get(`/api/admin/parameters/${paramFromUrl}`);
                        setChangeLogs(paramRes.data.change_logs || []);
                    } catch(err) {
                        console.warn("Impossibile caricare i log del parametro", err);
                    }
                }
            } catch {
                setError('Impossibile caricare i dati.');
            }
        };
        fetchData();
    }, [id, isEditMode, paramFromUrl]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));

        // In creazione, se cambia il parametro genitore aggiorniamo i log mostrati nel recap
        if (!isEditMode && name === 'parameter_id') {
            if (value) {
                api.get(`/api/admin/parameters/${value}`)
                    .then(res => setChangeLogs(res.data.change_logs || []))
                    .catch(() => setChangeLogs([]));
            } else {
                setChangeLogs([]);
            }
        }
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
        } catch {
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
                instruction_yes: formData.instruction_yes?.trim() || null,
                instruction_no: formData.instruction_no?.trim() || null,
                change_note: changeNote
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

    // Logica per isDirty
    const safeString = (val) => val === null || val === undefined ? '' : String(val);
    const isArraysEqual = (a, b) => {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((val, index) => val === sortedB[index]);
    };

    // In creazione la nota è sempre richiesta (l'intera domanda è "nuova"),
    // in modifica solo se almeno un campo è cambiato.
    const isDirty = !isEditMode || (initialData && (
        safeString(formData.text) !== safeString(initialData.text) ||
        safeString(formData.instruction) !== safeString(initialData.instruction) ||
        safeString(formData.instruction_yes) !== safeString(initialData.instruction_yes) ||
        safeString(formData.instruction_no) !== safeString(initialData.instruction_no) ||
        formData.is_stop_question !== initialData.is_stop_question ||
        formData.is_active !== initialData.is_active ||
        !isArraysEqual(formData.allowed_motivations, initialData.allowed_motivations)
    ));

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
                            <select name="parameter_id" value={formData.parameter_id} onChange={handleChange} required disabled={isEditMode} style={{ width: '100%', padding: '0.6rem', backgroundColor: isEditMode ? '#e2e8f0' : 'white' }}>
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="checkbox" id="is_stop_question" name="is_stop_question" checked={formData.is_stop_question} onChange={handleChange} />
                            <label htmlFor="is_stop_question" style={{ fontWeight: 'bold' }}>Stop Question</label>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="checkbox" id="is_active" name="is_active" checked={formData.is_active} onChange={handleChange} />
                            <label htmlFor="is_active" style={{ fontWeight: 'bold' }}>Domanda Attiva</label>
                        </div>
                    </div>

                    {/* --- SEZIONE MOTIVAZIONE (Visibile sia in creazione che in modifica) --- */}
                    <div style={{
                        background: isDirty ? '#fff3cd' : 'var(--surface-2, #f8fafc)',
                        padding: '1.5rem',
                        borderRadius: '8px',
                        border: isDirty ? '1px solid #ffe69c' : '1px solid var(--border)',
                        marginTop: '1rem'
                    }}>
                        <h4 style={{ marginTop: 0, color: isDirty ? '#664d03' : 'inherit', marginBottom: '0.5rem' }}>
                            {!isEditMode
                                ? '⚠️ Nuova Domanda — Nota Obbligatoria'
                                : (isDirty ? '⚠️ Modifiche Rilevate' : 'Audit Log & Note (Parent Parameter)')}
                        </h4>
                        <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            {!isEditMode
                                ? 'Stai aggiungendo una nuova domanda. Inserisci una descrizione che verrà salvata nello storico del parametro genitore.'
                                : (isDirty
                                    ? 'Hai modificato i dati di questa domanda. Devi inserire una motivazione per poter salvare.'
                                    : 'Nessuna modifica rilevata. Modifica almeno un campo per abilitare il salvataggio e inserire una nota. La nota verrà salvata nello storico del parametro genitore.')}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            <div>
                                <textarea
                                    value={changeNote}
                                    onChange={e => setChangeNote(e.target.value)}
                                    rows="4"
                                    placeholder={!isEditMode
                                        ? "Descrivi la nuova domanda..."
                                        : "Descrivi il motivo della modifica..."}
                                    disabled={!isDirty}
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
                                    disabled={!isDirty}
                                    onClick={() => setChangeNote(isEditMode ? "Modifica di test" : "Nuova domanda di test")}
                                >
                                    {isEditMode ? 'Modifica di test' : 'Nuova di test'}
                                </button>
                            </div>

                            <div style={{ background: '#fff', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '130px', overflowY: 'auto' }}>
                                <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                                    Ultime Modifiche {formData.parameter_id ? `(Parametro: ${formData.parameter_id})` : ''}
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {changeLogs
                                        .filter(log => log.change_note !== "Modifica di test"
                                            && !log.change_note.startsWith("Nuova domanda di test")
                                            && !log.change_note.startsWith("DEACTIVATED"))
                                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                        .map(log => (
                                            <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
                                                <strong style={{ color: '#0056b3' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                            </div>
                                        ))
                                    }
                                    {changeLogs.filter(log => log.change_note !== "Modifica di test"
                                        && !log.change_note.startsWith("Nuova domanda di test")
                                        && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
                                        <span style={{ fontSize: '0.8rem', color: '#999' }}>Nessuna modifica recente registrata.</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={isLoading || !isDirty || !changeNote.trim()}
                        >
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