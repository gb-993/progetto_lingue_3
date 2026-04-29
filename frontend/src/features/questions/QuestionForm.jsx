import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import api from '../../api';
import useFormDraft from '../../utils/useFormDraft';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import DraftIndicator from '../../components/DraftIndicator';

const Q_DRAFT_FIELDS = [
    'text', 'instruction', 'instruction_yes', 'instruction_no',
    'example_yes', 'help_info', 'is_stop_question',
];

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
        example_yes: '',
        help_info: '',
        is_stop_question: false,
        is_active: true,
        allowed_motivations: []
    });

    const [parameters, setParameters] = useState([]);
    const [allMotivations, setAllMotivations] = useState([]);
    const [allQuestions, setAllQuestions] = useState([]);
    const [importedFrom, setImportedFrom] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [showCreator, setShowCreator] = useState(false);
    const [newMotData, setNewMotData] = useState({ code: '', label: '' });

    // Stati per Audit Log (mutuati da ParameterForm)
    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);
    const [draftReady, setDraftReady] = useState(false);

    // Persistenza locale della bozza dei testi della domanda. La key dipende
    // dall'id (in edit) o dal parametro di destinazione (in creazione), così
    // bozze di pagine diverse non si sovrappongono.
    const draftKey = isEditMode
        ? `draft_question_${id}`
        : `draft_question_new_${formData.parameter_id || paramFromUrl || 'noparam'}`;
    const { clearDraft, lastSavedAt } = useFormDraft({
        storageKey: draftKey,
        formData,
        setFormData,
        fields: Q_DRAFT_FIELDS,
        enabled: draftReady,
    });

    // Stato per il "Clone with data" (azione che crea una nuova question
    // copiando answers/examples/motivations dalla sorgente). Il nuovo ID viene
    // letto dal campo "Question ID" del form (già auto-precompilato con la
    // prossima lettera libera del parametro target).
    const [cloneSource, setCloneSource] = useState(null);
    const [cloning, setCloning] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [paramsRes, motsRes, qsRes] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/motivations'),
                    api.get('/api/admin/questions')
                ]);
                setParameters(paramsRes.data || []);
                setAllMotivations(motsRes.data || []);
                setAllQuestions(qsRes.data || []);

                if (isEditMode) {
                    const questionRes = await api.get(`/api/admin/questions/${id}`);
                    const qData = {
                        id: questionRes.data.id || '',
                        parameter_id: questionRes.data.parameter_id || '',
                        text: questionRes.data.text || '',
                        instruction: questionRes.data.instruction || '',
                        instruction_yes: questionRes.data.instruction_yes || '',
                        instruction_no: questionRes.data.instruction_no || '',
                        example_yes: questionRes.data.example_yes || '',
                        help_info: questionRes.data.help_info || '',
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
                setError('Could not load the data.');
            } finally {
                setDraftReady(true);
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

    // Lista delle domande del parametro corrente (per il pannello "Existing in this parameter")
    const currentParamQuestions = useMemo(() => {
        if (!formData.parameter_id) return [];
        return allQuestions
            .filter(q => q.parameter_id === formData.parameter_id)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }, [allQuestions, formData.parameter_id]);

    // Calcola la prossima lettera libera per gli ID di tipo `{paramId}_Q{lettera}`.
    // Le stop question hanno pattern `_QS...` (S maiuscola) e vengono ignorate dal
    // matching grazie al group [a-z] case-sensitive. Ritorna null se tutte le
    // lettere a-z sono già occupate.
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suggestedQuestionId = useMemo(() => {
        if (!formData.parameter_id) return '';
        const re = new RegExp(`^${escapeRegex(formData.parameter_id)}_Q([a-z])`);
        const used = new Set();
        for (const q of currentParamQuestions) {
            const m = String(q.id).match(re);
            if (m) used.add(m[1]);
        }
        for (let i = 0; i < 26; i++) {
            const letter = String.fromCharCode(97 + i);
            if (!used.has(letter)) return `${formData.parameter_id}_Q${letter}`;
        }
        return ''; // tutte le lettere occupate (>26 domande)
    }, [formData.parameter_id, currentParamQuestions]);

    // Pre-compila il campo ID col suggerimento quando si sceglie un parametro.
    // Sovrascriviamo solo se l'utente non ha digitato un ID custom: tracciamo
    // l'ultimo valore auto-generato e lo aggiorniamo solo se l'attuale combacia.
    const lastAutoFilledRef = useRef('');
    useEffect(() => {
        if (isEditMode) return;
        if (!suggestedQuestionId) return;
        setFormData(prev => {
            const isEmpty = !prev.id;
            const isStillAuto = prev.id === lastAutoFilledRef.current;
            if (isEmpty || isStillAuto) {
                lastAutoFilledRef.current = suggestedQuestionId;
                return { ...prev, id: suggestedQuestionId };
            }
            return prev;
        });
    }, [suggestedQuestionId, isEditMode]);

    // Opzioni raggruppate per parametro per il select di import
    const groupedQuestionOptions = useMemo(() => {
        return parameters
            .map(p => {
                const opts = allQuestions
                    .filter(q => q.parameter_id === p.id)
                    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                    .map(q => {
                        const txt = (q.text || '').trim();
                        const snippet = txt.length > 70 ? `${txt.slice(0, 70)}…` : txt;
                        return { value: q.id, label: `${q.id} — ${snippet}` };
                    });
                return { label: `${p.id} - ${p.name}`, options: opts };
            })
            .filter(g => g.options.length > 0);
    }, [parameters, allQuestions]);

    const handleCloneWithData = async () => {
        if (!cloneSource) {
            alert('Pick a source question to clone.');
            return;
        }
        if (!formData.parameter_id) {
            alert('Pick a target parameter first.');
            return;
        }
        const newId = (formData.id || '').trim();
        const message =
            `This creates a NEW question "${newId || '(auto)'}" in parameter "${formData.parameter_id}" ` +
            `cloning "${cloneSource.value}" together with all its answers, examples and motivations ` +
            `from every language. The source question will not be modified.\n\n` +
            `Any unsaved changes in the form below will be discarded. Continue?`;
        if (!window.confirm(message)) return;
        setCloning(true);
        try {
            const res = await api.post('/api/admin/questions/clone', {
                source_question_id: cloneSource.value,
                target_parameter_id: formData.parameter_id,
                new_id: newId || null,
            });
            clearDraft();
            const newId = res.data?.id;
            const stats = res.data?.stats || {};
            alert(
                `Cloned as ${newId}.\n` +
                `Copied: ${stats.answers || 0} answers, ${stats.examples || 0} examples, ` +
                `${stats.motivations || 0} answer-motivations, ${stats.allowed_motivations || 0} allowed motivations.`
            );
            navigate(`/admin/questions/${encodeURIComponent(newId)}/edit`);
        } catch (err) {
            const detail = err?.response?.data?.detail;
            alert(typeof detail === 'string' ? detail : 'Could not clone the question.');
        } finally {
            setCloning(false);
        }
    };

    const handleImportQuestion = async (selected) => {
        if (!selected) {
            setImportedFrom(null);
            return;
        }
        try {
            const res = await api.get(`/api/admin/questions/${selected.value}`);
            const q = res.data;
            // Non sovrascriviamo id (deve essere nuovo) né parameter_id (è il corrente)
            setFormData(prev => ({
                ...prev,
                text: q.text || '',
                instruction: q.instruction || '',
                instruction_yes: q.instruction_yes || '',
                instruction_no: q.instruction_no || '',
                example_yes: q.example_yes || '',
                help_info: q.help_info || '',
                is_stop_question: q.is_stop_question ?? false,
                allowed_motivations: q.allowed_motivations || []
            }));
            setImportedFrom(selected);
        } catch {
            alert("Error importing the selected question.");
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
            alert("Error creating the motivation.");
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
                example_yes: formData.example_yes?.trim() || null,
                help_info: formData.help_info?.trim() || null,
                change_note: changeNote
            };

            if (isEditMode) {
                await api.put(`/api/admin/questions/${id}`, payload);
            } else {
                await api.post('/api/admin/questions', payload);
            }
            clearDraft();
            navigate(`/admin/parameters/${formData.parameter_id}/edit`);
        } catch (err) {
            setError(err.response?.data?.detail || 'Error while saving.');
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
        safeString(formData.example_yes) !== safeString(initialData.example_yes) ||
        safeString(formData.help_info) !== safeString(initialData.help_info) ||
        formData.is_stop_question !== initialData.is_stop_question ||
        formData.is_active !== initialData.is_active ||
        !isArraysEqual(formData.allowed_motivations, initialData.allowed_motivations)
    ));

    // Variante per il guard: in creazione "dirty" se almeno un campo
    // tracciato è stato compilato. Senza questo, il guard scatterebbe anche
    // quando l'utente è appena arrivato sulla pagina e non ha toccato nulla.
    const isCreatingDirty = !isEditMode && (
        Q_DRAFT_FIELDS.some(f => {
            const v = formData[f];
            if (v === null || v === undefined || v === '' || v === false) return false;
            if (typeof v === 'string') return v.trim().length > 0;
            return true;
        }) || (formData.allowed_motivations || []).length > 0
    );
    const isDirtyForGuard = isEditMode ? !!isDirty : isCreatingDirty;

    // Doppia rete: beforeunload (chiusura tab/refresh) + useBlocker (Link,
    // breadcrumb, back-button). Disattivata durante save o clone in corso
    // così il navigate volontario post-azione non viene bloccato da se stesso.
    useUnsavedChangesGuard(isDirtyForGuard && !isLoading && !cloning);

    const cancelLink = formData.parameter_id
        ? `/admin/parameters/${formData.parameter_id}/edit`
        : (paramFromUrl ? `/admin/parameters/${paramFromUrl}/edit` : '/admin/questions');

    return (
        <div className="container" style={{ maxWidth: '900px', marginTop: '2rem', position: 'relative' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap'}}>
                    <h2 style={{ margin: 0 }}>{isEditMode ? `Edit Question: ${id}` : 'Add New Question'}</h2>
                    <DraftIndicator lastSavedAt={lastSavedAt} />
                </header>

                {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    {/* --- IMPORT (solo in creazione, riga compatta) --- */}
                    {!isEditMode && (
                        <>  


                            {/* --- CLONE WITH DATA (azione di duplicazione vera) --- */}
                            <div style={{
                                background: 'var(--surface-2, #f8fafc)',
                                padding: '0.6rem 0.85rem',
                                borderRadius: '8px',
                                border: '1px dashed var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.6rem',
                                flexWrap: 'wrap',
                            }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    Import WITH data
                                </label>
                                <div style={{ flex: '1 1 280px', minWidth: '240px' }}>
                                    <Select
                                        isClearable
                                        options={groupedQuestionOptions}
                                        value={cloneSource}
                                        onChange={setCloneSource}
                                        placeholder="Pick a question to clone with all its answers, examples and motivations..."
                                        noOptionsMessage={() => "No question available"}
                                        isDisabled={cloning}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCloneWithData}
                                    disabled={!cloneSource || !formData.parameter_id || cloning}
                                    className="btn btn--small"
                                >
                                    {cloning ? 'Cloning...' : 'Clone now'}
                                </button>
                                <div className="small muted" style={{ flexBasis: '100%', fontSize: '0.72rem', lineHeight: 1.35, marginTop: '0.1rem' }}>
                                    Creates immediately a new question in the target parameter (using the <strong>Question ID</strong> below)
                                    by copying answers, examples and motivations from <em>every language</em>.
                                    The source question is left untouched.
                                </div>
                            </div>

                            
                            <div style={{ background: 'var(--surface-2, #f8fafc)', padding: '0.6rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    Import template (text only)
                                </label>
                                <div style={{ flex: '1 1 320px', minWidth: '260px' }}>
                                    <Select
                                        isClearable
                                        options={groupedQuestionOptions}
                                        value={importedFrom}
                                        onChange={handleImportQuestion}
                                        placeholder="Pick a question to copy text, instructions, motivations into the form below..."
                                        noOptionsMessage={() => "No question available"}
                                    />
                                </div>
                                {importedFrom && (
                                    <span className="small" style={{ color: '#0056b3' }}>
                                        Imported from <strong>{importedFrom.value}</strong>
                                    </span>
                                )}
                            </div>

                            
                        </>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Question ID</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{ width: '100%', padding: '0.6rem' }} />
                            {!isEditMode && formData.parameter_id && (
                                <div className="small muted" style={{ marginTop: '0.3rem', fontSize: '0.75rem', lineHeight: 1.35 }}>
                                    {currentParamQuestions.length > 0 ? (
                                        <>
                                            Existing in this parameter:{' '}
                                            {currentParamQuestions.map((q, i) => (
                                                <span key={q.id}>
                                                    <code style={{ fontSize: '0.78rem' }}>{q.id}</code>
                                                    {i < currentParamQuestions.length - 1 ? ', ' : ''}
                                                </span>
                                            ))}
                                        </>
                                    ) : (
                                        <>No questions yet in this parameter.</>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Destination Parameter</label>
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

                        <div style={{ marginTop: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Example for YES (illustrative)</label>
                            <textarea name="example_yes" value={formData.example_yes} onChange={handleChange} rows="3" style={{ width: '100%', padding: '0.6rem' }} placeholder="Example shown when discussing a YES case..." />
                        </div>

                        <div style={{ marginTop: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Help info (More info expandable)</label>
                            <textarea name="help_info" value={formData.help_info} onChange={handleChange} rows="3" style={{ width: '100%', padding: '0.6rem' }} placeholder="Additional info shown in the More info expander on the compilation page..." />
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
                            <label htmlFor="is_active" style={{ fontWeight: 'bold' }}>Active Question</label>
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
                                ? 'New Question — Note Required'
                                : (isDirty ? 'Changes Detected' : 'Audit Log & Note (Parent Parameter)')}
                        </h4>
                        <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            {!isEditMode
                                ? 'You are adding a new question. Enter a description that will be saved in the history of the parent parameter.'
                                : (isDirty
                                    ? 'You have modified this question. You must enter a reason in order to save.'
                                    : 'No changes detected. Edit at least one field to enable saving and to add a note. The note will be saved in the history of the parent parameter.')}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                            <div>
                                <textarea
                                    value={changeNote}
                                    onChange={e => setChangeNote(e.target.value)}
                                    rows="4"
                                    placeholder={!isEditMode
                                        ? "Describe the new question..."
                                        : "Describe the reason for the change..."}
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
                                    onClick={() => setChangeNote(isEditMode ? "Test edit" : "Test new question")}
                                >
                                    {isEditMode ? 'Test edit' : 'Test new'}
                                </button>
                            </div>

                            <div style={{ background: 'var(--surface)', color: 'var(--text)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '130px', overflowY: 'auto' }}>
                                <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                                    Latest Changes {formData.parameter_id ? `(Parameter: ${formData.parameter_id})` : ''}
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {changeLogs
                                        .filter(log => log.change_note !== "Test edit"
                                            && !log.change_note.startsWith("Test new question")
                                            && !log.change_note.startsWith("DEACTIVATED"))
                                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                        .map(log => (
                                            <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                                                <strong style={{ color: 'var(--link)' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                            </div>
                                        ))
                                    }
                                    {changeLogs.filter(log => log.change_note !== "Test edit"
                                        && !log.change_note.startsWith("Test new question")
                                        && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No recent changes recorded.</span>
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