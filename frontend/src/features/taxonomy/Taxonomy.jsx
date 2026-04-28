import { useEffect, useMemo, useState } from 'react';
import api from '../../api';

// ============================================================================
// Pagina /admin/taxonomy
// 3 colonne: Top-Family | Family | Group
// + sezione "Unnormalized" (stringhe usate sulle Language ma non in tabella)
// ============================================================================

const COL_HEADER = 'Indo-European, Niger-Congo, ...';

export default function Taxonomy() {
    const [tree, setTree] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [selectedTopId, setSelectedTopId] = useState(null);    // null = "Unassigned" view
    const [selectedFamilyId, setSelectedFamilyId] = useState(null);

    const [modal, setModal] = useState(null); // { kind: 'top'|'family'|'group', mode: 'new'|'edit', entity? }

    const fetchTree = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/admin/taxonomy/tree');
            setTree(res.data);
            setError('');
        } catch (err) {
            setError(err.response?.data?.detail || 'Could not load taxonomy.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTree(); }, []);

    // --- ricava le liste filtrate ---
    const allTops = tree?.top_families || [];
    const orphanFamilies = tree?.orphan_families || [];
    const orphanGroups = tree?.orphan_groups || [];
    const unnormalized = tree?.unnormalized || { top_families: [], families: [], groups: [] };

    const familiesOfSelectedTop = useMemo(() => {
        if (selectedTopId === null) return orphanFamilies;
        const tf = allTops.find(t => t.id === selectedTopId);
        return tf ? tf.families : [];
    }, [selectedTopId, allTops, orphanFamilies]);

    const groupsOfSelectedFamily = useMemo(() => {
        if (selectedFamilyId === null) return orphanGroups;
        const fam =
            familiesOfSelectedTop.find(f => f.id === selectedFamilyId) ||
            allTops.flatMap(t => t.families).find(f => f.id === selectedFamilyId);
        return fam ? fam.groups : [];
    }, [selectedFamilyId, familiesOfSelectedTop, allTops, orphanGroups]);

    // se la family selezionata sparisce dopo refresh / cambio top, deselezionala
    useEffect(() => {
        if (selectedFamilyId !== null && !familiesOfSelectedTop.find(f => f.id === selectedFamilyId)) {
            setSelectedFamilyId(null);
        }
    }, [selectedFamilyId, familiesOfSelectedTop]);

    // --- handlers ---
    const handleDelete = async (kind, id, label) => {
        const what = kind === 'top' ? 'top-family' : kind === 'family' ? 'family' : 'group';
        if (!window.confirm(`Delete ${what} "${label}"? Operation will be blocked if it still has children or is referenced by languages.`)) return;
        const path = kind === 'top' ? `top-families/${id}` : kind === 'family' ? `families/${id}` : `groups/${id}`;
        try {
            await api.delete(`/api/admin/taxonomy/${path}`);
            if (kind === 'top' && selectedTopId === id) setSelectedTopId(null);
            if (kind === 'family' && selectedFamilyId === id) setSelectedFamilyId(null);
            fetchTree();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error during deletion');
        }
    };

    const handleMoveFamily = async (familyId, newTopId) => {
        try {
            await api.patch(`/api/admin/taxonomy/families/${familyId}`, {
                set_top_family: true,
                top_family_id: newTopId,
            });
            fetchTree();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error');
        }
    };

    const handleMoveGroup = async (groupId, newFamilyId) => {
        try {
            await api.patch(`/api/admin/taxonomy/groups/${groupId}`, {
                set_family: true,
                family_id: newFamilyId,
            });
            fetchTree();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error');
        }
    };

    const handlePromote = async (kind, name, parentId = null) => {
        const path = kind === 'top' ? 'top-family' : kind;
        try {
            await api.post(`/api/admin/taxonomy/promote/${path}`, { name, parent_id: parentId });
            fetchTree();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error');
        }
    };

    // ---------- DRAG & DROP ----------
    // I drag trasportano { kind: 'top'|'family'|'group', id }.
    // Drop su una row di livello superiore = "move under that parent".
    // Drop su una row dello stesso livello/colonna = "insert before" (riordino).

    const handleDropMoveFamilyUnderTop = (familyId, topId) => {
        if (!familyId) return;
        handleMoveFamily(familyId, topId);
    };

    const handleDropMoveGroupUnderFamily = (groupId, familyId) => {
        if (!groupId) return;
        handleMoveGroup(groupId, familyId);
    };

    const reorder = async (kind, draggedId, targetId, list) => {
        // riordina list: rimuovi draggedId e inseriscilo prima di targetId
        if (draggedId === targetId) return;
        const ids = list.map(x => x.id).filter(x => x !== draggedId);
        const targetIdx = ids.indexOf(targetId);
        const insertAt = targetIdx === -1 ? ids.length : targetIdx;
        ids.splice(insertAt, 0, draggedId);
        const path = kind === 'top' ? 'top-families' : kind === 'family' ? 'families' : 'groups';
        try {
            await api.post(`/api/admin/taxonomy/reorder/${path}`, { ids });
            fetchTree();
        } catch (err) {
            alert(err.response?.data?.detail || 'Error');
        }
    };

    if (loading) return <div className="container">Loading...</div>;
    if (error) return <div className="container alert alert-error">{error}</div>;

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Taxonomy</h1>
                <p className="muted dashboard-copy">
                    Manage the hierarchy <strong>Top-Family → Family → Group</strong>. Click an item to drill down.
                    Drag rows to reorder within a column, or drop a Family onto a Top-Family (or a Group onto a Family) to reassign its parent.
                    Renaming an entity propagates the new label to all languages that referenced it.
                </p>
            </header>

            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '1rem',
                alignItems: 'start',
                marginBottom: '1.5rem',
            }}>
                {/* COLONNA 1 — TOP FAMILIES */}
                <Column
                    title="Top-Families"
                    hint={COL_HEADER}
                    onAdd={() => setModal({ kind: 'top', mode: 'new' })}
                    items={allTops}
                    renderItem={(tf) => (
                        <Row
                            key={tf.id}
                            active={selectedTopId === tf.id}
                            onClick={() => { setSelectedTopId(tf.id); setSelectedFamilyId(null); }}
                            label={tf.name}
                            badge={`${tf.families.length} sub · ${tf.language_count} lang`}
                            onEdit={() => setModal({ kind: 'top', mode: 'edit', entity: tf })}
                            onDelete={() => handleDelete('top', tf.id, tf.name)}
                            // Drag & drop: questa riga è draggable (riordino top) e droppable (riordino top + accept family)
                            dragKind="top"
                            dragId={tf.id}
                            onDropPayload={(payload) => {
                                if (payload.kind === 'top') {
                                    reorder('top', payload.id, tf.id, allTops);
                                } else if (payload.kind === 'family') {
                                    handleDropMoveFamilyUnderTop(payload.id, tf.id);
                                }
                            }}
                            acceptKinds={['top', 'family']}
                        />
                    )}
                    footer={
                        <Row
                            active={selectedTopId === null}
                            onClick={() => { setSelectedTopId(null); setSelectedFamilyId(null); }}
                            label={<em>Unassigned families</em>}
                            badge={`${orphanFamilies.length}`}
                            muted
                            // Drop su questa riga = scollega family/group dal parent
                            onDropPayload={(payload) => {
                                if (payload.kind === 'family') handleDropMoveFamilyUnderTop(payload.id, null);
                            }}
                            acceptKinds={['family']}
                        />
                    }
                />

                {/* COLONNA 2 — FAMILIES */}
                <Column
                    title={selectedTopId === null
                        ? 'Unassigned Families'
                        : `Families of "${allTops.find(t => t.id === selectedTopId)?.name || ''}"`}
                    hint="Romance, Celtic, ..."
                    onAdd={() => setModal({
                        kind: 'family', mode: 'new',
                        defaultTop: selectedTopId,
                    })}
                    items={familiesOfSelectedTop}
                    emptyText={selectedTopId === null
                        ? 'No unassigned families.'
                        : 'No families under this top-family yet.'}
                    renderItem={(f) => (
                        <Row
                            key={f.id}
                            active={selectedFamilyId === f.id}
                            onClick={() => setSelectedFamilyId(f.id)}
                            label={f.name}
                            badge={`${f.groups.length} grp · ${f.language_count} lang`}
                            onEdit={() => setModal({ kind: 'family', mode: 'edit', entity: f })}
                            onDelete={() => handleDelete('family', f.id, f.name)}
                            extra={
                                <MoveSelect
                                    value={f.top_family_id ?? ''}
                                    options={[
                                        { value: '', label: '— Unassigned —' },
                                        ...allTops.map(t => ({ value: t.id, label: t.name })),
                                    ]}
                                    onChange={(v) => handleMoveFamily(f.id, v === '' ? null : Number(v))}
                                />
                            }
                            dragKind="family"
                            dragId={f.id}
                            onDropPayload={(payload) => {
                                if (payload.kind === 'family') {
                                    reorder('family', payload.id, f.id, familiesOfSelectedTop);
                                } else if (payload.kind === 'group') {
                                    handleDropMoveGroupUnderFamily(payload.id, f.id);
                                }
                            }}
                            acceptKinds={['family', 'group']}
                        />
                    )}
                />

                {/* COLONNA 3 — GROUPS */}
                <Column
                    title={selectedFamilyId === null
                        ? 'Unassigned Groups'
                        : `Groups of "${
                            allTops.flatMap(t => t.families).find(f => f.id === selectedFamilyId)?.name
                            || orphanFamilies.find(f => f.id === selectedFamilyId)?.name
                            || ''
                        }"`}
                    hint="Italian, Spanish, ..."
                    onAdd={() => setModal({
                        kind: 'group', mode: 'new',
                        defaultFamily: selectedFamilyId,
                    })}
                    items={groupsOfSelectedFamily}
                    emptyText={selectedFamilyId === null
                        ? 'No unassigned groups.'
                        : 'No groups under this family yet.'}
                    renderItem={(g) => (
                        <Row
                            key={g.id}
                            label={g.name}
                            badge={`${g.language_count} lang`}
                            onEdit={() => setModal({ kind: 'group', mode: 'edit', entity: g })}
                            onDelete={() => handleDelete('group', g.id, g.name)}
                            extra={
                                <MoveSelect
                                    value={g.family_id ?? ''}
                                    options={[
                                        { value: '', label: '— Unassigned —' },
                                        ...allTops.flatMap(t =>
                                            t.families.map(f => ({ value: f.id, label: `${t.name} · ${f.name}` }))
                                        ),
                                        ...orphanFamilies.map(f => ({ value: f.id, label: `(no top) · ${f.name}` })),
                                    ]}
                                    onChange={(v) => handleMoveGroup(g.id, v === '' ? null : Number(v))}
                                />
                            }
                            dragKind="group"
                            dragId={g.id}
                            onDropPayload={(payload) => {
                                if (payload.kind === 'group') {
                                    reorder('group', payload.id, g.id, groupsOfSelectedFamily);
                                }
                            }}
                            acceptKinds={['group']}
                        />
                    )}
                />
            </div>

            {/* SEZIONE STRINGHE NON NORMALIZZATE */}
            <UnnormalizedSection
                data={unnormalized}
                allTops={allTops}
                allFamilies={[
                    ...allTops.flatMap(t => t.families),
                    ...orphanFamilies,
                ]}
                onPromote={handlePromote}
            />

            {/* MODALE EDIT/NEW */}
            {modal && (
                <EntityModal
                    modal={modal}
                    allTops={allTops}
                    allFamilies={[...allTops.flatMap(t => t.families), ...orphanFamilies]}
                    onClose={() => setModal(null)}
                    onSaved={() => { setModal(null); fetchTree(); }}
                />
            )}
        </div>
    );
}

