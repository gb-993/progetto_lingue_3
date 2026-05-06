import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape from 'cytoscape';
import { Search, RotateCcw, Workflow, Maximize2 } from 'lucide-react';
import api from '../../api';

// --- Palette dei valori finali (post-DAG). Coerente col vecchio progetto:
// + verde, - rosso, 0 blu, ? grigio scuro, unset bianco. -----------------
const VAL_COLORS = {
    '+': { bg: '#1B5E20', border: '#0B3D13', text: '#ffffff' },
    '-': { bg: '#B71C1C', border: '#7F0000', text: '#ffffff' },
    '0': { bg: '#0D47A1', border: '#002171', text: '#ffffff' },
    '?': { bg: '#616161', border: '#373737', text: '#ffffff' },
    'unset': { bg: '#FAFAFA', border: '#BDBDBD', text: '#000000' },
};

const CHAIN_COLORS = {
    focus: '#FFD600',  // bordo giallo: nodo cliccato
    up: '#4CAF50',     // verde: antecedenti (incoming) -- bordo nodo + linea edge
    down: '#FF9800',   // arancione: conseguenti (outgoing) -- bordo nodo + linea edge
};

const INITIAL_FILTERS = { schema: '', param_type: '', level: '' };

// Stile cytoscape: definito una volta, non dipende dallo stato React.
const CY_STYLE = [
    {
        selector: 'node',
        style: {
            'background-color': VAL_COLORS.unset.bg,
            'border-color': VAL_COLORS.unset.border,
            'color': VAL_COLORS.unset.text,
            'label': 'data(label)',
            'font-size': 14,
            'font-weight': 'bold',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': 'label',
            'height': 'label',
            'padding': '8px',
            'shape': 'round-rectangle',
            'border-width': 1,
        },
    },
    { selector: 'node.val-plus',  style: { 'background-color': VAL_COLORS['+'].bg, 'border-color': VAL_COLORS['+'].border, 'color': VAL_COLORS['+'].text } },
    { selector: 'node.val-minus', style: { 'background-color': VAL_COLORS['-'].bg, 'border-color': VAL_COLORS['-'].border, 'color': VAL_COLORS['-'].text } },
    { selector: 'node.val-zero',  style: { 'background-color': VAL_COLORS['0'].bg, 'border-color': VAL_COLORS['0'].border, 'color': VAL_COLORS['0'].text } },
    { selector: 'node.val-question', style: { 'background-color': VAL_COLORS['?'].bg, 'border-color': VAL_COLORS['?'].border, 'color': VAL_COLORS['?'].text } },
    { selector: 'node.val-unset', style: { 'background-color': VAL_COLORS.unset.bg, 'border-color': VAL_COLORS.unset.border, 'color': VAL_COLORS.unset.text } },

    // Bordo della catena: si sovrascrive al border-color dei valori, ma si
    // distingue grazie a uno spessore maggiore.
    { selector: 'node.focus', style: { 'border-color': CHAIN_COLORS.focus, 'border-width': 5 } },
    { selector: 'node.up',    style: { 'border-color': CHAIN_COLORS.up,    'border-width': 4 } },
    { selector: 'node.down',  style: { 'border-color': CHAIN_COLORS.down,  'border-width': 4 } },

    // Inattivi: tratteggio fisso del bordo.
    { selector: 'node.is-inactive', style: { 'border-style': 'dashed', 'opacity': 0.6 } },

    { selector: 'node.dimmed', style: { 'opacity': 0.18 } },
    { selector: 'node.hidden', style: { 'display': 'none' } },

    {
        selector: 'edge',
        style: {
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'width': 1.2,
            'line-color': '#90A4AE',
            'target-arrow-color': '#90A4AE',
            // niente label di default: il segno appare solo sulla catena
            // del nodo cliccato (vedi chain-incoming/chain-outgoing).
            'font-size': 11,
            'font-weight': 'bold',
            'color': '#000000',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.95,
            'text-background-padding': 3,
            'text-rotation': 'autorotate',
        },
    },

    // Edge della catena del nodo cliccato. displaySign include 'NOT ' se la
    // foglia e' negata (es. 'NOT +' per `not +FGM`).
    {
        selector: 'edge.chain-incoming',
        style: {
            'line-color': CHAIN_COLORS.up,
            'target-arrow-color': CHAIN_COLORS.up,
            'width': 3,
            'label': 'data(displaySign)',
        },
    },
    {
        selector: 'edge.chain-outgoing',
        style: {
            'line-color': CHAIN_COLORS.down,
            'target-arrow-color': CHAIN_COLORS.down,
            'width': 3,
            'label': 'data(displaySign)',
        },
    },
    // In modalita' lingua, gli edge della catena non soddisfatti vengono
    // tratteggiati e attenuati per distinguerli a colpo d'occhio.
    { selector: 'edge.unsatisfied', style: { 'line-style': 'dashed', 'opacity': 0.55 } },

    { selector: 'edge.dimmed', style: { 'opacity': 0.12 } },
    { selector: 'edge.hidden', style: { 'display': 'none' } },
];

