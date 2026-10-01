import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import Select, { components as RSComponents } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import api, { getApiErrorMessage } from '../../api';
import useFormDraft from '../../utils/useFormDraft';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import DraftIndicator from '../../components/DraftIndicator';
import CopyExamplesModal from './CopyExamplesModal';
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

// is_stop_question escluso di proposito
const QUESTION_DRAFT_FIELDS = [
    'text', 'instruction', 'instruction_yes', 'instruction_no',
    'example_yes', 'help_info',
];

const QUESTION_ID_MAX_LENGTH = 40; // lunghezza di Question.id nel backend
const escapeRegexId = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ID suggerito: FMM_Qa, oppure FMM_Qa2 se duplicata
function computeSuggestedQuestionId({ parameterId, isStop, copySource, questions }) {
    if (!parameterId) return '';
    const siblingQuestions = (questions || []).filter(question => question.parameter_id === parameterId);

    if (!copySource) {
        const infix = isStop ? '_QS' : '_Q';
        const letterIdRe = new RegExp(`^${escapeRegexId(parameterId)}${infix}([a-z])`);
        const usedLetters = new Set();
        for (const question of siblingQuestions) {
            const match = String(question.id).match(letterIdRe);
            if (match) usedLetters.add(match[1]);
        }
        for (let i = 0; i < 26; i++) {
            const letter = String.fromCharCode(97 + i);
            if (!usedLetters.has(letter)) return `${parameterId}${infix}${letter}`;
        }
        return ''; // tutte le lettere a-z occupate
    }

    const sourceWithoutNumber = String(copySource).replace(/\d+$/, '');
    let stem;
    const stopMatch = sourceWithoutNumber.match(/^(.*)_QS([a-zA-Z]*)$/);
    if (stopMatch) {
        stem = isStop ? `${stopMatch[1]}_QS${stopMatch[2]}` : `${stopMatch[1]}_Q${stopMatch[2]}`;
    } else {
        const normalMatch = sourceWithoutNumber.match(/^(.*)_Q([a-zA-Z]*)$/);
        stem = normalMatch
            ? (isStop ? `${normalMatch[1]}_QS${normalMatch[2]}` : `${normalMatch[1]}_Q${normalMatch[2]}`)
            : sourceWithoutNumber;
    }
    const numberedIdRe = new RegExp(`^${escapeRegexId(stem)}(\\d+)$`);
    const usedNumbers = new Set();
    for (const question of siblingQuestions) {
        const match = String(question.id).match(numberedIdRe);
        if (match) usedNumbers.add(parseInt(match[1], 10));
    }
    let nextNumber = 2; // l'originale (senza numero) conta come 1
    while (usedNumbers.has(nextNumber)) nextNumber++;
    const candidate = `${stem}${nextNumber}`;
    return candidate.length > QUESTION_ID_MAX_LENGTH ? candidate.slice(0, QUESTION_ID_MAX_LENGTH) : candidate;
}

// come utils/reactSelectStyles.js
const reactSelectStyles = {
    control: (base, state) => ({
        ...base,
        background: 'var(--surface)',
        borderColor: state.isFocused ? 'var(--brand, var(--link))' : 'var(--border)',
        boxShadow: state.isFocused ? '0 0 0 1px var(--brand, var(--link))' : 'none',
        ':hover': { borderColor: 'var(--border)' },
    }),
    menu: (base) => ({
        ...base,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
    }),
    menuList: (base) => ({ ...base, background: 'var(--surface)' }),
    option: (base, state) => ({
        ...base,
        background: state.isSelected
            ? 'var(--surface-2)'
            : state.isFocused ? 'var(--surface-alt, var(--surface-2))' : 'var(--surface)',
        color: 'var(--text)',
        cursor: 'pointer',
    }),
    singleValue: (base) => ({ ...base, color: 'var(--text)' }),
    multiValue: (base) => ({
        ...base,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
    }),
    multiValueLabel: (base) => ({ ...base, color: 'var(--text)' }),
    multiValueRemove: (base) => ({
        ...base,
        color: 'var(--text-muted)',
        ':hover': { background: 'var(--bad, #dc2626)', color: '#fff' },
    }),
    input: (base) => ({ ...base, color: 'var(--text)' }),
    placeholder: (base) => ({ ...base, color: 'var(--text-muted)' }),
    groupHeading: (base) => ({ ...base, color: 'var(--text-muted)' }),
    dropdownIndicator: (base) => ({ ...base, color: 'var(--text-muted)' }),
    indicatorSeparator: (base) => ({ ...base, background: 'var(--border)' }),
    noOptionsMessage: (base) => ({ ...base, color: 'var(--text-muted)' }),
};

