import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api';
import ParameterBlock from '../compilation/ParameterBlock';
import useUnsavedChangesGuard from '../../utils/useUnsavedChangesGuard';
import usePersistentState from '../../utils/usePersistentState';
import { searchMatches } from '../../utils/search';
import { readExampleClipboard, clearExampleClipboard } from '../../utils/exampleClipboard';

// Vista "inversa" della pagina di compilazione: un parametro, e il wizard a
// quadratini di Language Data — ma dentro ci sono gli id delle LINGUE invece dei
// parametri. Clic su un quadratino → si aprono le question di QUESTO parametro
// per QUELLA lingua, nello stesso ParameterBlock della compilazione (riuso
// totale: stesso salvataggio, validazione, concorrenza, DAG). Scorciatoia admin
// per ritoccare lo stesso parametro in molte/tutte le lingue senza entrare
// lingua per lingua. L'admin edita a prescindere dallo status, che non cambia.

const STATUS_LABELS = {
    pending: 'Pending',
    waiting_for_approval: 'Waiting',
    approved: 'Approved',
    rejected: 'Rejected',
};

const INITIAL_FILTERS = {
    top_family: '',
    family: '',
    status: '',
    completion: '',  // '' | 'empty' | 'partial' | 'complete' | 'unsure'
};