// breadthfirst del cytoscape nativo produce un layout a livelli (TB) molto
// piu' compatto e leggibile di dagre per questo grafo: i parametri senza
// condizione finiscono al rank 0 in alto, i loro dipendenti sotto, e cosi'
// via. spacingFactor 1.2 + fit: true riproduce esattamente il layout del
// vecchio progetto Django.
const ACTIVE_LAYOUT = {
    name: 'breadthfirst',
    directed: true,
    spacingFactor: 1.2,
    padding: 20,
    fit: true,
};

// =============================================================================
// COMPONENTE
// =============================================================================
export default function ParameterGraph() {
    const navigate = useNavigate();

    const [graph, setGraph] = useState(null);                  // {nodes, edges}
    const [includeInactive, setIncludeInactive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [langOptions, setLangOptions] = useState([]);
    const [selectedLang, setSelectedLang] = useState('');
    const [langValues, setLangValues] = useState(null);        // {language, nodes:[{id,final,...}], edges:[{source,target,sign,satisfied}]}

    const [options, setOptions] = useState({ schemas: [], types: [], levels: [] });
    const [filters, setFilters] = useState(INITIAL_FILTERS);
    const [search, setSearch] = useState('');

    const [selectedId, setSelectedId] = useState(null);
    const [conditionTree, setConditionTree] = useState(null); // {expression, tree, evaluated, error}

    const containerRef = useRef(null);
    const cyRef = useRef(null);
    // Mappa parameter_id -> 'final' value (per la vista lingua, anche fuori
    // dal cytoscape — lo usa il recap per mostrare "(P12 +)" accanto agli ID).
    const valuesMapRef = useRef({});

    // -----------------------------------------------------------------
    // FETCH iniziali
    // -----------------------------------------------------------------
    const fetchGraph = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const res = await api.get('/api/admin/parameters/graph', {
                params: { include_inactive: includeInactive },
            });
            setGraph(res.data);
        } catch (e) {
            setError(e.response?.data?.detail || 'Error loading graph');
        } finally {
            setLoading(false);
        }
    }, [includeInactive]);

    useEffect(() => { fetchGraph(); }, [fetchGraph]);

    useEffect(() => {
        api.get('/api/tablea/options').then(r => {
            setOptions({
                schemas: r.data.opt_schemas || [],
                types:   r.data.opt_types || [],
                levels:  r.data.opt_levels || [],
            });
            setLangOptions((r.data.opt_all_languages || []).slice());
        }).catch(() => {});
    }, []);

    // -----------------------------------------------------------------
    // FETCH valori per lingua
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!selectedLang) {
            setLangValues(null);
            valuesMapRef.current = {};
            return;
        }
        api.get('/api/admin/parameters/graph/lang-values', {
            params: { lang: selectedLang, include_inactive: includeInactive },
        })
            .then(r => {
                setLangValues(r.data);
                const map = {};
                (r.data.nodes || []).forEach(n => { map[n.id] = n.final; });
                valuesMapRef.current = map;
            })
            .catch(() => { setLangValues(null); valuesMapRef.current = {}; });
    }, [selectedLang, includeInactive]);

    // -----------------------------------------------------------------
    // FETCH albero condizione del nodo selezionato
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!selectedId) { setConditionTree(null); return; }
        const params = selectedLang ? { lang: selectedLang } : {};
        api.get(`/api/admin/parameters/graph/condition-tree/${selectedId}`, { params })
            .then(r => setConditionTree(r.data))
            .catch(() => setConditionTree(null));
    }, [selectedId, selectedLang]);

    // -----------------------------------------------------------------
    // INIT / UPDATE cytoscape quando arriva un nuovo grafo
    // -----------------------------------------------------------------
    useEffect(() => {
        if (!graph || !containerRef.current) return;

        const elements = [
            ...graph.nodes.map(n => ({
                data: { id: n.id, label: n.label, name: n.name, schema: n.schema, ptype: n.param_type, level: n.level_of_comparison },
                classes: n.is_active ? '' : 'is-inactive',
            })),
            ...graph.edges.map(e => ({
                data: {
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    sign: e.sign,
                    negated: !!e.negated,
                    displaySign: `${e.negated ? 'NOT ' : ''}${e.sign}`,
                },
            })),
        ];

        if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }

        const cy = cytoscape({
            container: containerRef.current,
            elements,
            style: CY_STYLE,
            wheelSensitivity: 0.2,
            layout: ACTIVE_LAYOUT,
        });

        cy.on('tap', 'node', evt => setSelectedId(evt.target.id()));
        cy.on('dbltap', 'node', evt => navigate(`/admin/parameters/${evt.target.id()}/edit`));
        cy.on('tap', evt => { if (evt.target === cy) setSelectedId(null); });

        const ro = new ResizeObserver(() => cy.resize());
        ro.observe(containerRef.current);

        cyRef.current = cy;
        return () => { ro.disconnect(); cy.destroy(); cyRef.current = null; };
    }, [graph, navigate]);

    // -----------------------------------------------------------------
    // APPLY classi valore + soddisfacibilita' edge in modalita' lingua
    // -----------------------------------------------------------------
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.batch(() => {
            cy.nodes().removeClass('val-plus val-minus val-zero val-question val-unset');

            if (!langValues) return;

            const finalById = {};
            (langValues.nodes || []).forEach(n => { finalById[n.id] = n.final; });

            cy.nodes().forEach(n => {
                const v = finalById[n.id()];
                if (v === '+') n.addClass('val-plus');
                else if (v === '-') n.addClass('val-minus');
                else if (v === '0') n.addClass('val-zero');
                else if (v === '?') n.addClass('val-question');
                else n.addClass('val-unset');
            });
        });
    }, [langValues, graph]);

    // Mappa edge_id -> satisfied calcolata dal backend, usata sotto per
    // tratteggiare in modalita' lingua i soli edge della catena.
    const edgeSatMap = useMemo(() => {
        const m = {};
        if (!langValues) return m;
        (langValues.edges || []).forEach(e => {
            const eid = `${e.source}__${e.negated ? 'n' : ''}${e.sign}__${e.target}`;
            m[eid] = e.satisfied;
        });
        return m;
    }, [langValues]);

    // -----------------------------------------------------------------
    // APPLY catena (focus / up / down / dimmed) al click su un nodo
    // -----------------------------------------------------------------
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.batch(() => {
            cy.elements().removeClass('focus up down dimmed chain-incoming chain-outgoing unsatisfied');
            if (!selectedId) return;

            const node = cy.getElementById(selectedId);
            if (!node || node.empty()) return;

            const up = node.incomers('node');           // antecedenti (chi punta a noi)
            const down = node.outgoers('node');         // conseguenti (chi e' puntato da noi)
            const incoming = node.incomers('edge');     // archi entranti
            const outgoing = node.outgoers('edge');     // archi uscenti
            const chainNodes = up.union(down).union(node);
            const chainEdges = incoming.union(outgoing);

            node.addClass('focus');
            up.addClass('up');
            down.addClass('down');
            incoming.addClass('chain-incoming');
            outgoing.addClass('chain-outgoing');

            // Dash sugli edge della catena la cui foglia non e' soddisfatta
            // (solo se siamo in modalita' lingua).
            if (langValues) {
                chainEdges.forEach(e => {
                    if (edgeSatMap[e.id()] === false) e.addClass('unsatisfied');
                });
            }

            cy.nodes().not(chainNodes).addClass('dimmed');
            cy.edges().not(chainEdges).addClass('dimmed');
        });
    }, [selectedId, langValues, graph, edgeSatMap]);

    // -----------------------------------------------------------------
    // APPLY visibility (filtri schema/type/level + include_inactive +
    // search dims). Search non nasconde, smorza solo.
    // -----------------------------------------------------------------
    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        const q = search.trim().toLowerCase();
        const matches = (data) => {
            if (filters.schema && data.schema !== filters.schema) return false;
            if (filters.param_type && data.ptype !== filters.param_type) return false;
            if (filters.level && data.level !== filters.level) return false;
            return true;
        };

        cy.batch(() => {
            cy.nodes().removeClass('hidden');
            cy.edges().removeClass('hidden');

            cy.nodes().forEach(n => {
                if (!matches(n.data())) n.addClass('hidden');
            });
            // Nascondiamo gli edge che toccano nodi nascosti.
            cy.edges().forEach(e => {
                if (e.source().hasClass('hidden') || e.target().hasClass('hidden')) {
                    e.addClass('hidden');
                }
            });
        });

        if (q) {
            // Trova il primo match per centrare la viewport.
            const hit = cy.nodes().filter(n =>
                !n.hasClass('hidden') && (
                    n.id().toLowerCase().includes(q) ||
                    (n.data('name') || '').toLowerCase().includes(q)
                )
            ).first();
            if (hit && hit.nonempty()) {
                cy.animate({ center: { eles: hit }, duration: 250 });
            }
        }
    }, [filters, search]);

    // -----------------------------------------------------------------
    // Helpers per il pannello recap
    // -----------------------------------------------------------------
    const chain = useMemo(() => {
        if (!selectedId || !cyRef.current) return null;
        const n = cyRef.current.getElementById(selectedId);
        if (!n || n.empty()) return null;
        const up = n.incomers('node').map(x => ({ id: x.id(), label: x.data('label') })).sort((a, b) => a.id.localeCompare(b.id));
        const down = n.outgoers('node').map(x => ({ id: x.id(), label: x.data('label') })).sort((a, b) => a.id.localeCompare(b.id));
        return { id: n.id(), label: n.data('label'), up, down };
    }, [selectedId, graph]);

    const symFor = (id) => valuesMapRef.current[id] || null;

    const jumpTo = useCallback((id) => {
        const cy = cyRef.current;
        if (!cy) return;
        const n = cy.getElementById(id);
        if (!n || n.empty()) return;
        cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.2), duration: 300 });
        setSelectedId(id);
    }, []);

    const reload = () => {
        fetchGraph();
        if (selectedLang) {
            api.get('/api/admin/parameters/graph/lang-values', {
                params: { lang: selectedLang, include_inactive: includeInactive },
            }).then(r => {
                setLangValues(r.data);
                const map = {};
                (r.data.nodes || []).forEach(n => { map[n.id] = n.final; });
                valuesMapRef.current = map;
            }).catch(() => {});
        }
    };

    // -----------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 'calc(100vh - 8rem)' }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Workflow size={22} />
                <h2 style={{ margin: 0 }}>Parameters Graph</h2>
                <span className="muted small" style={{ marginLeft: '0.5rem' }}>
                    Implicational dependencies between parameters. Click a node to inspect its chain;
                    double-click to open it for editing.
                </span>
            </header>

            {/* Toolbar */}
            <div className="card" style={{ padding: '0.6rem 0.8rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Language
                        <select value={selectedLang} onChange={e => setSelectedLang(e.target.value)} style={{ minWidth: 160 }}>
                            <option value="">— none —</option>
                            {langOptions.map(l => (
                                <option key={l.id} value={l.id}>{l.id} — {l.name}</option>
                            ))}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Schema
                        <select value={filters.schema} onChange={e => setFilters(f => ({ ...f, schema: e.target.value }))}>
                            <option value="">All</option>
                            {options.schemas.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Type
                        <select value={filters.param_type} onChange={e => setFilters(f => ({ ...f, param_type: e.target.value }))}>
                            <option value="">All</option>
                            {options.types.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Level
                        <select value={filters.level} onChange={e => setFilters(f => ({ ...f, level: e.target.value }))}>
                            <option value="">All</option>
                            {options.levels.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
                        Show inactive
                    </label>

                    <div style={{ flex: 1 }} />

                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search ID or name..."
                            style={{ paddingLeft: 28, minWidth: 220 }}
                        />
                    </div>

                    <button
                        type="button"
                        className="btn"
                        onClick={() => { const cy = cyRef.current; if (cy) cy.animate({ fit: { eles: cy.elements(), padding: 30 }, duration: 350 }); }}
                        title="Fit all nodes in view"
                    >
                        <Maximize2 size={14} /> Fit all
                    </button>
                    <button type="button" className="btn" onClick={reload} title="Reload">
                        <RotateCcw size={14} /> Reload
                    </button>
                </div>
            </div>

            {/* Main grid: graph + side panel */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '0.75rem', flex: 1, minHeight: 500 }}>
                <div className="card" style={{ position: 'relative', minHeight: 500, padding: 0, overflow: 'hidden' }}>
                    {loading && (
                        <div className="muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                            Loading graph...
                        </div>
                    )}
                    {error && (
                        <div className="alert alert-error" style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2 }}>
                            {error}
                        </div>
                    )}
                    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 500 }} />

                    {/* Legend overlay */}
                    <Legend hasLang={!!selectedLang} />
                </div>

                <SidePanel
                    chain={chain}
                    symFor={symFor}
                    onJump={jumpTo}
                    conditionTree={conditionTree}
                    selectedLang={selectedLang}
                    langValues={langValues}
                />
            </div>
        </div>
    );
}

