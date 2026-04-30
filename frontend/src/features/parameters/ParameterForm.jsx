import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link, useOutlet } from 'react-router-dom';
import api from '../../api';
import useFormDraft from '../../utils/useFormDraft';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import DraftIndicator from '../../components/DraftIndicator';
import Drawer from '../../components/Drawer';

async function downloadBlob(request, fallbackName) {
    const res = await request;
    const cd = res.headers['content-disposition'] || '';
    const m = cd.match(/filename="?([^";]+)"?/);
    const filename = m ? m[1] : fallbackName;
    const blob = new Blob([res.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

const DRAFT_FIELDS = [
    'name', 'short_description', 'long_description',
    'implicational_condition', 'description_of_the_implicational_condition',
    'schema', 'param_type', 'level_of_comparison',
];

export default function ParameterForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);
    // Se attiva, una nested route (questions/add o questions/:qid/edit)
    // viene mostrata sopra come drawer. `outlet` è l'elemento React della
    // child route oppure null.
    const outlet = useOutlet();
    const isDrawerOpen = !!outlet;

    const [initialData, setInitialData] = useState(null);
    const [formData, setFormData] = useState({
        id: '', name: '', position: 0, short_description: '',
        long_description: '',
        implicational_condition: '',
        description_of_the_implicational_condition: '',
        is_active: true,
        schema: '', param_type: '', level_of_comparison: ''
    });

    const [questions, setQuestions] = useState([]);
    const [usage, setUsage] = useState([]);
    const [error, setError] = useState('');
    const [syntaxError, setSyntaxError] = useState('');
    // Disattiva il guard "modifiche non salvate" durante un submit in corso
    // (altrimenti il navigate post-save verrebbe bloccato da se stesso).
    const [isSaving, setIsSaving] = useState(false);

    const [lookups, setLookups] = useState({ schemas: [], types: [], levels: [] });
    const [newLookupInputs, setNewLookupInputs] = useState({ schema: '', type: '', level: '' });

    // Stati per logica Modifiche
    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);
    const [draftReady, setDraftReady] = useState(false);

    // Persistenza locale della bozza: chiave per-id (o "new" in creazione)
    const { clearDraft, lastSavedAt } = useFormDraft({
        storageKey: `draft_parameter_${id || 'new'}`,
        formData,
        setFormData,
        fields: DRAFT_FIELDS,
        enabled: draftReady,
    });

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
                setError('Error loading the data.');
            } finally {
                // Solo dopo aver fetchato i dati lasciamo che il draft eventuale
                // venga ripristinato sopra: evita che una bozza vecchia
                // sovrascriva i dati appena letti dal server.
                setDraftReady(true);
            }
        };
        fetchInitialData();
    }, [id, isEditMode]);

    // Quando il drawer si chiude (es. dopo save di una question dentro la
    // nested route), ricarichiamo soltanto la lista delle question del
    // parametro così i nomi/stati appena modificati si riflettono nella UI.
    // Volutamente non ri-fetchamo l'intero parametro: sovrascriverebbe le
    // modifiche eventualmente in corso sui suoi campi.
    const wasDrawerOpenRef = useRef(false);
    useEffect(() => {
        const wasOpen = wasDrawerOpenRef.current;
        wasDrawerOpenRef.current = isDrawerOpen;
        if (!wasOpen || isDrawerOpen || !isEditMode || !id) return;
        let cancelled = false;
        (async () => {
            try {
                const paramRes = await api.get(`/api/admin/parameters/${id}`);
                if (cancelled) return;
                setQuestions(paramRes.data.questions || []);
                // Aggiorniamo anche i log: il salvataggio di una question
                // aggiunge un'entry alla history del parametro genitore.
                setChangeLogs(paramRes.data.change_logs || []);
            } catch { /* ignore: la prossima azione lo riproverà */ }
        })();
        return () => { cancelled = true; };
    }, [isDrawerOpen, isEditMode, id]);

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
        } catch (err) { alert("Error adding lookup"); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (syntaxError) {
            alert("Fix the syntax errors in the formula before saving!");
            return;
        }
        setIsSaving(true);
        try {
            const payload = { ...formData, position: parseInt(formData.position, 10), change_note: changeNote };
            isEditMode ? await api.put(`/api/admin/parameters/${id}`, payload) : await api.post('/api/admin/parameters', payload);
            clearDraft();
            navigate('/admin/parameters');
        } catch (err) {
            setError(err.response?.data?.detail || 'Error while saving.');
            setIsSaving(false);
        }
    };

    const handleDeleteLookup = async (kind, lookupId, label) => {
        const labels = { schemas: 'schema', types: 'type', levels: 'level' };
        if (!window.confirm(`Delete ${labels[kind]} "${label}"? This cannot be undone.`)) return;
        try {
            await api.delete(`/api/admin/parameters/lookups/${kind}/${lookupId}`);
            setLookups(prev => ({ ...prev, [kind]: prev[kind].filter(x => x.id !== lookupId) }));
            // Se il valore corrente del form puntava a questa label, lo svuoto
            const fieldByKind = { schemas: 'schema', types: 'param_type', levels: 'level_of_comparison' };
            const field = fieldByKind[kind];
            if (field && formData[field] === label) {
                setFormData(prev => ({ ...prev, [field]: '' }));
            }
        } catch (err) {
            alert(err.response?.data?.detail || `Could not delete ${labels[kind]}.`);
        }
    };

    const handleDownloadParameterPdf = async () => {
        try {
            await downloadBlob(
                api.get(`/api/admin/parameters/${id}/pdf`, { responseType: 'blob' }),
                `Parameter_${id}.pdf`
            );
        } catch {
            alert('Error while downloading the PDF.');
        }
    };

    const handleDownloadChangelogPdf = async () => {
        try {
            await downloadBlob(
                api.get(`/api/admin/parameters/${id}/changelog-pdf`, { responseType: 'blob' }),
                `Parameter_${id}_changelog.pdf`
            );
        } catch {
            alert('Error while downloading the change history PDF.');
        }
    };

    // --- DISATTIVAZIONE / RIATTIVAZIONE DEL PARAMETRO ---
    const handleToggleActiveClick = async (e) => {
        e.preventDefault();
        if (!isEditMode) return;

        if (formData.is_active) {
            if (usage.length > 0) {
                alert("You cannot deactivate this parameter because it is mentioned in the implicational conditions of other parameters (see sidebar).");
                return;
            }
            setShowDeactivateModal(true);
        } else {
            if(window.confirm("Do you want to reactivate this parameter?")) {
                try {
                    await api.post(`/api/admin/parameters/${id}/reactivate`);
                    setFormData(prev => ({ ...prev, is_active: true }));
                } catch (err) {
                    alert(err.response?.data?.detail || 'Error during reactivation');
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
            alert("Parameter successfully deactivated.");
        } catch (err) {
            alert(err.response?.data?.detail || "Error during deactivation. Is the password correct?");
        }
    };

    // --- DISATTIVAZIONE / RIATTIVAZIONE DELLA DOMANDA ---
    const handleToggleQuestionActive = async (questionId, currentStatus) => {
        const actionText = currentStatus ? 'deactivate' : 'reactivate';
        if (!window.confirm(`Are you sure you want to ${actionText} question ${questionId}? (It will disappear from the form)`)) return;

        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            // Ricarica i dati per avere la lista aggiornata
            const paramRes = await api.get(`/api/admin/parameters/${id}`);
            setQuestions(paramRes.data.questions || []);
        } catch (err) {
            alert(err.response?.data?.detail || `Error while changing the question status.`);
        }
    };

    // Verifica se ci sono state modifiche per abilitare la textarea delle motivazioni
    const safeString = (val) => val === null || val === undefined ? '' : String(val);
    const isDirty = isEditMode && initialData && (
        safeString(formData.name) !== safeString(initialData.name) ||
        safeString(formData.position) !== safeString(initialData.position) ||
        safeString(formData.short_description) !== safeString(initialData.short_description) ||
        safeString(formData.long_description) !== safeString(initialData.long_description) ||
        safeString(formData.implicational_condition) !== safeString(initialData.implicational_condition) ||
        safeString(formData.description_of_the_implicational_condition) !== safeString(initialData.description_of_the_implicational_condition) ||
        safeString(formData.schema) !== safeString(initialData.schema) ||
        safeString(formData.param_type) !== safeString(initialData.param_type) ||
        safeString(formData.level_of_comparison) !== safeString(initialData.level_of_comparison)
    );

    // In creazione "dirty" significa che l'utente ha digitato qualcosa nei
    // campi tracciati. Diversamente da `isDirty` non c'è uno snapshot iniziale
    // con cui confrontarsi: ci basiamo sulla presenza di valori non vuoti.
    const isCreatingDirty = !isEditMode && DRAFT_FIELDS.some(f => {
        const v = formData[f];
        if (v === null || v === undefined || v === '') return false;
        if (typeof v === 'string') return v.trim().length > 0;
        return true;
    });

    // Doppia rete: beforeunload (chiusura tab/refresh) + useBlocker (Link,
    // breadcrumb, back-button). Disattivata durante il submit per non
    // bloccare il navigate volontario di post-save.
    useUnsavedChangesGuard((isDirty || isCreatingDirty) && !isSaving);

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
        <>
        <div className="container" style={{maxWidth: '1200px', marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem'}}>

            {/* MODAL DISATTIVAZIONE */}
            {showDeactivateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '400px', padding: '2rem' }}>
                        <h3 style={{ color: 'var(--bad)', marginTop: 0 }}>Deactivate Parameter</h3>
                        <p className="small muted">Enter your admin password to confirm the operation.</p>
                        <form onSubmit={submitDeactivation}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ fontWeight: 'bold' }}>Admin Password</label>
                                <input type="password" required value={deactivateForm.password} onChange={e => setDeactivateForm({...deactivateForm, password: e.target.value})} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ fontWeight: 'bold' }}>Reason (optional)</label>
                                <textarea rows="2" value={deactivateForm.reason} onChange={e => setDeactivateForm({...deactivateForm, reason: e.target.value})} style={{ width: '100%', padding: '0.5rem' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" className="btn" onClick={() => setShowDeactivateModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--danger" style={{ background: 'red', color: 'white' }}>Confirm Deactivation</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="card">
                    <header style={{marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap'}}>
                        <h2 style={{margin: 0}}>{isEditMode ? `Edit Parameter: ${id}` : 'Add New Parameter'}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <DraftIndicator lastSavedAt={lastSavedAt} />
                            {isEditMode && (
                                <button
                                    type="button"
                                    onClick={handleDownloadParameterPdf}
                                    className="btn"
                                    title="Download a PDF detail report of this parameter"
                                >
                                    Download PDF
                                </button>
                            )}
                        </div>
                    </header>

                    {error && <div className="alert alert-error" style={{marginBottom: '1rem'}}>{error}</div>}

                    <form onSubmit={handleSubmit}>
                        {/* --- INIZIO CAMPI FORM --- */}
                        <div className="grid grid-2" style={{gap: '1rem', marginBottom: '1rem'}}>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Parameter ID</label>
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
                            <LookupField
                                label="Schema"
                                name="schema"
                                value={formData.schema}
                                items={lookups.schemas}
                                kind="schemas"
                                onChange={handleChange}
                                newInputValue={newLookupInputs.schema}
                                onNewInputChange={(v) => setNewLookupInputs({ ...newLookupInputs, schema: v })}
                                onAdd={() => handleAddLookup('schemas', 'schemas', 'schema')}
                                onDelete={handleDeleteLookup}
                            />
                            <LookupField
                                label="Type"
                                name="param_type"
                                value={formData.param_type}
                                items={lookups.types}
                                kind="types"
                                onChange={handleChange}
                                newInputValue={newLookupInputs.type}
                                onNewInputChange={(v) => setNewLookupInputs({ ...newLookupInputs, type: v })}
                                onAdd={() => handleAddLookup('types', 'types', 'type')}
                                onDelete={handleDeleteLookup}
                            />
                            <LookupField
                                label="Level"
                                name="level_of_comparison"
                                value={formData.level_of_comparison}
                                items={lookups.levels}
                                kind="levels"
                                onChange={handleChange}
                                newInputValue={newLookupInputs.level}
                                onNewInputChange={(v) => setNewLookupInputs({ ...newLookupInputs, level: v })}
                                onAdd={() => handleAddLookup('levels', 'levels', 'level')}
                                onDelete={handleDeleteLookup}
                            />
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Short Description</label>
                            <textarea name="short_description" value={formData.short_description} onChange={handleChange} rows="2" style={{width: '100%', padding: '0.5rem'}} />
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Long Description</label>
                            <textarea name="long_description" value={formData.long_description || ''} onChange={handleChange} rows="4" style={{width: '100%', padding: '0.5rem'}} placeholder="Extended description of the parameter (optional)" />
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Implicational Condition</label>
                            <input
                                type="text"
                                name="implicational_condition"
                                value={formData.implicational_condition || ''}
                                onChange={handleChange}
                                placeholder="e.g. (+FGM | -ABC)"
                                style={{width: '100%', padding: '0.5rem', borderColor: syntaxError ? 'red' : 'inherit'}}
                            />
                            {syntaxError && <p style={{color: 'red', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 'bold'}}>{syntaxError}</p>}
                        </div>

                        <div style={{marginBottom: '1rem'}}>
                            <label style={{fontWeight: 'bold'}}>Explanation of the Implicational Condition</label>
                            <textarea name="description_of_the_implicational_condition" value={formData.description_of_the_implicational_condition || ''} onChange={handleChange} rows="3" style={{width: '100%', padding: '0.5rem'}} placeholder="Textual explanation (optional)" />
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
                                Active Parameter
                            </label>
                            {isEditMode && (
                                <button
                                    type="button"
                                    onClick={handleToggleActiveClick}
                                    className={`btn btn--small ${usage.length > 0 && formData.is_active ? 'btn--disabled' : ''}`}
                                    style={{ marginLeft: 'auto' }}
                                    title={usage.length > 0 ? "Locked: used in other conditions" : ""}
                                >
                                    {formData.is_active ? 'Deactivate Parameter...' : 'Reactivate Parameter'}
                                </button>
                            )}
                            {usage.length > 0 && formData.is_active && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Locked by dependencies</span>
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
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
                                    <h4 style={{ margin: 0, color: isDirty ? '#664d03' : 'inherit' }}>
                                        {isDirty ? 'Changes Detected' : 'Brief summary of changes'}
                                    </h4>
                                    <button
                                        type="button"
                                        className="btn btn--small"
                                        onClick={handleDownloadChangelogPdf}
                                        title="Download the change history of this parameter as PDF"
                                    >
                                        Download PDF
                                    </button>
                                </div>
                                <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                    {isDirty
                                        ? 'You have modified this parameter. You must enter a reason in order to save.'
                                        : 'No changes detected. Edit at least one field to enable saving and to add a note.'}
                                </p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                    <div>
                                        <textarea
                                            value={changeNote}
                                            onChange={e => setChangeNote(e.target.value)}
                                            rows="4"
                                            placeholder="Describe the reason for the change..."
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
                                            onClick={() => setChangeNote("Test edit")}
                                        >
                                            Test edit
                                        </button>
                                    </div>

                                    <div style={{ background: 'var(--surface)', color: 'var(--text)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '130px', overflowY: 'auto' }}>
                                        <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Latest Recorded Changes</h5>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {changeLogs
                                                .filter(log => log.change_note !== "Test edit" && !log.change_note.startsWith("DEACTIVATED"))
                                                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                                .map(log => (
                                                    <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                                                        <strong style={{ color: 'var(--link)' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                                    </div>
                                                ))
                                            }
                                            {changeLogs.filter(log => log.change_note !== "Test edit" && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No recent changes recorded.</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <button
                                type="submit"
                                className="btn btn--primary"
                                disabled={isEditMode && (!isDirty || !changeNote.trim())} // Disabilitato se !isDirty
                            >
                                Save Parameter
                            </button>
                            <Link to="/admin/parameters" className="btn">Cancel</Link>
                        </div>
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
                                                    <span>{q.text} {q.is_active ? '' : '(Inactive)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/parameters/${id}/edit/questions/${encodeURIComponent(q.id)}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(q.id, q.is_active)}
                                                        className={`btn btn--small ${q.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: q.is_active ? 'red' : 'green', borderColor: q.is_active ? 'red' : 'green' }}
                                                    >
                                                        {q.is_active ? 'Deactivate' : 'Reactivate'}
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
                                                    <span>{q.text} {q.is_active ? '' : '(Inactive)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/parameters/${id}/edit/questions/${encodeURIComponent(q.id)}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(q.id, q.is_active)}
                                                        className={`btn btn--small ${q.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: q.is_active ? 'red' : 'green', borderColor: q.is_active ? 'red' : 'green' }}
                                                    >
                                                        {q.is_active ? 'Deactivate' : 'Reactivate'}
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
                            <Link to={`/admin/parameters/${id}/edit/questions/add`} className="btn btn--primary">
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

        {/* DRAWER per la edit/aggiunta di una question dentro questo parametro.
            Si apre quando una nested route (questions/add o questions/:qid/edit)
            è attiva. Chiusura → torna alla rotta parent; il guard delle
            modifiche non salvate vive nel QuestionForm e intercetta da solo
            la transizione. */}
        <Drawer
            open={isDrawerOpen}
            onClose={() => navigate(`/admin/parameters/${id}/edit`)}
            ariaLabel="Modifica domanda"
        >
            {outlet}
        </Drawer>
        </>
    );
}

// Select per uno dei lookup (schema/type/level) con bottone di aggiunta
// inline e una piccola riga "manage" sotto: lista delle voci esistenti con
// icona cestino discreta. Il delete chiede conferma e viene rifiutato lato
// server se la voce è in uso da qualche parametro.
function LookupField({
    label, name, value, items, kind,
    onChange, newInputValue, onNewInputChange, onAdd, onDelete,
}) {
    const [manageOpen, setManageOpen] = useState(false);
    return (
        <div>
            <label style={{ fontWeight: 'bold' }}>{label}</label>
            <select name={name} value={value} onChange={onChange} style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}>
                <option value="">-- Select --</option>
                {items.map(it => <option key={it.id} value={it.label}>{it.label}</option>)}
            </select>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
                <input
                    type="text"
                    placeholder="New..."
                    value={newInputValue}
                    onChange={(e) => onNewInputChange(e.target.value)}
                    style={{ flex: 1, padding: '0.25rem' }}
                />
                <button type="button" onClick={onAdd} className="btn btn--small">+</button>
                <button
                    type="button"
                    onClick={() => setManageOpen(o => !o)}
                    className="btn btn--small"
                    title={manageOpen ? "Hide manage panel" : "Manage existing entries"}
                    style={{ padding: '0.25rem 0.45rem' }}
                >
                    ⚙
                </button>
            </div>
            {manageOpen && (
                <div style={{
                    marginTop: '0.4rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    maxHeight: '160px',
                    overflowY: 'auto',
                }}>
                    {items.length === 0 ? (
                        <div style={{ padding: '0.4rem 0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            No entries.
                        </div>
                    ) : items.map(it => (
                        <div key={it.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.3rem 0.5rem',
                            fontSize: '0.8rem',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            <span>{it.label}</span>
                            <button
                                type="button"
                                onClick={() => onDelete(kind, it.id, it.label)}
                                title={`Delete "${it.label}"`}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--text-muted)',
                                    fontSize: '0.85rem',
                                    padding: '0 0.25rem',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                            >
                                🗑
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}