export default function ParameterByLanguage() {
    const { id: paramId } = useParams();

    const [meta, setMeta] = useState(null);
    const [languages, setLanguages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = usePersistentState('paramByLang:search', '');
    const [filters, setFilters] = usePersistentState('paramByLang:filters', INITIAL_FILTERS);

    // Lingua (quadratino) selezionata + blocco caricato pigramente.
    const [selectedId, setSelectedId] = useState(null);
    const [block, setBlock] = useState(null);
    const [blockLoading, setBlockLoading] = useState(false);
    const [blockError, setBlockError] = useState('');

    // Dirty sollevato dal ParameterBlock: nota admin + dati di compilazione.
    const [adminNoteDirty, setAdminNoteDirty] = useState(false);
    const [blockDirty, setBlockDirty] = useState(false);
    const anyDirty = adminNoteDirty || blockDirty;

    useUnsavedChangesGuard(
        anyDirty,
        'You have unsaved changes for this language. If you leave now they will be lost. Continue?'
    );

    const fetchSummary = async () => {
        const res = await api.get(`/api/admin/parameters/${paramId}/by-language`);
        setMeta(res.data.parameter);
        setLanguages(res.data.languages || []);
        return res.data;
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                await fetchSummary();
                if (!cancelled) setError('');
            } catch (err) {
                console.error(err);
                if (!cancelled) setError('Could not load the parameter data.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paramId]);

    const total = meta?.total_questions ?? 0;

    // Colore del quadratino: stessa logica del wizard di Language Data.
    //  - is-complete (verde): tutte le question risposte yes/no
    //  - is-incomplete (rosso): flag unsure oppure parzialmente risposto
    //  - is-empty (grigio): nessuna risposta
    const squareState = (l) => {
        if (l.is_unsure || (l.answered > 0 && l.answered < total)) return 'is-incomplete';
        if (total > 0 && l.answered >= total) return 'is-complete';
        return 'is-empty';
    };

    // Tassonomia per il filtro "Data" (più fine del colore del quadratino).
    const completionOf = (l) => {
        if (l.with_response === 0) return 'empty';
        if (total > 0 && l.answered >= total) return 'complete';
        return 'partial';
    };

    // Opzioni famiglia derivate dalle lingue caricate; family ristretta dalla
    // top-family scelta (cascata leggera, single-select).
    const topFamilyOptions = useMemo(
        () => [...new Set(languages.map(l => l.top_level_family).filter(Boolean))].sort(),
        [languages]
    );
    const familyOptions = useMemo(() => {
        const src = filters.top_family
            ? languages.filter(l => l.top_level_family === filters.top_family)
            : languages;
        return [...new Set(src.map(l => l.family).filter(Boolean))].sort();
    }, [languages, filters.top_family]);

    const handleFilter = (e) => {
        const { name, value } = e.target;
        setFilters(prev => {
            const next = { ...prev, [name]: value };
            // Cambiando top_family invalido la family non più pertinente.
            if (name === 'top_family' && value && prev.family) {
                const stillValid = languages.some(
                    l => l.top_level_family === value && l.family === prev.family
                );
                if (!stillValid) next.family = '';
            }
            return next;
        });
    };

    const resetAll = () => {
        setFilters(INITIAL_FILTERS);
        setSearch('');
    };

    const filteredLanguages = useMemo(() => {
        return languages.filter(l => {
            if (filters.top_family && l.top_level_family !== filters.top_family) return false;
            if (filters.family && l.family !== filters.family) return false;
            if (filters.status && l.status !== filters.status) return false;
            if (filters.completion) {
                if (filters.completion === 'unsure') {
                    if (!l.is_unsure) return false;
                } else if (completionOf(l) !== filters.completion) {
                    return false;
                }
            }
            return searchMatches(l, search, ['id', 'name_full', 'top_level_family', 'family', 'grp']);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [languages, filters, search, total]);

    // Ref alla lista filtrata corrente: serve a handleSaved per avanzare alla
    // lingua successiva senza leggere stato stale dopo il refetch.
    const filteredRef = useRef(filteredLanguages);
    useEffect(() => { filteredRef.current = filteredLanguages; }, [filteredLanguages]);

    // Come nella pagina di compilazione: svuota il clipboard degli esempi quando
    // la lingua selezionata cambia, così non si incolla un esempio di un'altra lingua.
    useEffect(() => {
        if (!selectedId) return;
        const c = readExampleClipboard();
        if (c && c.langId !== selectedId) clearExampleClipboard();
    }, [selectedId]);

    // Scroll automatico al blocco quando si seleziona una lingua (saltato al mount).
    const blockTopRef = useRef(null);
    const skipScrollRef = useRef(true);
    useEffect(() => {
        if (skipScrollRef.current) { skipScrollRef.current = false; return; }
        if (selectedId && blockTopRef.current) {
            blockTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [selectedId]);

    const activeFilterCount =
        (filters.top_family ? 1 : 0) +
        (filters.family ? 1 : 0) +
        (filters.status ? 1 : 0) +
        (filters.completion ? 1 : 0) +
        (search ? 1 : 0);

    const confirmDiscard = () => {
        if (!anyDirty) return true;
        return window.confirm(
            'You have unsaved changes for this language. Switching will discard them. Continue?'
        );
    };

    const loadBlock = async (langId) => {
        setBlock(null);
        setBlockError('');
        setBlockLoading(true);
        setAdminNoteDirty(false);
        setBlockDirty(false);
        try {
            const res = await api.get(`/api/languages/${langId}/parameters/${paramId}/block`);
            setBlock(res.data);
        } catch (err) {
            console.error(err);
            setBlockError('Could not load this language. Try again.');
        } finally {
            setBlockLoading(false);
        }
    };

    const selectLanguage = (langId) => {
        if (langId === selectedId) return;
        if (!confirmDiscard()) return;
        setSelectedId(langId);
        loadBlock(langId);
    };

    // Dopo un save riuscito: aggiorna i contatori (colore dei quadratini) e
    // avanza alla lingua successiva visibile, come "Confident -> Next" del wizard.
    const handleSaved = async () => {
        const list = filteredRef.current;
        const idx = list.findIndex(l => l.id === selectedId);
        const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
        setAdminNoteDirty(false);
        setBlockDirty(false);
        try {
            await fetchSummary();
        } catch (err) {
            console.error(err);
        }
        if (next) {
            setSelectedId(next.id);
            loadBlock(next.id);
        }
    };

    if (loading) {
        return <div className="container" style={{ marginTop: 'var(--form-page-top, 2rem)' }}>Loading...</div>;
    }
    if (error) {
        return <div className="container alert alert-error" style={{ marginTop: 'var(--form-page-top, 2rem)' }}>{error}</div>;
    }

    const selectedLang = block?.language
        || languages.find(l => l.id === selectedId)
        || null;

    return (
        <div className="container" style={{ paddingBottom: '8rem' }}>
            <header className="dashboard-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ marginBottom: '0.25rem' }}>
                        {meta?.id} — {meta?.name}
                    </h1>
                    {meta?.short_description && (
                        <p className="muted" style={{ margin: 0, maxWidth: '70ch', whiteSpace: 'pre-wrap' }}>
                            {meta.short_description}
                        </p>
                    )}
                    <p className="small muted" style={{ marginTop: '0.4rem' }}>
                        One parameter across every language · {total} active question{total === 1 ? '' : 's'}
                        {!meta?.is_active && <span> · <span className="status bad">parameter disabled</span></span>}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Link to={`/admin/parameters/${paramId}/edit`} className="btn btn--small">Edit definition</Link>
                    <Link to="/admin/parameters" className="btn btn--small">← Parameters</Link>
                </div>
            </header>

            {/* ==== FILTRI ==== */}
            <div className="card" style={{
                padding: 'var(--filter-card-pad, 1rem 1.25rem)',
                marginBottom: '1rem',
                border: '1px solid var(--border)',
                position: 'sticky',
                top: 'var(--topbar-height)',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--filter-card-gap, 0.75rem)', alignItems: 'end' }}>
                    <FilterField label="Search">
                        <input
                            type="search"
                            placeholder="Language id or name..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Top family">
                        <select name="top_family" value={filters.top_family} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {topFamilyOptions.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Subfamily">
                        <select name="family" value={filters.family} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {familyOptions.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Status">
                        <select name="status" value={filters.status} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            <option value="pending">Pending</option>
                            <option value="waiting_for_approval">Waiting</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </FilterField>
                    <FilterField label="Data">
                        <select name="completion" value={filters.completion} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            <option value="empty">Empty</option>
                            <option value="partial">Partial</option>
                            <option value="complete">Complete</option>
                            <option value="unsure">Flagged unsure</option>
                        </select>
                    </FilterField>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--filter-card-actions-top, 0.85rem)', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div className="small muted">
                        {filteredLanguages.length} of {languages.length} languages
                        {activeFilterCount > 0 && <span> · {activeFilterCount} active filters</span>}
                    </div>
                    <button onClick={resetAll} className="btn btn--small">Reset</button>
                </div>
            </div>

            {/* Promemoria: l'admin edita a prescindere dallo status, senza cambiarlo. */}
            <div className="admin-override-banner" style={{ marginBottom: '1rem' }}>
                <strong>Admin shortcut:</strong> editing a language here saves it immediately, exactly
                like opening its page — the language status is never changed automatically.
            </div>

            {/* ==== WIZARD A QUADRATINI (un quadratino = una lingua) ==== */}
            {filteredLanguages.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
                    No language matches the current filters.
                </div>
            ) : (
                <div className="param-nav param-nav--wide">
                    {filteredLanguages.map((l) => (
                        <button
                            key={l.id}
                            type="button"
                            onClick={() => selectLanguage(l.id)}
                            className={`param-btn ${squareState(l)}${l.id === selectedId ? ' is-active' : ''}`}
                            title={`${l.name_full} · ${STATUS_LABELS[l.status] || l.status}${l.is_unsure ? ' · flagged unsure' : ` · ${l.answered}/${total} answered`}`}
                        >
                            {l.id}
                        </button>
                    ))}
                </div>
            )}

            {/* ==== BLOCCO DELLA LINGUA SELEZIONATA ==== */}
            <div ref={blockTopRef} style={{ scrollMarginTop: '1rem' }}>
                {!selectedId && filteredLanguages.length > 0 && (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        Select a language above to view and edit this parameter for it.
                    </div>
                )}

                {selectedId && (
                    <>
                        {selectedLang && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                                <h3 style={{ margin: 0 }}>
                                    {selectedLang.id} <span className="muted" style={{ fontWeight: 400 }}>— {selectedLang.name_full}</span>
                                </h3>
                                <Link to={`/languages/${selectedLang.id}/data`} className="btn btn--small" title="Open the full compilation page of this language">
                                    Open full language ↗
                                </Link>
                            </div>
                        )}
                        {blockLoading && <div className="card muted" style={{ padding: '1.5rem' }}>Loading block…</div>}
                        {blockError && <div className="alert alert-error">{blockError}</div>}
                        {!blockLoading && !blockError && block && (
                            <ParameterBlock
                                key={`${selectedId}-${block.parameter.id}`}
                                parameter={block.parameter}
                                langId={selectedId}
                                isReadOnly={false}
                                isAdmin={true}
                                onAdminNoteDirtyChange={setAdminNoteDirty}
                                onBlockDirtyChange={setBlockDirty}
                                onSaved={handleSaved}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// ===== Helper UI =====
const inputStyle = { width: '100%', padding: 'var(--filter-card-input-pad, 0.45rem)', fontSize: '0.85rem' };

function FilterField({ label, children }) {
    return (
        <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {label}
            </label>
            {children}
        </div>
    );
}