export default function QuestionForm({ mode = 'page' }) {
    const params = useParams();
    const isDrawerMode = mode === 'drawer';
    const id = isDrawerMode ? params.qid : params.id;
    const drawerParentParamId = isDrawerMode ? params.id : null;
    const navigate = useNavigate();
    const isEditMode = Boolean(id);
    const [searchParams] = useSearchParams();
    const paramFromUrl = searchParams.get('param_id') || drawerParentParamId;

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
    const [templateSource, setTemplateSource] = useState(null);
    const [importedFrom, setImportedFrom] = useState(null);
    const [dataTemplateSource, setDataTemplateSource] = useState(null);
    const [dataImportedFrom, setDataImportedFrom] = useState(null);
    const [copyDataFrom, setCopyDataFrom] = useState(null);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const [showCreator, setShowCreator] = useState(false);
    const [newMotData, setNewMotData] = useState({ code: '', label: '' });

    const [editingMotivationId, setEditingMotivationId] = useState(null);
    const [editMotData, setEditMotData] = useState({ code: '', label: '' });
    const [initialMotData, setInitialMotData] = useState({ code: '', label: '' });
    const [motSaving, setMotSaving] = useState(false);
    const [motDeleting, setMotDeleting] = useState(false);

    const [changeNote, setChangeNote] = useState('');
    const [changeLogs, setChangeLogs] = useState([]);
    const [draftReady, setDraftReady] = useState(false);
    const [isTestEdit, setIsTestEdit] = useState(false);

    const draftKey = isEditMode
        ? `draft_question_${id}`
        : `draft_question_new_${formData.parameter_id || paramFromUrl || 'noparam'}`;
    const { clearDraft, lastSavedAt } = useFormDraft({
        storageKey: draftKey,
        formData,
        setFormData,
        fields: QUESTION_DRAFT_FIELDS,
        enabled: draftReady,
    });

    const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
    const [wipeStats, setWipeStats] = useState(null);
    const [wipeStatsLoading, setWipeStatsLoading] = useState(false);

    const [copyExamplesOpen, setCopyExamplesOpen] = useState(false);
    const [copyFromWipe, setCopyFromWipe] = useState(false);

    const othersEditing = usePresence('question', id, isEditMode && !!id);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // with-usage: include le question collegate
                const [parametersRes, motivationsRes, questionsRes] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/admin/motivations/with-usage'),
                    api.get('/api/admin/questions')
                ]);
                setParameters(parametersRes.data || []);
                setAllMotivations(motivationsRes.data || []);
                setAllQuestions(questionsRes.data || []);

                if (isEditMode) {
                    const questionRes = await api.get(`/api/admin/questions/${id}`);
                    const loadedQuestion = {
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

                    setFormData(loadedQuestion);
                    setInitialData(loadedQuestion);

                    try {
                        const paramRes = await api.get(`/api/admin/parameters/${loadedQuestion.parameter_id}`);
                        setChangeLogs(paramRes.data.change_logs || []);
                    } catch(err) {
                        console.warn("Impossibile caricare i log del parametro", err);
                    }

                } else if (paramFromUrl) {
                    setFormData((prev) => ({ ...prev, parameter_id: paramFromUrl }));
                    try {
                        const paramRes = await api.get(`/api/admin/parameters/${paramFromUrl}`);
                        setChangeLogs(paramRes.data.change_logs || []);
                    } catch(err) {
                        console.warn("Impossibile caricare i log del parametro", err);
                    }
                }
            } catch (err) {
                setError(getApiErrorMessage(err, 'Could not load the data.'));
            } finally {
                setDraftReady(true);
            }
        };
        fetchData();
    }, [id, isEditMode, paramFromUrl]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (name === 'id') idEditedByUserRef.current = value.trim() !== '';
        setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));

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

    const suggestedQuestionId = useMemo(
        () => computeSuggestedQuestionId({
            parameterId: formData.parameter_id,
            isStop: formData.is_stop_question,
            copySource: copyDataFrom,
            questions: allQuestions,
        }),
        [formData.parameter_id, formData.is_stop_question, copyDataFrom, allQuestions]
    );

    const idEditedByUserRef = useRef(false);
    useEffect(() => {
        if (isEditMode) return;
        if (!suggestedQuestionId) return;
        if (idEditedByUserRef.current) return;
        setFormData(prev => (prev.id === suggestedQuestionId ? prev : { ...prev, id: suggestedQuestionId }));
    }, [suggestedQuestionId, isEditMode]);

    const groupedQuestionOptions = useMemo(() => {
        return parameters
            .map(parameter => {
                const options = allQuestions
                    .filter(question => question.parameter_id === parameter.id)
                    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
                    .map(question => {
                        const text = (question.text || '').trim();
                        const snippet = text.length > 70 ? `${text.slice(0, 70)}…` : text;
                        return { value: question.id, label: `${question.id} — ${snippet}` };
                    });
                return { label: `${parameter.id} - ${parameter.name}`, options };
            })
            .filter(group => group.options.length > 0);
    }, [parameters, allQuestions]);

    const handleImportQuestion = async (selected, { withData = false } = {}) => {
        if (!selected) {
            if (withData) { setDataImportedFrom(null); setCopyDataFrom(null); }
            else { setImportedFrom(null); }
            return;
        }
        try {
            const res = await api.get(`/api/admin/questions/${selected.value}`);
            const source = res.data;
            const sourceParam = source.parameter_id || '';
            const sourceStop = source.is_stop_question ?? false;
            const newId = computeSuggestedQuestionId({
                parameterId: sourceParam,
                isStop: sourceStop,
                copySource: withData ? selected.value : null,
                questions: allQuestions,
            });
            idEditedByUserRef.current = false;
            setFormData(prev => ({
                ...prev,
                parameter_id: sourceParam,
                text: source.text || '',
                instruction: source.instruction || '',
                instruction_yes: source.instruction_yes || '',
                instruction_no: source.instruction_no || '',
                example_yes: source.example_yes || '',
                help_info: source.help_info || '',
                is_stop_question: sourceStop,
                allowed_motivations: source.allowed_motivations || [],
                id: newId,
            }));
            if (withData) {
                setCopyDataFrom(selected.value);
                setDataImportedFrom(selected);
                setImportedFrom(null);
                setTemplateSource(null);
            } else {
                setImportedFrom(selected);
                setCopyDataFrom(null);
                setDataImportedFrom(null);
                setDataTemplateSource(null);
            }
        } catch (err) {
            alert(getApiErrorMessage(err, 'Could not import the selected question.'));
        }
    };

    const selectedOptions = allMotivations
        .filter(motivation => formData.allowed_motivations.includes(motivation.id))
        .map(motivation => ({ value: motivation.id, label: `${motivation.code} - ${motivation.label}` }));

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

    const suggestNextMotivationCode = useCallback(() => {
        const motivationCodeRe = /^MOT(\d+)$/i;
        let maxNumber = 0;
        for (const motivation of allMotivations) {
            const match = String(motivation.code || '').match(motivationCodeRe);
            if (match) {
                const number = parseInt(match[1], 10);
                if (Number.isFinite(number) && number > maxNumber) maxNumber = number;
            }
        }
        return `MOT${String(maxNumber + 1).padStart(3, '0')}`;
    }, [allMotivations]);

    const openCreatorFromFooter = useCallback(() => {
        setNewMotData({ code: suggestNextMotivationCode(), label: '' });
        setShowCreator(true);
    }, [suggestNextMotivationCode]);

    // la history è quella del parametro
    const handleDownloadChangelogPdf = async () => {
        const paramId = formData.parameter_id;
        if (!paramId) return;
        try {
            await downloadBlob(
                api.get(`/api/admin/parameters/${paramId}/changelog-pdf`, { responseType: 'blob' }),
                `Parameter_${paramId}_changelog.pdf`
            );
        } catch {
            alert('Error while downloading the change history PDF.');
        }
    };

    // useCallback: serve al chip di react-select
    const openMotivationEditor = useCallback((motivationId) => {
        const motivation = allMotivations.find(candidate => candidate.id === motivationId);
        if (!motivation) return;
        const snapshot = { code: motivation.code || '', label: motivation.label || '' };
        setEditingMotivationId(motivationId);
        setEditMotData(snapshot);
        setInitialMotData(snapshot);
    }, [allMotivations]);

    const motDirty = !!editingMotivationId && (
        editMotData.code !== initialMotData.code ||
        editMotData.label !== initialMotData.label
    );

    const closeMotivationEditor = () => {
        if (motSaving || motDeleting) return;
        if (motDirty && !window.confirm('You have unsaved changes on this motivation. Discard them?')) return;
        setEditingMotivationId(null);
        setEditMotData({ code: '', label: '' });
        setInitialMotData({ code: '', label: '' });
    };

    const saveEditedMotivation = async () => {
        if (!editingMotivationId) return;
        const code = (editMotData.code || '').trim().toUpperCase();
        const label = (editMotData.label || '').trim();
        if (!code || !label) return;
        setMotSaving(true);
        try {
            const res = await api.put(`/api/admin/motivations/${editingMotivationId}`, { code, label });
            setAllMotivations(prev => prev.map(motivation =>
                motivation.id === editingMotivationId
                    ? { ...motivation, ...res.data, linked_questions: motivation.linked_questions }
                    : motivation
            ));
            setEditingMotivationId(null);
            setEditMotData({ code: '', label: '' });
            setInitialMotData({ code: '', label: '' });
        } catch (err) {
            alert(err.response?.data?.detail || 'Error while saving the motivation.');
        } finally {
            setMotSaving(false);
        }
    };

    const deleteCurrentMotivation = async () => {
        if (!editingMotivationId) return;
        const motivation = allMotivations.find(candidate => candidate.id === editingMotivationId);
        const linkedCount = motivation?.linked_questions?.length || 0;
        const confirmMsg = linkedCount > 1
            ? `This motivation is used by ${linkedCount} questions. Deleting it would remove it from all of them. Continue?`
            : 'Delete this motivation? The operation is blocked if it is used by other questions.';
        if (!window.confirm(confirmMsg)) return;
        setMotDeleting(true);
        try {
            await api.delete(`/api/admin/motivations/${editingMotivationId}`);
            setAllMotivations(prev => prev.filter(candidate => candidate.id !== editingMotivationId));
            setFormData(prev => ({
                ...prev,
                allowed_motivations: prev.allowed_motivations.filter(motivationId => motivationId !== editingMotivationId),
            }));
            setEditingMotivationId(null);
            setEditMotData({ code: '', label: '' });
            setInitialMotData({ code: '', label: '' });
        } catch (err) {
            alert(err.response?.data?.detail || 'Deletion blocked: the motivation is in use.');
        } finally {
            setMotDeleting(false);
        }
    };

    const motivationSelectComponents = useMemo(() => ({
        MultiValueLabel: (props) => (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    openMotivationEditor(props.data.value);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textDecorationStyle: 'dotted',
                    textUnderlineOffset: '3px',
                }}
                title="Click to edit or globally delete this motivation"
            >
                <RSComponents.MultiValueLabel {...props} />
            </div>
        ),
        // preventDefault: il select non perde il focus
        MenuList: (props) => (
            <RSComponents.MenuList {...props}>
                {props.children}
                <div
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openCreatorFromFooter();
                    }}
                    style={{
                        position: 'sticky',
                        bottom: 0,
                        padding: '0.55rem 0.75rem',
                        borderTop: '1px solid var(--border)',
                        background: 'var(--surface-2, #f8fafc)',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: 'var(--link, #0056b3)',
                    }}
                    title="Open the modal to create a new motivation with code and description"
                >
                    + Create new motivation…
                </div>
            </RSComponents.MenuList>
        ),
    }), [openMotivationEditor, openCreatorFromFooter]);

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

    const performSave = async ({ wipeData = false } = {}) => {
        setError('');
        setIsLoading(true);

        try {
            const payload = {
                ...formData,
                instruction: formData.instruction?.trim() || null,
                instruction_yes: formData.instruction_yes?.trim() || null,
                instruction_no: formData.instruction_no?.trim() || null,
                example_yes: formData.example_yes?.trim() || null,
                help_info: formData.help_info?.trim() || null,
                change_note: isTestEdit
                    ? `${isEditMode ? 'Test edit' : 'Test new question'}. ${changeNote}`
                    : changeNote,
                wipe_data: wipeData,
                copy_data_from: !isEditMode ? copyDataFrom : null,
            };

            if (isEditMode) {
                await api.put(`/api/admin/questions/${id}`, payload);
            } else {
                await api.post('/api/admin/questions', payload);
            }
            clearDraft();
            navigate(`/admin/parameters/${formData.parameter_id}/edit`);
        } catch (err) {
            setError(getApiErrorMessage(err, 'Error while saving.'));
        } finally {
            setIsLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await performSave({ wipeData: false });
    };

    const handleOpenWipeConfirm = async () => {
        if (!isEditMode) return;
        setWipeStats(null);
        setWipeConfirmOpen(true);
        setWipeStatsLoading(true);
        try {
            const res = await api.get(`/api/admin/questions/${id}/data-stats`);
            setWipeStats(res.data || { answers: 0, examples: 0, languages: 0 });
        } catch {
            setWipeStats({ answers: 0, examples: 0, languages: 0, error: true });
        } finally {
            setWipeStatsLoading(false);
        }
    };

    const handleConfirmWipe = async () => {
        setWipeConfirmOpen(false);
        await performSave({ wipeData: true });
    };

    const safeString = (val) => val === null || val === undefined ? '' : String(val);
    const isArraysEqual = (a, b) => {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((val, index) => val === sortedB[index]);
    };

    const isDirty = !isEditMode || (initialData && (
        safeString(formData.id) !== safeString(initialData.id) ||
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

    const isCreatingDirty = !isEditMode && (
        QUESTION_DRAFT_FIELDS.some(field => {
            const value = formData[field];
            if (value === null || value === undefined || value === '' || value === false) return false;
            if (typeof value === 'string') return value.trim().length > 0;
            return true;
        }) || (formData.allowed_motivations || []).length > 0
    );
    const isDirtyForGuard = isEditMode ? !!isDirty : isCreatingDirty;

    // una sola chiamata: useBlocker non ne regge due
    const questionDirtyForGuard = isDirtyForGuard && !isLoading;
    const guardActive = questionDirtyForGuard || motDirty;
    const guardMessage = motDirty
        ? 'You have unsaved changes on this motivation. If you leave now they will be lost. Continue?'
        : 'You have unsaved changes. If you leave now the draft stays in your browser but is not sent to the server. Continue?';
    useUnsavedChangesGuard(guardActive, guardMessage);

    const cancelLink = formData.parameter_id
        ? `/admin/parameters/${formData.parameter_id}/edit`
        : (paramFromUrl ? `/admin/parameters/${paramFromUrl}/edit` : '/admin/questions');

    return (
        <div className="container" style={{ maxWidth: '760px', marginTop: isDrawerMode ? 0 : 'var(--form-page-top, 2rem)', position: 'relative' }}>
            <div className="card">
                <header style={{
                    marginBottom: 'var(--form-card-header-mb, 1.5rem)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '1rem', flexWrap: 'wrap',
                    ...(othersEditing > 0 && !isDrawerMode ? {
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
                    <h2 style={{ margin: 0 }}>{isEditMode ? `Edit Question: ${id}` : 'Add New Question'}</h2>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {othersEditing > 0 && (
                            <span
                                title="Another user is editing this question right now. The last save wins, so coordinate to avoid overwriting each other."
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
                    </div>
                </header>

                {error && <div className="alert alert-error" style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>{error}</div>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-col-gap, 1.2rem)' }}>
                    {!isEditMode && (
                        <>
                            <div style={importBoxStyle}>
                                <span style={importTitleStyle}>Duplicate WITH data</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 280px', minWidth: '240px' }}>
                                        <Select
                                            isClearable
                                            options={groupedQuestionOptions}
                                            value={dataTemplateSource}
                                            onChange={setDataTemplateSource}
                                            placeholder="Pick a source question…"
                                            noOptionsMessage={() => "No question available"}
                                            styles={reactSelectStyles}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleImportQuestion(dataTemplateSource, { withData: true })}
                                        disabled={!dataTemplateSource}
                                        className="btn btn--small"
                                    >
                                        Duplicate
                                    </button>
                                    {dataImportedFrom && (
                                        <span className="small" style={{ color: '#0056b3' }}>
                                            Duplicating <strong>{dataImportedFrom.value}</strong> with its data
                                        </span>
                                    )}
                                </div>
                                <div className="small muted" style={importDescStyle}>
                                    Fills the form with the source text and instructions, and on save copies all its answers, examples and motivations (every language) into the new question. The source stays untouched.
                                </div>
                            </div>

                            <div style={importBoxStyle}>
                                <span style={importTitleStyle}>Duplicate WITHOUT data</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 280px', minWidth: '240px' }}>
                                        <Select
                                            isClearable
                                            options={groupedQuestionOptions}
                                            value={templateSource}
                                            onChange={setTemplateSource}
                                            placeholder="Pick a source question…"
                                            noOptionsMessage={() => "No question available"}
                                            styles={reactSelectStyles}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleImportQuestion(templateSource)}
                                        disabled={!templateSource}
                                        className="btn btn--small"
                                    >
                                        Duplicate
                                    </button>
                                    {importedFrom && (
                                        <span className="small" style={{ color: '#0056b3' }}>
                                            Imported from <strong>{importedFrom.value}</strong>
                                        </span>
                                    )}
                                </div>
                                <div className="small muted" style={importDescStyle}>
                                    Fills the form below with the source text, instructions and motivations only — no answers. Then edit and save.
                                </div>
                            </div>
                        </>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 'var(--form-grid-gap, 1rem)', alignItems: 'end' }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Destination Parameter</label>
                            <select name="parameter_id" value={formData.parameter_id} onChange={handleChange} required disabled={isEditMode} style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)', backgroundColor: isEditMode ? 'var(--surface-2)' : 'var(--surface)', color: 'var(--text)' }}>
                                <option value="">Select parameter...</option>
                                {parameters.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.id} - {parameter.name}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.6rem', whiteSpace: 'nowrap' }}>
                            <input type="checkbox" id="is_stop_question" name="is_stop_question" checked={formData.is_stop_question} onChange={handleChange} />
                            <label htmlFor="is_stop_question" style={{ fontWeight: 'bold' }}>Stop Question</label>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Question ID</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required maxLength={40} style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)' }} />
                        </div>
                    </div>
                    {isEditMode && initialData && formData.id !== initialData.id && (
                        <div className="small" style={{ marginTop: '-0.6rem', fontSize: '0.75rem', lineHeight: 1.4, color: '#664d03', background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: '6px', padding: '0.5rem 0.7rem' }}>
                            The new ID must be unique and ≤ 40 characters.
                        </div>
                    )}
                    <div>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Question Text</label>
                        <textarea name="text" value={formData.text} onChange={handleChange} required rows="3" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)' }} />
                    </div>

                    <div style={{ background: 'var(--surface, #fafafa)', padding: 'var(--form-box-pad, 1rem)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <h4 style={{marginTop: 0, marginBottom: 'var(--form-field-mb, 1rem)'}}>Instructions</h4>

                        <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>General Instructions (optional)</label>
                            <textarea name="instruction" value={formData.instruction} onChange={handleChange} rows="2" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)' }} placeholder="Shown to users regardless of their answer..." />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--form-grid-gap, 1rem)' }}>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem', color: 'green' }}>Instruction for YES</label>
                                <textarea name="instruction_yes" value={formData.instruction_yes} onChange={handleChange} rows="3" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)', borderLeft: '4px solid green' }} placeholder="Specific instruction if the user answers YES..." />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem', color: 'red' }}>Instruction for NO</label>
                                <textarea name="instruction_no" value={formData.instruction_no} onChange={handleChange} rows="3" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)', borderLeft: '4px solid red' }} placeholder="Specific instruction if the user answers NO..." />
                            </div>
                        </div>

                        <div style={{ marginTop: 'var(--form-field-mb, 1rem)' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Example for YES (illustrative)</label>
                            <textarea name="example_yes" value={formData.example_yes} onChange={handleChange} rows="3" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)' }} placeholder="Example shown when discussing a YES case..." />
                        </div>

                        <div style={{ marginTop: 'var(--form-field-mb, 1rem)' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.3rem' }}>Help info (More info expandable)</label>
                            <textarea name="help_info" value={formData.help_info} onChange={handleChange} rows="3" style={{ width: '100%', padding: 'var(--form-input-pad, 0.6rem)' }} placeholder="Additional info shown in the More info expander on the compilation page..." />
                        </div>
                    </div>

                    <div style={{ background: 'var(--surface-2, #f8fafc)', padding: 'var(--form-box-pad, 1rem)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                            Allowed Motivations (for NO answers)
                        </label>
                        <p className="small muted" style={{ marginBottom: '0.8rem' }}>
                            Select existing motivations, type a new code to create one on the fly, or use <em>+ Create new motivation…</em> at the bottom of the dropdown. Manage the global dictionary in the Motivations menu.
                        </p>
                        <CreatableSelect
                            isMulti
                            options={allMotivations.map(motivation => ({ value: motivation.id, label: `${motivation.code} - ${motivation.label}` }))}
                            value={selectedOptions}
                            onChange={handleSelectChange}
                            onCreateOption={handleCreateOption}
                            placeholder="Search existing motivation... "
                            formatCreateLabel={(inputValue) => `Create new: "${inputValue.toUpperCase()}"`}
                            components={motivationSelectComponents}
                            styles={reactSelectStyles}
                        />
                        <p className="small muted" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                            <strong>click on a chip to edit</strong>
                        </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="checkbox" id="is_active" name="is_active" checked={formData.is_active} onChange={handleChange} />
                            <label htmlFor="is_active" style={{ fontWeight: 'bold' }}>Active Question</label>
                        </div>
                    </div>

                    <div style={{
                        background: isDirty ? '#fff3cd' : 'var(--surface-2, #f8fafc)',
                        padding: 'var(--form-box-pad-lg, 1.5rem)',
                        borderRadius: '8px',
                        border: isDirty ? '1px solid #ffe69c' : '1px solid var(--border)',
                        marginTop: 'var(--form-field-mb, 1rem)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
                            <h4 style={{ margin: 0, color: isDirty ? '#664d03' : 'inherit' }}>
                                {!isEditMode
                                    ? 'New Question — Note Required'
                                    : (isDirty ? 'Changes Detected' : 'Brief summary of changes (Parent Parameter)')}
                            </h4>
                            {formData.parameter_id && (
                                <button
                                    type="button"
                                    className="btn btn--small"
                                    onClick={handleDownloadChangelogPdf}
                                    title="Download the change history of the parent parameter as PDF"
                                >
                                    Download PDF
                                </button>
                            )}
                        </div>
                        <p style={{ color: isDirty ? '#664d03' : '#64748b', marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.9rem' }}>
                            {!isEditMode
                                ? 'You are adding a new question. Enter a description that will be saved in the history of the parent parameter.'
                                : (isDirty
                                    ? 'You have modified this question. You must enter a reason in order to save.'
                                    : 'No changes detected. Edit at least one field to enable saving and to add a note. The note will be saved in the history of the parent parameter.')}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--form-grid-gap, 1.5rem)' }}>
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
                                        padding: 'var(--form-input-pad, 0.5rem)',
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
                                    <span>{isEditMode ? '🧪 Mark as test edit' : '🧪 Mark as test new question'}</span>
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
                                <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                                    Latest Changes {formData.parameter_id ? `(Parameter: ${formData.parameter_id})` : ''}
                                </h5>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {changeLogs
                                        .filter(log => !log.change_note.startsWith("Test edit")
                                            && !log.change_note.startsWith("Test new question")
                                            && !log.change_note.startsWith("DEACTIVATED"))
                                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                                        .map(log => (
                                            <div key={log.id} style={{ fontSize: '0.8rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.25rem' }}>
                                                <strong style={{ color: 'var(--link)' }}>{new Date(log.created_at).toLocaleDateString()}</strong>: {log.change_note}
                                            </div>
                                        ))
                                    }
                                    {changeLogs.filter(log => !log.change_note.startsWith("Test edit")
                                        && !log.change_note.startsWith("Test new question")
                                        && !log.change_note.startsWith("DEACTIVATED")).length === 0 && (
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No recent changes recorded.</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: 'var(--form-col-gap, 1.5rem)', borderTop: '1px solid var(--border)', paddingTop: 'var(--form-col-gap, 1.5rem)', flexWrap: 'wrap' }}>
                        <button
                            type="submit"
                            className="btn btn--primary"
                            disabled={isLoading || !isDirty || !changeNote.trim()}
                        >
                            {isLoading ? 'Saving...' : (isEditMode ? 'Save the changes and maintain data' : 'Save Question')}
                        </button>
                        {isEditMode && (
                            <button
                                type="button"
                                className="btn btn--primary"
                                onClick={handleOpenWipeConfirm}
                                disabled={isLoading || !isDirty || !changeNote.trim()}
                                title="Archive all linked answers and examples, then save the new text"
                            >
                                Save the changes and delete the linked data
                            </button>
                        )}
                        
                        <Link to={cancelLink} className="btn">Cancel</Link>
                    </div>
                    {isEditMode && (
                        <p className="small muted" style={{ marginTop: '-0.5rem', fontSize: '0.78rem', lineHeight: 1.4 }}>
                            "Maintain data" keeps the existing answers/examples linked to this question. "Delete the linked data" archives them in <strong>Old Questions Archive</strong> (still downloadable) and resets this question to zero data — use it when the new text is no longer compatible with the old answers.
                        </p>
                    )}
                </form>
            </div>

            {showCreator && (
                <div style={modalOverlayStyle}>
                    <div className="card" style={{ width: '400px', maxWidth: '92vw' }}>
                        <h3>New Motivation</h3>
                        <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                            <label className="small">Code</label>
                            <input type="text" value={newMotData.code} onChange={e => setNewMotData({...newMotData, code: e.target.value.toUpperCase()})} style={{ width: '100%', padding: '0.4rem' }} />
                        </div>
                        <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
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

            {wipeConfirmOpen && (
                <div style={modalOverlayStyle}>
                    <div className="card" style={{ width: '500px', maxWidth: '92vw' }}>
                        <h3 style={{ marginTop: 0, color: '#d9534f' }}>Archive linked data?</h3>
                        <p style={{ fontSize: '0.92rem', lineHeight: 1.45 }}>
                            You are about to delete all data linked to this question. However all the
                            data will be saved in <strong> Old Questions Archive</strong> (in Hystory & Backups sidebar section) where they can still be consulted or downloaded.
                        </p>

                        <div style={{
                            background: '#fff3cd',
                            border: '1px solid #ffe69c',
                            borderRadius: '6px',
                            padding: '0.75rem 1rem',
                            margin: '1rem 0',
                        }}>
                            {wipeStatsLoading && <span>Loading impact preview…</span>}
                            {!wipeStatsLoading && wipeStats && wipeStats.error && (
                                <span style={{ color: '#664d03' }}>
                                    Could not load preview. The action will still execute.
                                </span>
                            )}
                            {!wipeStatsLoading && wipeStats && !wipeStats.error && (
                                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem', color: '#664d03' }}>
                                    <li><strong>{wipeStats.languages}</strong> language{wipeStats.languages === 1 ? '' : 's'} affected</li>
                                    <li><strong>{wipeStats.answers}</strong> answer{wipeStats.answers === 1 ? '' : 's'} will be archived</li>
                                    <li><strong>{wipeStats.examples}</strong> example{wipeStats.examples === 1 ? '' : 's'} will be archived</li>
                                </ul>
                            )}
                        </div>

                        <div style={{
                            background: 'var(--surface-2, #f8fafc)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.7rem 0.9rem',
                            margin: '0 0 1rem 0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.75rem',
                            flexWrap: 'wrap',
                        }}>
                            <span style={{ fontSize: '0.85rem' }}>
                                Prefer to keep the examples? Copy them to another question first.
                            </span>
                            <button
                                type="button"
                                className="btn btn--small"
                                title="Copy only the examples to another question, then come back here"
                                onClick={() => { setWipeConfirmOpen(false); setCopyFromWipe(true); setCopyExamplesOpen(true); }}
                                disabled={isLoading}
                            >
                                Copy examples…
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button
                                type="button"
                                className="btn"
                                onClick={() => setWipeConfirmOpen(false)}
                                disabled={isLoading}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn"
                                onClick={handleConfirmWipe}
                                disabled={isLoading || wipeStatsLoading}
                                style={{ background: '#d9534f', borderColor: '#d9534f', color: 'white' }}
                            >
                                {isLoading ? 'Archiving…' : 'Archive and save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {copyExamplesOpen && (
                <CopyExamplesModal
                    sourceQuestionId={id}
                    onClose={() => {
                        setCopyExamplesOpen(false);
                        if (copyFromWipe) { setCopyFromWipe(false); setWipeConfirmOpen(true); }
                    }}
                    onCopied={() => {
                        setCopyExamplesOpen(false);
                        if (copyFromWipe) { setCopyFromWipe(false); setWipeConfirmOpen(true); }
                    }}
                />
            )}

            {editingMotivationId && (() => {
                const motivation = allMotivations.find(candidate => candidate.id === editingMotivationId);
                const linkedCount = motivation?.linked_questions?.length || 0;
                const linkedOthers = (motivation?.linked_questions || []).filter(questionId => questionId !== id);
                return (
                    <div style={modalOverlayStyle}>
                        <div className="card" style={{ width: '460px', maxWidth: '92vw' }}>
                            <h3 style={{ marginTop: 0 }}>Edit motivation</h3>
                            <div className="alert alert-warning" style={{ marginBottom: 'var(--form-field-mb, 1rem)', fontSize: '0.82rem' }}>
                                <strong>Warning.</strong> Changes to the <em>code</em> or the <em>label</em>
                                are global: they propagate to every answer already given and to every
                                question using it. {linkedCount > 0 && (
                                    <>This motivation is currently linked to <strong>{linkedCount}</strong>{' '}
                                    question{linkedCount === 1 ? '' : 's'}
                                    {linkedOthers.length > 0 && (
                                        <> (besides the current one: {linkedOthers.slice(0, 3).join(', ')}
                                            {linkedOthers.length > 3 ? ` and ${linkedOthers.length - 3} more` : ''})</>
                                    )}.</>
                                )}
                            </div>

                            <div style={{ marginBottom: 'var(--form-field-mb, 1rem)' }}>
                                <label className="small" style={{ fontWeight: 'bold' }}>Code</label>
                                <input
                                    type="text"
                                    value={editMotData.code}
                                    onChange={e => setEditMotData({ ...editMotData, code: e.target.value.toUpperCase() })}
                                    disabled={motSaving || motDeleting}
                                    style={{ width: '100%', padding: '0.4rem' }}
                                />
                            </div>
                            <div style={{ marginBottom: '1.2rem' }}>
                                <label className="small" style={{ fontWeight: 'bold' }}>Description (Label)</label>
                                <textarea
                                    rows="3"
                                    value={editMotData.label}
                                    onChange={e => setEditMotData({ ...editMotData, label: e.target.value })}
                                    disabled={motSaving || motDeleting}
                                    style={{ width: '100%', padding: '0.4rem' }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button
                                    type="button"
                                    className="btn btn--danger"
                                    style={{ color: 'red', borderColor: 'red' }}
                                    onClick={deleteCurrentMotivation}
                                    disabled={motSaving || motDeleting}
                                    title={linkedCount > 1
                                        ? `Blocked if used by other questions (${linkedCount} links)`
                                        : 'Globally delete this motivation'}
                                >
                                    {motDeleting ? 'Deleting...' : 'Delete globally'}
                                </button>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        type="button"
                                        className="btn"
                                        onClick={closeMotivationEditor}
                                        disabled={motSaving || motDeleting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn--primary"
                                        onClick={saveEditedMotivation}
                                        disabled={motSaving || motDeleting || !editMotData.code.trim() || !editMotData.label.trim()}
                                    >
                                        {motSaving ? 'Saving...' : 'Save changes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

const importBoxStyle = {
    background: 'var(--surface-2, #f8fafc)',
    padding: '0.85rem 1rem',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
};
const importTitleStyle = {
    fontSize: '0.8rem',
    fontWeight: 900,
    color: 'var(--text)',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)',
    display: 'block',
    paddingBottom: '0.25rem',
};
const importDescStyle = { fontSize: '0.72rem', lineHeight: 1.35 };

const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
};