// ============================================================================
// Subcomponents
// ============================================================================
function Column({ title, hint, onAdd, items, renderItem, footer, emptyText }) {
    return (
        <div className="card" style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h3>
                    <div className="muted small" style={{ fontSize: '0.7rem' }}>{hint}</div>
                </div>
                <button className="btn btn--small btn--primary" onClick={onAdd} title="Add">+ New</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minHeight: '60px' }}>
                {(!items || items.length === 0) ? (
                    <p className="muted small" style={{ margin: 0, padding: '0.5rem 0.25rem' }}>
                        {emptyText || 'Nothing here.'}
                    </p>
                ) : (
                    items.map(renderItem)
                )}
            </div>
            {footer && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.4rem', marginTop: '0.4rem' }}>
                    {footer}
                </div>
            )}
        </div>
    );
}

function Row({ label, badge, onClick, onEdit, onDelete, active, extra, muted, dragKind, dragId, onDropPayload, acceptKinds }) {
    const [isDragOver, setIsDragOver] = useState(false);

    const draggable = !!dragKind && dragId !== undefined;
    const dropTarget = !!onDropPayload;

    const handleDragStart = (e) => {
        if (!draggable) return;
        e.dataTransfer.setData('application/x-taxonomy', JSON.stringify({ kind: dragKind, id: dragId }));
        e.dataTransfer.effectAllowed = 'move';
        // distintivo visivo durante il drag
        try { e.currentTarget.style.opacity = '0.4'; } catch { /* noop */ }
    };
    const handleDragEnd = (e) => {
        try { e.currentTarget.style.opacity = '1'; } catch { /* noop */ }
        setIsDragOver(false);
    };
    const handleDragOver = (e) => {
        if (!dropTarget) return;
        // accetta solo se compatibile
        const types = e.dataTransfer.types;
        if (types && Array.from(types).includes('application/x-taxonomy')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
        }
    };
    const handleDragLeave = () => setIsDragOver(false);
    const handleDrop = (e) => {
        if (!dropTarget) return;
        e.preventDefault();
        setIsDragOver(false);
        try {
            const payload = JSON.parse(e.dataTransfer.getData('application/x-taxonomy'));
            if (acceptKinds && !acceptKinds.includes(payload.kind)) return;
            if (payload.id === dragId && payload.kind === dragKind) return; // drop su se stessa
            onDropPayload(payload);
        } catch { /* noop */ }
    };

    return (
        <div
            onClick={onClick}
            draggable={draggable}
            onDragStart={draggable ? handleDragStart : undefined}
            onDragEnd={draggable ? handleDragEnd : undefined}
            onDragOver={dropTarget ? handleDragOver : undefined}
            onDragLeave={dropTarget ? handleDragLeave : undefined}
            onDrop={dropTarget ? handleDrop : undefined}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                padding: '0.4rem 0.5rem',
                border: isDragOver
                    ? '2px dashed #3b82f6'
                    : active ? '1px solid var(--brand)' : '1px solid var(--border)',
                background: isDragOver
                    ? 'rgba(59,130,246,0.15)'
                    : active ? 'rgba(59,130,246,0.08)' : 'transparent',
                borderRadius: '5px',
                cursor: onClick ? (draggable ? 'grab' : 'pointer') : (draggable ? 'grab' : 'default'),
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: muted ? 'var(--text-muted)' : 'inherit' }}>
                    {draggable && <span style={{ color: 'var(--text-muted)', marginRight: '0.3rem', userSelect: 'none' }}>⋮⋮</span>}
                    {label}
                </span>
                <span className="muted" style={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{badge}</span>
            </div>
            {(onEdit || onDelete || extra) && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
                    {extra}
                    {onEdit && <button className="btn btn--small" onClick={onEdit} style={{ fontSize: '0.72rem' }}>Edit</button>}
                    {onDelete && <button className="btn btn--small btn--danger" onClick={onDelete} style={{ fontSize: '0.72rem', color: 'red' }}>Delete</button>}
                </div>
            )}
        </div>
    );
}

