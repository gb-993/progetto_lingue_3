import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import cytoscape from 'cytoscape';
import { Search, RotateCcw, Workflow, Maximize2 } from 'lucide-react';
import api from '../../api';
import usePersistentState from '../../utils/usePersistentState';

const VALUE_COLORS = {
    '+': { bg: '#1B5E20', border: '#0B3D13', text: '#ffffff' },
    '-': { bg: '#B71C1C', border: '#7F0000', text: '#ffffff' },
    '0': { bg: '#0D47A1', border: '#002171', text: '#ffffff' },
    '?': { bg: '#616161', border: '#373737', text: '#ffffff' },
    'unset': { bg: '#FAFAFA', border: '#BDBDBD', text: '#000000' },
};

const CHAIN_COLORS = {
    focus: '#FFD600', // nodo cliccato
    up: '#4CAF50',    // antecedenti (incoming)
    down: '#FF9800',  // conseguenti (outgoing)
};

const INITIAL_FILTERS = { schema: '', param_type: '', level: '' };

const CY_STYLE = [
    {
        selector: 'node',
        style: {
            'background-color': VALUE_COLORS.unset.bg,
            'border-color': VALUE_COLORS.unset.border,
            'color': VALUE_COLORS.unset.text,
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
    { selector: 'node.val-plus',  style: { 'background-color': VALUE_COLORS['+'].bg, 'border-color': VALUE_COLORS['+'].border, 'color': VALUE_COLORS['+'].text } },
    { selector: 'node.val-minus', style: { 'background-color': VALUE_COLORS['-'].bg, 'border-color': VALUE_COLORS['-'].border, 'color': VALUE_COLORS['-'].text } },
    { selector: 'node.val-zero',  style: { 'background-color': VALUE_COLORS['0'].bg, 'border-color': VALUE_COLORS['0'].border, 'color': VALUE_COLORS['0'].text } },
    { selector: 'node.val-question', style: { 'background-color': VALUE_COLORS['?'].bg, 'border-color': VALUE_COLORS['?'].border, 'color': VALUE_COLORS['?'].text } },
    { selector: 'node.val-unset', style: { 'background-color': VALUE_COLORS.unset.bg, 'border-color': VALUE_COLORS.unset.border, 'color': VALUE_COLORS.unset.text } },

    { selector: 'node.focus', style: { 'border-color': CHAIN_COLORS.focus, 'border-width': 5 } },
    { selector: 'node.up',    style: { 'border-color': CHAIN_COLORS.up,    'border-width': 4 } },
    { selector: 'node.down',  style: { 'border-color': CHAIN_COLORS.down,  'border-width': 4 } },

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
            // il segno si vede solo sulla catena selezionata
            'font-size': 11,
            'font-weight': 'bold',
            'color': '#000000',
            'text-background-color': '#ffffff',
            'text-background-opacity': 0.95,
            'text-background-padding': 3,
            'text-rotation': 'autorotate',
        },
    },

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
    { selector: 'edge.unsatisfied', style: { 'line-style': 'dashed', 'opacity': 0.55 } },

    { selector: 'edge.dimmed', style: { 'opacity': 0.12 } },
    { selector: 'edge.hidden', style: { 'display': 'none' } },
];

const ACTIVE_LAYOUT = {
    name: 'breadthfirst',
    directed: true,
    spacingFactor: 1.2,
    padding: 20,
    fit: true,
};