// =============================================================================
// LEGEND (overlay nell'angolo)
// =============================================================================
function Legend({ hasLang }) {
    const Item = ({ swatch, label }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem' }}>
            {swatch}
            <span>{label}</span>
        </div>
    );
    const colorBox = (c, border) => (
        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: c, border: `1px solid ${border || c}` }} />
    );
    const lineBox = (c, dashed) => (
        <span style={{ display: 'inline-block', width: 22, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${c}` }} />
    );
    return (
        <div style={{
            position: 'absolute', bottom: 10, right: 10, padding: '0.5rem 0.7rem',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 6, display: 'flex', flexDirection: 'column', gap: '0.2rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)', zIndex: 1,
        }}>
            {hasLang && (
                <>
                    <strong style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>VALUE</strong>
                    <Item swatch={colorBox(VAL_COLORS['+'].bg)} label="+" />
                    <Item swatch={colorBox(VAL_COLORS['-'].bg)} label="−" />
                    <Item swatch={colorBox(VAL_COLORS['0'].bg)} label="0" />
                    <Item swatch={colorBox(VAL_COLORS.unset.bg, VAL_COLORS.unset.border)} label="unset" />
                </>
            )}
            <strong style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: hasLang ? 4 : 0 }}>CHAIN (on click)</strong>
            <Item swatch={colorBox('transparent', CHAIN_COLORS.focus)} label="selected" />
            <Item swatch={lineBox(CHAIN_COLORS.up)} label="antecedent" />
            <Item swatch={lineBox(CHAIN_COLORS.down)} label="consequent" />
            {hasLang && <Item swatch={lineBox('#90A4AE', true)} label="not satisfied" />}
        </div>
    );
}

// =============================================================================
// SIDE PANEL: recap catena + albero condizione
// =============================================================================
function SidePanel({ chain, symFor, onJump, conditionTree, selectedLang, langValues }) {
    const finalForSelected = chain && langValues
        ? (langValues.nodes || []).find(n => n.id === chain.id)
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
            <div className="card" style={{ padding: '0.7rem 0.9rem' }}>
                <h4 style={{ margin: '0 0 0.4rem', fontSize: '0.85rem' }}>
                    {chain ? `Selected: ${chain.label}` : 'No node selected'}
                </h4>
                {!chain && <p className="muted small" style={{ margin: 0 }}>Click a node in the graph to see its dependency chain.</p>}
                {chain && finalForSelected && (
                    <div style={{ marginBottom: '0.4rem', fontSize: '0.78rem' }}>
                        <span className="muted">Final value: </span>
                        <strong>{finalForSelected.final === 'unset' ? '—' : finalForSelected.final}</strong>
                        {finalForSelected.condition_satisfied != null && (
                            <span style={{ marginLeft: '0.6rem', color: finalForSelected.condition_satisfied ? 'var(--ok)' : 'var(--bad)' }}>
                                condition {finalForSelected.condition_satisfied ? 'satisfied' : 'not satisfied'}
                            </span>
                        )}
                    </div>
                )}
                {chain && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                        <ChainList title="Antecedents" subtitle="(this depends on)" items={chain.up} symFor={symFor} onJump={onJump} hasLang={!!selectedLang} />
                        <ChainList title="Consequents" subtitle="(depend on this)" items={chain.down} symFor={symFor} onJump={onJump} hasLang={!!selectedLang} />
                    </div>
                )}
            </div>

            <div className="card" style={{ padding: '0.7rem 0.9rem', flex: 1, overflow: 'auto' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Implicational condition</h4>
                <ConditionTreeView data={conditionTree} />
            </div>
        </div>
    );
}

function ChainList({ title, subtitle, items, symFor, onJump, hasLang }) {
    return (
        <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <strong>{title}</strong> {subtitle}
            </div>
            {items.length === 0 ? (
                <p className="muted small" style={{ margin: '0.2rem 0' }}>—</p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {items.map(it => {
                        const sym = hasLang ? symFor(it.id) : null;
                        return (
                            <li key={it.id} style={{ marginTop: '0.15rem' }}>
                                <button
                                    type="button"
                                    onClick={() => onJump(it.id)}
                                    title={it.label}
                                    style={{
                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                        color: 'var(--brand)', textAlign: 'left', font: 'inherit', fontSize: '0.8rem',
                                    }}
                                >
                                    {it.id}{sym && sym !== 'unset' ? ` (${sym === 'unset' ? '—' : sym})` : ''}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// -----------------------------------------------------------------------------
// Albero della implicational condition con check/cross.
// -----------------------------------------------------------------------------
function ConditionTreeView({ data }) {
    if (!data) return <p className="muted small" style={{ margin: 0 }}>—</p>;
    if (!data.expression) return <p className="muted small" style={{ margin: 0 }}>This parameter has no implicational condition.</p>;
    if (!data.tree) {
        return (
            <div>
                <code style={{ fontSize: '0.75rem' }}>{data.expression}</code>
                <p className="muted small" style={{ margin: '0.3rem 0 0' }}>{data.error || 'Cannot parse'}</p>
            </div>
        );
    }
    return (
        <div>
            <code style={{ fontSize: '0.75rem', display: 'block', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                {data.expression}
            </code>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <TreeNode node={data.tree} evaluated={data.evaluated} />
            </ul>
        </div>
    );
}

function TreeNode({ node, evaluated, depth = 0 }) {
    const isLeaf = node.type === 'LEAF';
    const ok = node.result === true;
    return (
        <li style={{ marginBottom: '0.2rem' }}>
            <div style={{
                display: 'flex', gap: '0.4rem', alignItems: 'baseline',
                paddingLeft: `${depth * 0.9}rem`, fontSize: '0.8rem',
            }}>
                {evaluated && (
                    <span style={{ color: ok ? 'var(--ok)' : 'var(--bad)', fontWeight: 700, minWidth: '0.9rem' }}>
                        {ok ? '✓' : '✗'}
                    </span>
                )}
                <span style={{ fontWeight: isLeaf ? 600 : 700, color: isLeaf ? 'inherit' : 'var(--text-muted)' }}>
                    {node.label}
                </span>
                {evaluated && isLeaf && (
                    <span className="muted" style={{ fontSize: '0.7rem' }}>
                        current: {node.actual_value && node.actual_value !== 'None' ? node.actual_value : '—'}
                    </span>
                )}
            </div>
            {node.children?.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {node.children.map((c, i) => (
                        <TreeNode key={i} node={c} evaluated={evaluated} depth={depth + 1} />
                    ))}
                </ul>
            )}
        </li>
    );
}