function MoveSelect({ value, options, onChange }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ fontSize: '0.72rem', padding: '0.15rem 0.3rem', flex: 1, minWidth: 0 }}
            title="Move under..."
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

// ----------------------------------------------------------------------------
function UnnormalizedSection({ data, allTops, allFamilies, onPromote }) {
    const totalUnnorm =
        data.top_families.length + data.families.length + data.groups.length;

    if (totalUnnorm === 0) {
        return (
            <div className="card" style={{ padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <strong style={{ color: '#15803d' }}>All language strings are normalized.</strong>{' '}
                <span className="muted small">Every Top-Family / Family / Group used on languages exists as an entity above.</span>
            </div>
        );
    }

    return (
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
            <h3 style={{ margin: '0 0 0.4rem 0', fontSize: '1rem' }}>To assign ({totalUnnorm})</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
                These names appear as plain text on existing languages but no taxonomy entity matches them yet. Promote them to create the entity (you can choose the parent on the spot).
            </p>

            <UnnormGroup
                title="Top-Families"
                rows={data.top_families}
                renderActions={(row) => (
                    <button
                        className="btn btn--small btn--primary"
                        onClick={() => onPromote('top', row.name)}
                    >
                        Promote → top-family
                    </button>
                )}
            />

            <UnnormGroup
                title="Families"
                rows={data.families}
                renderActions={(row) => (
                    <PromoteWithParent
                        label="Promote → family under"
                        options={[
                            { value: '', label: '— Unassigned —' },
                            ...allTops.map(t => ({ value: t.id, label: t.name })),
                        ]}
                        onPromote={(parentId) => onPromote('family', row.name, parentId)}
                    />
                )}
            />

            <UnnormGroup
                title="Groups"
                rows={data.groups}
                renderActions={(row) => (
                    <PromoteWithParent
                        label="Promote → group under"
                        options={[
                            { value: '', label: '— Unassigned —' },
                            ...allFamilies.map(f => ({ value: f.id, label: f.name })),
                        ]}
                        onPromote={(parentId) => onPromote('group', row.name, parentId)}
                    />
                )}
            />
        </div>
    );
}

function UnnormGroup({ title, rows, renderActions }) {
    if (!rows || rows.length === 0) return null;
    return (
        <div style={{ marginTop: '0.6rem' }}>
            <div className="admin-label" style={{ marginBottom: '0.25rem' }}>{title} ({rows.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.4rem' }}>
                {rows.map(r => (
                    <div key={r.name} style={{
                        border: '1px dashed var(--border)', borderRadius: '5px',
                        padding: '0.4rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem',
                        background: '#fffbeb',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.name}</span>
                            <span className="muted" style={{ fontSize: '0.7rem' }}>{r.language_count} lang</span>
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                            {renderActions(r)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PromoteWithParent({ label, options, onPromote }) {
    const [val, setVal] = useState('');
    return (
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <select
                value={val}
                onChange={(e) => setVal(e.target.value)}
                style={{ flex: 1, fontSize: '0.72rem', padding: '0.15rem 0.3rem', minWidth: 0 }}
            >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
                className="btn btn--small btn--primary"
                style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                onClick={() => onPromote(val === '' ? null : Number(val))}
                title={label}
            >
                Promote
            </button>
        </div>
    );
}

// ----------------------------------------------------------------------------
function EntityModal({ modal, allTops, allFamilies, onClose, onSaved }) {
    const isEdit = modal.mode === 'edit';
    const e = modal.entity;

    const [name, setName] = useState(isEdit ? e.name : '');
    const [parentId, setParentId] = useState(() => {
        if (isEdit) {
            if (modal.kind === 'family') return e.top_family_id ?? '';
            if (modal.kind === 'group') return e.family_id ?? '';
        } else {
            if (modal.kind === 'family') return modal.defaultTop ?? '';
            if (modal.kind === 'group') return modal.defaultFamily ?? '';
        }
        return '';
    });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    const title = isEdit
        ? `Edit ${modal.kind === 'top' ? 'top-family' : modal.kind}`
        : `New ${modal.kind === 'top' ? 'top-family' : modal.kind}`;

    const hasParent = modal.kind !== 'top';
    const parentOptions = modal.kind === 'family'
        ? [{ value: '', label: '— Unassigned —' }, ...allTops.map(t => ({ value: t.id, label: t.name }))]
        : modal.kind === 'group'
            ? [{ value: '', label: '— Unassigned —' }, ...allFamilies.map(f => ({ value: f.id, label: f.name }))]
            : [];

    const handleSave = async (ev) => {
        ev.preventDefault();
        setSaving(true);
        setErr('');
        try {
            const path = modal.kind === 'top' ? 'top-families' : modal.kind === 'family' ? 'families' : 'groups';
            if (isEdit) {
                const body = { name: name.trim() };
                if (modal.kind === 'family') {
                    body.set_top_family = true;
                    body.top_family_id = parentId === '' ? null : Number(parentId);
                } else if (modal.kind === 'group') {
                    body.set_family = true;
                    body.family_id = parentId === '' ? null : Number(parentId);
                }
                await api.patch(`/api/admin/taxonomy/${path}/${e.id}`, body);
            } else {
                const body = { name: name.trim() };
                if (modal.kind === 'family') body.top_family_id = parentId === '' ? null : Number(parentId);
                if (modal.kind === 'group') body.family_id = parentId === '' ? null : Number(parentId);
                await api.post(`/api/admin/taxonomy/${path}`, body);
            }
            onSaved();
        } catch (e2) {
            setErr(e2.response?.data?.detail || 'Error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={modalOverlayStyle}>
            <div className="card" style={{ width: '420px' }}>
                <h3 style={{ marginTop: 0 }}>{title}</h3>
                <form onSubmit={handleSave}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>Name</label>
                        <input
                            type="text"
                            autoFocus
                            value={name}
                            onChange={(ev) => setName(ev.target.value)}
                            required
                            style={{ width: '100%', padding: '0.5rem' }}
                        />
                    </div>

                    {hasParent && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '0.3rem' }}>
                                {modal.kind === 'family' ? 'Top-Family' : 'Family'}
                            </label>
                            <select
                                value={parentId}
                                onChange={(ev) => setParentId(ev.target.value)}
                                style={{ width: '100%', padding: '0.5rem' }}
                            >
                                {parentOptions.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {err && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{err}</div>}

                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
                        <button type="submit" className="btn btn--primary" disabled={saving}>
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const modalOverlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', justifyContent: 'center', alignItems: 'center',
};