export default function ParameterGraph() {
    const navigate = useNavigate();

    const [graph, setGraph] = useState(null);
    const [includeInactive, setIncludeInactive] = usePersistentState('graph:includeInactive', false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [langOptions, setLangOptions] = useState([]);
    const [selectedLang, setSelectedLang] = usePersistentState('graph:selectedLang', '');
    const [langValues, setLangValues] = useState(null);

    const [options, setOptions] = useState({ schemas: [], types: [], levels: [] });
    const [filters, setFilters] = usePersistentState('graph:filters', INITIAL_FILTERS);
    const [search, setSearch] = usePersistentState('graph:search', '');

    const [selectedId, setSelectedId] = useState(null);
    const [conditionTree, setConditionTree] = useState(null);

    const containerRef = useRef(null);
    const cyRef = useRef(null);
    const finalValuesRef = useRef({});

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
        api.get('/api/tablea/options').then(res => {
            setOptions({
                schemas: res.data.opt_schemas || [],
                types:   res.data.opt_types || [],
                levels:  res.data.opt_levels || [],
            });
            setLangOptions((res.data.opt_all_languages || []).slice());
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedLang) {
            setLangValues(null);
            finalValuesRef.current = {};
            return;
        }
        api.get('/api/admin/parameters/graph/lang-values', {
            params: { lang: selectedLang, include_inactive: includeInactive },
        })
            .then(res => {
                setLangValues(res.data);
                const finalById = {};
                (res.data.nodes || []).forEach(node => { finalById[node.id] = node.final; });
                finalValuesRef.current = finalById;
            })
            .catch(() => { setLangValues(null); finalValuesRef.current = {}; });
    }, [selectedLang, includeInactive]);

    useEffect(() => {
        if (!selectedId) { setConditionTree(null); return; }
        const params = selectedLang ? { lang: selectedLang } : {};
        api.get(`/api/admin/parameters/graph/condition-tree/${selectedId}`, { params })
            .then(res => setConditionTree(res.data))
            .catch(() => setConditionTree(null));
    }, [selectedId, selectedLang]);

    useEffect(() => {
        if (!graph || !containerRef.current) return;

        const elements = [
            ...graph.nodes.map(node => ({
                data: { id: node.id, label: node.label, name: node.name, schema: node.schema, ptype: node.param_type, level: node.level_of_comparison },
                classes: node.is_active ? '' : 'is-inactive',
            })),
            ...graph.edges.map(edge => ({
                data: {
                    id: edge.id,
                    source: edge.source,
                    target: edge.target,
                    sign: edge.sign,
                    negated: !!edge.negated,
                    displaySign: `${edge.negated ? 'NOT ' : ''}${edge.sign}`,
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

        const resizeObserver = new ResizeObserver(() => cy.resize());
        resizeObserver.observe(containerRef.current);

        cyRef.current = cy;
        return () => { resizeObserver.disconnect(); cy.destroy(); cyRef.current = null; };
    }, [graph, navigate]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.batch(() => {
            cy.nodes().removeClass('val-plus val-minus val-zero val-question val-unset');

            if (!langValues) return;

            const finalById = {};
            (langValues.nodes || []).forEach(node => { finalById[node.id] = node.final; });

            cy.nodes().forEach(node => {
                const value = finalById[node.id()];
                if (value === '+') node.addClass('val-plus');
                else if (value === '-') node.addClass('val-minus');
                else if (value === '0') node.addClass('val-zero');
                else if (value === '?') node.addClass('val-question');
                else node.addClass('val-unset');
            });
        });
    }, [langValues, graph]);

    const edgeSatisfiedById = useMemo(() => {
        const satisfiedById = {};
        if (!langValues) return satisfiedById;
        (langValues.edges || []).forEach(edge => {
            const edgeId = `${edge.source}__${edge.negated ? 'n' : ''}${edge.sign}__${edge.target}`;
            satisfiedById[edgeId] = edge.satisfied;
        });
        return satisfiedById;
    }, [langValues]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        cy.batch(() => {
            cy.elements().removeClass('focus up down dimmed chain-incoming chain-outgoing unsatisfied');
            if (!selectedId) return;

            const node = cy.getElementById(selectedId);
            if (!node || node.empty()) return;

            const up = node.incomers('node');
            const down = node.outgoers('node');
            const incoming = node.incomers('edge');
            const outgoing = node.outgoers('edge');
            const chainNodes = up.union(down).union(node);
            const chainEdges = incoming.union(outgoing);

            node.addClass('focus');
            up.addClass('up');
            down.addClass('down');
            incoming.addClass('chain-incoming');
            outgoing.addClass('chain-outgoing');

            if (langValues) {
                chainEdges.forEach(edge => {
                    if (edgeSatisfiedById[edge.id()] === false) edge.addClass('unsatisfied');
                });
            }

            cy.nodes().not(chainNodes).addClass('dimmed');
            cy.edges().not(chainEdges).addClass('dimmed');
        });
    }, [selectedId, langValues, graph, edgeSatisfiedById]);

    useEffect(() => {
        const cy = cyRef.current;
        if (!cy) return;

        const query = search.trim().toLowerCase();
        const matches = (data) => {
            if (filters.schema && data.schema !== filters.schema) return false;
            if (filters.param_type && data.ptype !== filters.param_type) return false;
            if (filters.level && data.level !== filters.level) return false;
            return true;
        };

        cy.batch(() => {
            cy.nodes().removeClass('hidden');
            cy.edges().removeClass('hidden');

            cy.nodes().forEach(node => {
                if (!matches(node.data())) node.addClass('hidden');
            });
            cy.edges().forEach(edge => {
                if (edge.source().hasClass('hidden') || edge.target().hasClass('hidden')) {
                    edge.addClass('hidden');
                }
            });
        });

        if (query) {
            const hit = cy.nodes().filter(node =>
                !node.hasClass('hidden') && (
                    node.id().toLowerCase().includes(query) ||
                    (node.data('name') || '').toLowerCase().includes(query)
                )
            ).first();
            if (hit && hit.nonempty()) {
                cy.animate({ center: { eles: hit }, duration: 250 });
            }
        }
    }, [filters, search]);

    const chain = useMemo(() => {
        if (!selectedId || !cyRef.current) return null;
        const node = cyRef.current.getElementById(selectedId);
        if (!node || node.empty()) return null;
        const up = node.incomers('node').map(neighbor => ({ id: neighbor.id(), label: neighbor.data('label') })).sort((a, b) => a.id.localeCompare(b.id));
        const down = node.outgoers('node').map(neighbor => ({ id: neighbor.id(), label: neighbor.data('label') })).sort((a, b) => a.id.localeCompare(b.id));
        return { id: node.id(), label: node.data('label'), up, down };
    }, [selectedId, graph]);

    const finalValueOf = (id) => finalValuesRef.current[id] || null;

    const jumpTo = useCallback((id) => {
        const cy = cyRef.current;
        if (!cy) return;
        const node = cy.getElementById(id);
        if (!node || node.empty()) return;
        cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2), duration: 300 });
        setSelectedId(id);
    }, []);

    const reload = () => {
        fetchGraph();
        if (selectedLang) {
            api.get('/api/admin/parameters/graph/lang-values', {
                params: { lang: selectedLang, include_inactive: includeInactive },
            }).then(res => {
                setLangValues(res.data);
                const finalById = {};
                (res.data.nodes || []).forEach(node => { finalById[node.id] = node.final; });
                finalValuesRef.current = finalById;
            }).catch(() => {});
        }
    };

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

            <div className="card" style={{ padding: '0.6rem 0.8rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Language
                        <select value={selectedLang} onChange={e => setSelectedLang(e.target.value)} style={{ minWidth: 160 }}>
                            <option value="">— none —</option>
                            {langOptions.map(lang => (
                                <option key={lang.id} value={lang.id}>{lang.id} — {lang.name}</option>
                            ))}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Schema
                        <select value={filters.schema} onChange={e => setFilters(prev => ({ ...prev, schema: e.target.value }))}>
                            <option value="">All</option>
                            {options.schemas.map(schema => <option key={schema} value={schema}>{schema}</option>)}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Type
                        <select value={filters.param_type} onChange={e => setFilters(prev => ({ ...prev, param_type: e.target.value }))}>
                            <option value="">All</option>
                            {options.types.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        Level
                        <select value={filters.level} onChange={e => setFilters(prev => ({ ...prev, level: e.target.value }))}>
                            <option value="">All</option>
                            {options.levels.map(level => <option key={level} value={level}>{level}</option>)}
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

                    <Legend hasLang={!!selectedLang} />
                </div>

                <SidePanel
                    chain={chain}
                    finalValueOf={finalValueOf}
                    onJump={jumpTo}
                    conditionTree={conditionTree}
                    selectedLang={selectedLang}
                    langValues={langValues}
                />
            </div>
        </div>
    );
}

// fuori da Legend per non ricrearli a ogni render
const Item = ({ swatch, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.72rem' }}>
        {swatch}
        <span>{label}</span>
    </div>
);
const colorBox = (color, border) => (
    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: color, border: `1px solid ${border || color}` }} />
);
const lineBox = (color, dashed) => (
    <span style={{ display: 'inline-block', width: 22, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
);

function Legend({ hasLang }) {
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
                    <Item swatch={colorBox(VALUE_COLORS['+'].bg)} label="+" />
                    <Item swatch={colorBox(VALUE_COLORS['-'].bg)} label="−" />
                    <Item swatch={colorBox(VALUE_COLORS['0'].bg)} label="0" />
                    <Item swatch={colorBox(VALUE_COLORS.unset.bg, VALUE_COLORS.unset.border)} label="unset" />
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

function SidePanel({ chain, finalValueOf, onJump, conditionTree, selectedLang, langValues }) {
    const finalForSelected = chain && langValues
        ? (langValues.nodes || []).find(node => node.id === chain.id)
        : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minHeight: 0 }}>
            <div className="card" style={{ padding: 'var(--form-box-pad, 0.7rem 0.9rem)' }}>
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
                        <ChainList title="Antecedents" subtitle="(this depends on)" items={chain.up} finalValueOf={finalValueOf} onJump={onJump} hasLang={!!selectedLang} />
                        <ChainList title="Consequents" subtitle="(depend on this)" items={chain.down} finalValueOf={finalValueOf} onJump={onJump} hasLang={!!selectedLang} />
                    </div>
                )}
            </div>

            <div className="card" style={{ padding: 'var(--form-box-pad, 0.7rem 0.9rem)', flex: 1, overflow: 'auto' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Implicational condition</h4>
                <ConditionTreeView data={conditionTree} />
            </div>
        </div>
    );
}

function ChainList({ title, subtitle, items, finalValueOf, onJump, hasLang }) {
    return (
        <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <strong>{title}</strong> {subtitle}
            </div>
            {items.length === 0 ? (
                <p className="muted small" style={{ margin: '0.2rem 0' }}>—</p>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {items.map(item => {
                        const finalValue = hasLang ? finalValueOf(item.id) : null;
                        return (
                            <li key={item.id} style={{ marginTop: '0.15rem' }}>
                                <button
                                    type="button"
                                    onClick={() => onJump(item.id)}
                                    title={item.label}
                                    style={{
                                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                        color: 'var(--brand)', textAlign: 'left', font: 'inherit', fontSize: '0.8rem',
                                    }}
                                >
                                    {item.id}{finalValue && finalValue !== 'unset' ? ` (${finalValue === 'unset' ? '—' : finalValue})` : ''}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

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
    const isSatisfied = node.result === true;
    return (
        <li style={{ marginBottom: '0.2rem' }}>
            <div style={{
                display: 'flex', gap: '0.4rem', alignItems: 'baseline',
                paddingLeft: `${depth * 0.9}rem`, fontSize: '0.8rem',
            }}>
                {evaluated && (
                    <span style={{ color: isSatisfied ? 'var(--ok)' : 'var(--bad)', fontWeight: 700, minWidth: '0.9rem' }}>
                        {isSatisfied ? '✓' : '✗'}
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
                    {node.children.map((child, index) => (
                        <TreeNode key={index} node={child} evaluated={evaluated} depth={depth + 1} />
                    ))}
                </ul>
            )}
        </li>
    );
}

