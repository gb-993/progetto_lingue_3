import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, Link, useOutlet } from 'react-router-dom';
import api from '../../api';
import useFormDraft from '../../utils/useFormDraft';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import DraftIndicator from '../../components/DraftIndicator';
import Drawer from '../../components/Drawer';
import DeactivateQuestionDialog from '../questions/DeactivateQuestionDialog';
import DeleteQuestionDialog from '../questions/DeleteQuestionDialog';
import usePresence from '../../utils/usePresence';

async function downloadBlob(request, fallbackName) {
    const res = await request;
    const contentDisposition = res.headers['content-disposition'] || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
    const filename = filenameMatch ? filenameMatch[1] : fallbackName;
    const blob = new Blob([res.data]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
}

const PARAMETER_DRAFT_FIELDS = [
    'name', 'short_description', 'long_description', 'admin_remarks',
    'implicational_condition', 'description_of_the_implicational_condition',
    'schema', 'param_type', 'level_of_comparison',
];

export default function ParameterForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);
    const outlet = useOutlet();
    const isDrawerOpen = !!outlet;

    const [initialData, setInitialData] = useState(null);
    const [formData, setFormData] = useState({
        id: '', name: '', position: 0, short_description: '',
        long_description: '',
        admin_remarks: '',
        implicational_condition: '',
        description_of_the_implicational_condition: '',
        is_active: true,
        schema: '', param_type: '', level_of_comparison: ''
    });

    const [questions, setQuestions] = useState([]);
    const [usage, setUsage] = useState([]);
    const [error, setError] = useState('');
    const [syntaxError, setSyntaxError] = useState('');
    const [idWarning, setIdWarning] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const [lookups, setLookups] = useState({ schemas: [], types: [], levels: [] });
    const [newLookupInputs, setNewLookupInputs] = useState({ schema: '', type: '', level: '' });

    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);
    const [draftReady, setDraftReady] = useState(false);
    const [isTestEdit, setIsTestEdit] = useState(false);

    const { clearDraft, lastSavedAt } = useFormDraft({
        storageKey: `draft_parameter_${id || 'new'}`,
        formData,
        setFormData,
        fields: PARAMETER_DRAFT_FIELDS,
        enabled: draftReady,
    });

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
            } catch {
                setError('Error loading the data.');
            } finally {
                setDraftReady(true);
            }
        };
        fetchInitialData();
    }, [id, isEditMode]);

    // ricarica solo question e log
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
                setChangeLogs(paramRes.data.change_logs || []);
            } catch { /* ignore: la prossima azione lo riproverà */ }
        })();
        return () => { cancelled = true; };
    }, [isDrawerOpen, isEditMode, id]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (formData.implicational_condition !== undefined && formData.implicational_condition.trim() !== '') {
                try {
                    // stesso controllo del salvataggio: sintassi, parametri citati, giri chiusi
                    const res = await api.post('/api/admin/parameters/validate-condition', {
                        condition: formData.implicational_condition,
                        param_id: isEditMode ? id : formData.id,
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
    }, [formData.implicational_condition, formData.id, isEditMode, id]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    // l'id finisce nelle formule: solo lettere, cifre e _
    const handleIdChange = (e) => {
        const raw = e.target.value;
        const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
        if (cleaned !== raw) {
            const rejected = [...new Set(
                raw.split('').filter(char => !/[A-Za-z0-9_]/.test(char))
            )].map(char => (char === ' ' ? 'space' : `« ${char} »`)).join(', ');
            setIdWarning(`Character not allowed: ${rejected}. Use only letters, digits and underscore ( _ ).`);
        } else {
            setIdWarning('');
        }
        setFormData(prev => ({ ...prev, id: cleaned }));
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
        } catch { alert("Error adding lookup"); }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (syntaxError) {
            alert("Fix the errors in the implicational condition before saving!");
            return;
        }
        setIsSaving(true);
        try {
            const finalNote = isTestEdit ? `Test edit. ${changeNote}` : changeNote;
            const payload = { ...formData, position: parseInt(formData.position, 10), change_note: finalNote };
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
            setLookups(prev => ({ ...prev, [kind]: prev[kind].filter(lookup => lookup.id !== lookupId) }));
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

    const [quickFilling, setQuickFilling] = useState(false);
    const handleQuickFill = async () => {
        if (!isEditMode || !id) return;
        const activeQuestions = questions.filter(question => question.is_active);
        const activeStopCount = activeQuestions.filter(question => question.is_stop_question).length;
        const activeNormalCount = activeQuestions.length - activeStopCount;
        if (activeQuestions.length === 0) {
            alert('No active questions in this parameter. Nothing to fill.');
            return;
        }
        const confirmed = window.confirm(
            `Quick-fill blank answers for parameter "${id}"?\n\n` +
            `This will create answers ONLY where they are still missing:\n` +
            `  • YES on ${activeStopCount} stop question(s)\n` +
            `  • NO on ${activeNormalCount} normal question(s)\n` +
            `for every language that does not already have an answer.\n\n` +
            `Existing answers are NEVER overwritten.\n\n` +
            `After the fill, parameter values will be recomputed in background ` +
            `for every language.`
        );
        if (!confirmed) return;
        setQuickFilling(true);
        try {
            const res = await api.post(`/api/admin/parameters/${id}/quick-fill-answers`);
            const result = res.data || {};
            alert(
                `Quick-fill complete.\n\n` +
                `Created: ${result.created} answer(s)\n` +
                `Skipped (already answered): ${result.skipped_existing}\n` +
                `Languages touched: ${result.languages_touched}\n\n` +
                `Recompute started in background.`
            );
        } catch (err) {
            alert(err.response?.data?.detail || 'Could not quick-fill answers.');
        } finally {
            setQuickFilling(false);
        }
    };

    const [deactivateCandidate, setDeactivateCandidate] = useState(null);
    const [deleteCandidate, setDeleteCandidate] = useState(null);

    const othersEditing = usePresence('parameter', id, isEditMode && !!id);

    const doToggleQuestionActive = async (questionId) => {
        try {
            await api.patch(`/api/admin/questions/${questionId}/toggle-active`);
            const paramRes = await api.get(`/api/admin/parameters/${id}`);
            setQuestions(paramRes.data.questions || []);
        } catch (err) {
            alert(err.response?.data?.detail || `Error while changing the question status.`);
        }
    };

    const handleToggleQuestionActive = async (questionId, currentStatus) => {
        if (!currentStatus) {
            if (!window.confirm(`Reactivate question ${questionId}? It will reappear in the form.`)) return;
            await doToggleQuestionActive(questionId);
            return;
        }
        setDeactivateCandidate(questionId);
    };

    const safeString = (val) => val === null || val === undefined ? '' : String(val);
    const isDirty = isEditMode && initialData && (
        safeString(formData.id) !== safeString(initialData.id) ||
        safeString(formData.name) !== safeString(initialData.name) ||
        safeString(formData.position) !== safeString(initialData.position) ||
        safeString(formData.short_description) !== safeString(initialData.short_description) ||
        safeString(formData.long_description) !== safeString(initialData.long_description) ||
        safeString(formData.admin_remarks) !== safeString(initialData.admin_remarks) ||
        safeString(formData.implicational_condition) !== safeString(initialData.implicational_condition) ||
        safeString(formData.description_of_the_implicational_condition) !== safeString(initialData.description_of_the_implicational_condition) ||
        safeString(formData.schema) !== safeString(initialData.schema) ||
        safeString(formData.param_type) !== safeString(initialData.param_type) ||
        safeString(formData.level_of_comparison) !== safeString(initialData.level_of_comparison)
    );

    const isCreatingDirty = !isEditMode && PARAMETER_DRAFT_FIELDS.some(field => {
        const value = formData[field];
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'string') return value.trim().length > 0;
        return true;
    });

    // spento durante il submit
    useUnsavedChangesGuard((isDirty || isCreatingDirty) && !isSaving);

    const normalQuestions = questions.filter(question => !question.is_stop_question);
    const stopQuestions = questions.filter(question => question.is_stop_question);

    const questionRowStyle = {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '0.75rem', padding: 'var(--form-row-pad, 0.75rem 0.9rem)', marginBottom: '0.5rem',
        background: 'var(--surface, #fff)', border: '1px solid var(--border, #dadde2)',
        borderRadius: 'var(--form-row-radius, 0.6rem)'
    };

    return (
        <>
        <div className="container form-layout" style={{maxWidth: '1200px', marginTop: 'var(--form-page-top, 2rem)'}}>

            {showDeactivateModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '400px', maxWidth: '92vw', padding: 'var(--modal-pad, 2rem)' }}>
                        <h3 style={{ color: 'var(--bad)', marginTop: 0 }}>Deactivate Parameter</h3>
                        <p className="small muted">Enter your admin password to confirm the operation.</p>
                        <form onSubmit={submitDeactivation}>
                            <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                                <label style={{ fontWeight: 'bold' }}>Admin Password</label>
                                <input type="password" required value={deactivateForm.password} onChange={e => setDeactivateForm({...deactivateForm, password: e.target.value})} style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)' }} />
                            </div>
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ fontWeight: 'bold' }}>Reason (optional)</label>
                                <textarea rows="2" value={deactivateForm.reason} onChange={e => setDeactivateForm({...deactivateForm, reason: e.target.value})} style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                                <button type="button" className="btn" onClick={() => setShowDeactivateModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn--danger" style={{ background: 'red', color: 'white' }}>Confirm Deactivation</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-col-gap, 1.5rem)', minWidth: 0 }}>
                <div className="card">
                    <header style={{
                        marginBottom: 'var(--form-card-header-mb, 1.5rem)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '1rem', flexWrap: 'wrap',
                        ...(othersEditing > 0 ? {
                            position: 'sticky',
                            top: 'var(--topbar-height)',
                            zIndex: 5,
                            marginBottom: 0,
                            paddingTop: '0.5rem',
                            paddingBottom: '0.75rem',
                            borderBottom: '1px solid var(--border)',
                            background: 'var(--surface, #fff)',
                            boxShadow: '0 4px 8px -6px rgba(0,0,0,0.35)',
                        } : {}),
                    }}>
                        <h2 style={{margin: 0}}>{isEditMode ? `Edit Parameter: ${id}` : 'Add New Parameter'}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {othersEditing > 0 && (
                                <span
                                    title="Another user is editing this parameter right now. The last save wins, so coordinate to avoid overwriting each other."
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                        fontSize: '0.76rem', color: '#664d03',
                                        background: '#fff3cd', border: '1px solid #ffe69c',
                                        borderRadius: '999px', padding: '0.2rem 0.6rem', whiteSpace: 'nowrap',
                                    }}
                                >
                                    <span className="presence-dot" aria-hidden="true" />
                                    {othersEditing > 1 ? `${othersEditing} others editing` : 'Another user editing'}
                                </span>
                            )}
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

                    {error && <div className="alert alert-error" style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>{error}</div>}

                    <form onSubmit={handleSubmit}>
                        <div className="grid grid-2" style={{gap: 'var(--form-grid-gap, 1rem)', marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Parameter ID</label>
                                <input type="text" name="id" value={formData.id} onChange={handleIdChange} required maxLength={10} style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)', borderColor: idWarning ? 'red' : 'inherit'}} />
                                {idWarning && <p style={{color: 'red', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 'bold'}}>{idWarning}</p>}
                            </div>
                            <div>
                                <label style={{fontWeight: 'bold'}}>Position</label>
                                <input type="number" name="position" value={formData.position} onChange={handleChange} required style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} />
                            </div>
                        </div>

                        {isEditMode && initialData && formData.id !== initialData.id && (
                            <div className="small" style={{ marginTop: '-0.4rem', marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.75rem', lineHeight: 1.4, color: '#664d03', background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                                The new ID must be unique, ≤ 10 characters and contain only letters, digits or underscore.
                            </div>
                        )}

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Name</label>
                            <input type="text" name="name" value={formData.name} onChange={handleChange} required style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} />
                        </div>

                        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--form-grid-gap, 1rem)', marginBottom: 'var(--form-col-gap, 1.5rem)', background: 'var(--surface-2)', padding: 'var(--form-box-pad, 1rem)', borderRadius: '8px'}}>
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

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Short Description</label>
                            <textarea name="short_description" value={formData.short_description} onChange={handleChange} rows="2" style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} />
                        </div>

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Long Description</label>
                            <textarea name="long_description" value={formData.long_description || ''} onChange={handleChange} rows="4" style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} placeholder="Extended description of the parameter (optional)" />
                        </div>

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Admin remarks</label>
                            <textarea name="admin_remarks" value={formData.admin_remarks || ''} onChange={handleChange} rows="3" style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} placeholder="Internal admin notes about this parameter (not shown to users, not exported)" />
                            <p className="small muted" style={{ marginTop: '0.3rem', fontSize: '0.78rem' }}>
                                Internal field for admins only — like the other fields, editing it requires a change note to save. Not included in the exported Excel files.
                            </p>
                        </div>

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Implicational Condition(s)</label>
                            <input
                                type="text"
                                name="implicational_condition"
                                value={formData.implicational_condition || ''}
                                onChange={handleChange}
                                placeholder="e.g. (+FGM | -ABC)"
                                style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)', borderColor: syntaxError ? 'red' : 'inherit'}}
                            />
                            {syntaxError && <p style={{color: 'red', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 'bold'}}>{syntaxError}</p>}
                        </div>

                        <div style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                            <label style={{fontWeight: 'bold'}}>Explanation of the Implicational Condition(s)</label>
                            <textarea name="description_of_the_implicational_condition" value={formData.description_of_the_implicational_condition || ''} onChange={handleChange} rows="3" style={{width: '100%', padding: 'var(--form-input-pad, 0.5rem)'}} placeholder="Textual explanation (optional)" />
                        </div>

                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 'var(--form-field-mb, 1rem)', background: 'var(--surface-2)', padding: 'var(--form-box-pad, 1rem)', borderRadius: '8px'}}>
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

                        <hr style={{ margin: 'var(--form-hr-margin, 2rem) 0', borderColor: 'var(--border)' }} />

                        {isEditMode && (
                            <div style={{
                                background: isDirty ? '#fff3cd' : 'var(--surface-2, #f8fafc)',
                                padding: 'var(--form-box-pad-lg, 1.5rem)',
                                borderRadius: '8px',
                                border: isDirty ? '1px solid #ffe69c' : '1px solid var(--border)',
                                marginBottom: 'var(--form-col-gap, 1.5rem)'
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
                                <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.9rem' }}>
                                    {isDirty
                                        ? 'You have modified this parameter. You must enter a reason in order to save.'
                                        : 'No changes detected. Edit at least one field to enable saving and to add a note.'}
                                </p>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--form-grid-gap, 1.5rem)' }}>
                                    <div>
                                        <textarea
                                            value={changeNote}
                                            onChange={e => setChangeNote(e.target.value)}
                                            rows="4"
                                            placeholder="Describe the reason for the change..."
                                            disabled={!isDirty}
                                            style={{
                                                width: '100%',
                                                padding: '0.5rem',
                                                borderColor: (isDirty && !changeNote.trim()) ? 'red' : 'var(--border)',
                                                borderRadius: '4px',
                                                // testo scuro anche in dark mode
                                                backgroundColor: !isDirty ? 'var(--surface-2, #e2e8f0)' : '#fff',
                                                color: !isDirty ? 'var(--text)' : '#15181c',
                                                cursor: !isDirty ? 'not-allowed' : 'text',
                                                opacity: !isDirty ? 0.7 : 1
                                            }}
                                        />
                                        <label
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                                marginTop: '0.5rem', fontSize: '0.82rem',
                                                opacity: !isDirty ? 0.5 : 1,
                                                cursor: !isDirty ? 'not-allowed' : 'pointer',
                                                // testo scuro anche in dark mode
                                                color: !isDirty ? 'var(--text)' : (isTestEdit ? '#664d03' : '#15181c'),
                                            }}
                                            title="If checked, this entry will be excluded from change history (dashboard, panel, PDF)"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isTestEdit}
                                                disabled={!isDirty}
                                                onChange={e => setIsTestEdit(e.target.checked)}
                                            />
                                            <span>Mark as test edit</span>
                                        </label>
                                        {isTestEdit && isDirty && (
                                            <div style={{
                                                marginTop: '0.4rem', fontSize: '0.72rem',
                                                color: '#664d03', fontStyle: 'italic',
                                            }}>
                                                This entry will be hidden from change history.
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ background: 'var(--surface)', color: 'var(--text)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '130px', overflowY: 'auto' }}>
                                        <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Latest Recorded Changes</h5>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {changeLogs
                                                .filter(log => !log.change_note.startsWith("Test edit") && !log.change_note.startsWith("DEACTIVATED"))
                                                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                                .map(log => (
                                                    <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                                                        <strong style={{ color: 'var(--link)' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                                    </div>
                                                ))
                                            }
                                            {changeLogs.filter(log => !log.change_note.startsWith("Test edit") && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
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
                                disabled={isEditMode && (!isDirty || !changeNote.trim())}
                            >
                                Save Parameter
                            </button>
                            <Link to="/admin/parameters" className="btn">Cancel</Link>
                        </div>
                    </form>
                </div>

                {isEditMode && (
                    <div className="card">
                        <h3>Questions</h3>
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--form-grid-gap, 1.5rem)', marginTop: 'var(--form-field-mb, 1rem)' }}>
                            <div style={{ minWidth: 0 }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Questions</label>
                                {normalQuestions.length > 0 ? (
                                    <div>
                                        {normalQuestions.map(question => (
                                            <div key={question.id} style={{ ...questionRowStyle, opacity: question.is_active ? 1 : 0.5 }}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{question.id}</span>
                                                    <span>{question.text} {question.is_active ? '' : '(Inactive)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/parameters/${id}/edit/questions/${encodeURIComponent(question.id)}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(question.id, question.is_active)}
                                                        className={`btn btn--small ${question.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: question.is_active ? 'red' : 'green', borderColor: question.is_active ? 'red' : 'green' }}
                                                    >
                                                        {question.is_active ? 'Deactivate' : 'Reactivate'}
                                                    </button>
                                                    {!question.is_active && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeleteCandidate(question.id)}
                                                            className="btn btn--small btn--danger"
                                                            style={{ color: 'red', borderColor: 'red' }}
                                                            title="Delete permanently (linked data is archived first)"
                                                            aria-label={`Delete question ${question.id} permanently`}
                                                        >
                                                            🗑
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ ...questionRowStyle, justifyContent: 'center' }}><span className="muted">No questions</span></div>
                                )}
                            </div>

                            <div style={{ minWidth: 0 }}>
                                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Stop questions</label>
                                {stopQuestions.length > 0 ? (
                                    <div>
                                        {stopQuestions.map(question => (
                                            <div key={question.id} style={{ ...questionRowStyle, opacity: question.is_active ? 1 : 0.5 }}>
                                                <div style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
                                                    <span style={{ fontWeight: 600, marginRight: '0.5rem' }}>{question.id}</span>
                                                    <span>{question.text} {question.is_active ? '' : '(Inactive)'}</span>
                                                </div>
                                                <div style={{ flex: '0 0 auto', display: 'flex', gap: '0.5rem' }}>
                                                    <Link to={`/admin/parameters/${id}/edit/questions/${encodeURIComponent(question.id)}/edit`} className="btn btn--small">Edit</Link>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleQuestionActive(question.id, question.is_active)}
                                                        className={`btn btn--small ${question.is_active ? 'btn--danger' : ''}`}
                                                        style={{ color: question.is_active ? 'red' : 'green', borderColor: question.is_active ? 'red' : 'green' }}
                                                    >
                                                        {question.is_active ? 'Deactivate' : 'Reactivate'}
                                                    </button>
                                                    {!question.is_active && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setDeleteCandidate(question.id)}
                                                            className="btn btn--small btn--danger"
                                                            style={{ color: 'red', borderColor: 'red' }}
                                                            title="Delete permanently (linked data is archived first)"
                                                            aria-label={`Delete question ${question.id} permanently`}
                                                        >
                                                            🗑
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ ...questionRowStyle, justifyContent: 'center' }}><span className="muted">No stop questions</span></div>
                                )}
                            </div>
                        </div>

                        <div style={{
                            marginTop: 'var(--form-col-gap, 1.5rem)',
                            padding: '0.85rem 1rem',
                            background: 'var(--surface-2, #f8fafc)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ flex: '1 1 320px' }}>
                                    <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Quick-fill blank answers</strong>
                                    <span className="small muted">
                                        Set <code>YES</code> on every stop question and <code>NO</code> on every normal question,
                                        for all languages that do not already have an answer.
                                        Existing answers are never overwritten.
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleQuickFill}
                                    disabled={quickFilling || !formData.is_active}
                                    className="btn"
                                    title={!formData.is_active ? "Parameter is deactivated" : "Pre-populate every missing answer for this parameter"}
                                >
                                    {quickFilling ? 'Filling…' : 'Quick-fill blank answers'}
                                </button>
                            </div>
                        </div>

                        <div style={{ marginTop: 'var(--form-col-gap, 1.5rem)', textAlign: 'right' }}>
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
                    <p className="small muted" style={{marginBottom: 'var(--form-field-mb, 1rem)'}}>
                        Other parameters that depend on this one.
                    </p>

                    <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                        {usage.map(parameter => (
                            <Link key={parameter.id} to={`/admin/parameters/${parameter.id}/edit`} className="card" style={{padding: '0.5rem', fontSize: '0.85rem', textDecoration: 'none', borderLeft: '4px solid var(--brand)'}}>
                                <strong>{parameter.id}</strong>: {parameter.name}
                            </Link>
                        ))}
                        {usage.length === 0 && <p className="muted italic small">Not used by other parameters.</p>}
                    </div>
                </div>
            </aside>
        </div>

        {deactivateCandidate && (
            <DeactivateQuestionDialog
                questionId={deactivateCandidate}
                onClose={() => setDeactivateCandidate(null)}
                onDeactivated={async () => {
                    setDeactivateCandidate(null);
                    const paramRes = await api.get(`/api/admin/parameters/${id}`);
                    setQuestions(paramRes.data.questions || []);
                }}
            />
        )}

        {deleteCandidate && (
            <DeleteQuestionDialog
                questionId={deleteCandidate}
                onClose={() => setDeleteCandidate(null)}
                onDeleted={async () => {
                    setDeleteCandidate(null);
                    const paramRes = await api.get(`/api/admin/parameters/${id}`);
                    setQuestions(paramRes.data.questions || []);
                }}
            />
        )}

        <Drawer
            open={isDrawerOpen}
            onClose={() => navigate(`/admin/parameters/${id}/edit`)}
            ariaLabel="Edit question"
        >
            {outlet}
        </Drawer>
        </>
    );
}

function LookupField({
    label, name, value, items, kind,
    onChange, newInputValue, onNewInputChange, onAdd, onDelete,
}) {
    const [manageOpen, setManageOpen] = useState(false);
    return (
        <div>
            <label style={{ fontWeight: 'bold' }}>{label}</label>
            <select name={name} value={value} onChange={onChange} style={{ width: '100%', padding: 'var(--form-input-pad, 0.5rem)', marginBottom: '0.5rem' }}>
                <option value="">-- Select --</option>
                {items.map(item => <option key={item.id} value={item.label}>{item.label}</option>)}
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
                    onClick={() => setManageOpen(open => !open)}
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
                    ) : items.map(item => (
                        <div key={item.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.3rem 0.5rem',
                            fontSize: '0.8rem',
                            borderBottom: '1px solid var(--border)',
                        }}>
                            <span>{item.label}</span>
                            <button
                                type="button"
                                onClick={() => onDelete(kind, item.id, item.label)}
                                title={`Delete "${item.label}"`}
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