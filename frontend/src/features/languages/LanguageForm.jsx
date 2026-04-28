import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api';

export default function LanguageForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEditMode = Boolean(id);

    const [formData, setFormData] = useState({
        id: '', name_full: '', position: 0,
        // Stringhe (mantenute per compat con filtri/export)
        family: '', top_level_family: '', grp: '',
        // FK alla tassonomia
        top_family_id: '', family_id: '', group_id: '',
        latitude: '', longitude: '',
        historical_language: false, assigned_user_id: '',
        isocode: '', glottocode: '', informant: '', supervisor: '',
        source: '', location: ''
    });

    const [users, setUsers] = useState([]);
    const [taxonomy, setTaxonomy] = useState({ top_families: [], orphan_families: [], orphan_groups: [] });
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [usersRes, taxRes] = await Promise.all([
                    api.get('/api/admin/accounts'),
                    api.get('/api/admin/taxonomy/tree'),
                ]);
                setUsers(usersRes.data.filter(u => u.role === 'user'));
                setTaxonomy(taxRes.data);

                if (isEditMode) {
                    const langRes = await api.get(`/api/admin/languages/${id}`);
                    setFormData({
                        ...langRes.data,
                        latitude: langRes.data.latitude ?? '',
                        longitude: langRes.data.longitude ?? '',
                        assigned_user_id: langRes.data.assigned_user_id ?? '',
                        top_family_id: langRes.data.top_family_id ?? '',
                        family_id: langRes.data.family_id ?? '',
                        group_id: langRes.data.group_id ?? '',
                    });
                }
            } catch (err) {
                setError('Could not load the data.');
            }
        };
        fetchData();
    }, [id, isEditMode]);

    // Liste flat per lookup veloci
    const allFamilies = useMemo(() => [
        ...taxonomy.top_families.flatMap(t => t.families.map(f => ({ ...f, _topName: t.name }))),
        ...taxonomy.orphan_families.map(f => ({ ...f, _topName: null })),
    ], [taxonomy]);

    const allGroups = useMemo(() => [
        ...taxonomy.top_families.flatMap(t =>
            t.families.flatMap(f => f.groups.map(g => ({ ...g, _famName: f.name, _topName: t.name, _famTopId: t.id })))
        ),
        ...taxonomy.orphan_families.flatMap(f =>
            f.groups.map(g => ({ ...g, _famName: f.name, _topName: null, _famTopId: null }))
        ),
        ...(taxonomy.orphan_groups || []).map(g => ({ ...g, _famName: null, _topName: null, _famTopId: null })),
    ], [taxonomy]);

    // Filtri dinamici per i dropdown
    const familiesForSelect = useMemo(() => {
        if (!formData.top_family_id) return allFamilies;
        const tid = Number(formData.top_family_id);
        return allFamilies.filter(f => f.top_family_id === tid);
    }, [formData.top_family_id, allFamilies]);

    const groupsForSelect = useMemo(() => {
        if (!formData.family_id) {
            // se nessuna family scelta ma c'è una top, mostra i group sotto le family di quella top
            if (formData.top_family_id) {
                const tid = Number(formData.top_family_id);
                return allGroups.filter(g => g._famTopId === tid);
            }
            return allGroups;
        }
        const fid = Number(formData.family_id);
        return allGroups.filter(g => g.family_id === fid);
    }, [formData.family_id, formData.top_family_id, allGroups]);

    // ---------- handlers ----------
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // Quando cambia top → se family selezionata non è coerente, azzera family + group
    const handleTopChange = (e) => {
        const newTop = e.target.value;
        const newTopNum = newTop === '' ? null : Number(newTop);
        const currentFam = formData.family_id === '' ? null : Number(formData.family_id);
        const famObj = currentFam !== null ? allFamilies.find(f => f.id === currentFam) : null;
        let nextFam = formData.family_id;
        let nextGrp = formData.group_id;
        if (famObj && famObj.top_family_id !== newTopNum && newTopNum !== null) {
            nextFam = '';
            nextGrp = '';
        }
        setFormData(prev => ({ ...prev, top_family_id: newTop, family_id: nextFam, group_id: nextGrp }));
    };

    // Quando cambia family → auto-imposta il top dal parent. Se il group scelto non è coerente, azzeralo.
    const handleFamilyChange = (e) => {
        const newFam = e.target.value;
        const newFamNum = newFam === '' ? null : Number(newFam);
        const famObj = newFamNum !== null ? allFamilies.find(f => f.id === newFamNum) : null;
        const newTop = famObj ? (famObj.top_family_id ?? '') : formData.top_family_id;
        let nextGrp = formData.group_id;
        const currentGrp = formData.group_id === '' ? null : Number(formData.group_id);
        if (currentGrp !== null) {
            const grpObj = allGroups.find(g => g.id === currentGrp);
            if (grpObj && grpObj.family_id !== newFamNum) nextGrp = '';
        }
        setFormData(prev => ({ ...prev, family_id: newFam, top_family_id: newTop === null ? '' : newTop, group_id: nextGrp }));
    };

    // Quando cambia group → auto-imposta family + top dai parent.
    const handleGroupChange = (e) => {
        const newGrp = e.target.value;
        const newGrpNum = newGrp === '' ? null : Number(newGrp);
        const grpObj = newGrpNum !== null ? allGroups.find(g => g.id === newGrpNum) : null;
        let nextFam = formData.family_id;
        let nextTop = formData.top_family_id;
        if (grpObj) {
            if (grpObj.family_id !== null && grpObj.family_id !== undefined) {
                nextFam = grpObj.family_id;
                const famObj = allFamilies.find(f => f.id === grpObj.family_id);
                if (famObj && famObj.top_family_id !== null) nextTop = famObj.top_family_id;
            }
        }
        setFormData(prev => ({
            ...prev,
            group_id: newGrp,
            family_id: nextFam === null ? '' : nextFam,
            top_family_id: nextTop === null ? '' : nextTop,
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                position: parseInt(formData.position, 10),
                latitude: formData.latitude === '' ? null : parseFloat(formData.latitude),
                longitude: formData.longitude === '' ? null : parseFloat(formData.longitude),
                assigned_user_id: formData.assigned_user_id === '' ? null : parseInt(formData.assigned_user_id, 10),
                top_family_id: formData.top_family_id === '' ? null : Number(formData.top_family_id),
                family_id: formData.family_id === '' ? null : Number(formData.family_id),
                group_id: formData.group_id === '' ? null : Number(formData.group_id),
            };

            if (isEditMode) {
                await api.put(`/api/admin/languages/${id}`, payload);
            } else {
                await api.post('/api/admin/languages', payload);
            }
            navigate('/languages');
        } catch (err) {
            setError(err.response?.data?.detail || 'Error while saving.');
        }
    };

    // Avviso se la lingua ha una stringa che non corrisponde a nessuna entità in tassonomia
    const orphanText = (() => {
        const messages = [];
        if (formData.top_level_family && !formData.top_family_id) {
            const found = taxonomy.top_families.find(t => t.name === formData.top_level_family);
            if (!found) messages.push(`Top-Family "${formData.top_level_family}" is not in the taxonomy yet`);
        }
        if (formData.family && !formData.family_id) {
            const found = allFamilies.find(f => f.name === formData.family);
            if (!found) messages.push(`Family "${formData.family}" is not in the taxonomy yet`);
        }
        if (formData.grp && !formData.group_id) {
            const found = allGroups.find(g => g.name === formData.grp);
            if (!found) messages.push(`Group "${formData.grp}" is not in the taxonomy yet`);
        }
        return messages;
    })();

    return (
        <div className="container" style={{maxWidth: '800px', marginTop: '2rem'}}>
            <div className="card">
                <header style={{marginBottom: '1.5rem'}}>
                    <h2>{isEditMode ? `Edit Language: ${id}` : 'Add New Language'}</h2>
                </header>

                {error && <div className="alert alert-error" style={{marginBottom: '1rem'}}>{error}</div>}

                <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Language ID (e.g. eng)</label>
                            <input type="text" name="id" value={formData.id} onChange={handleChange} required disabled={isEditMode} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Position (order)</label>
                            <input type="number" name="position" value={formData.position} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Full name</label>
                        <input type="text" name="name_full" value={formData.name_full} onChange={handleChange} required style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{
                        border: '1px solid var(--border)', borderRadius: '6px',
                        padding: '0.75rem', background: 'var(--surface-alt, #f8fafc)',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                            <strong style={{ fontSize: '0.9rem' }}>Taxonomy</strong>
                            <Link to="/admin/taxonomy" className="small" style={{ fontSize: '0.78rem' }}>Manage taxonomy →</Link>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                            <div>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Top-Family</label>
                                <select
                                    value={formData.top_family_id}
                                    onChange={handleTopChange}
                                    style={{ width: '100%', padding: '0.45rem' }}
                                >
                                    <option value="">— None —</option>
                                    {taxonomy.top_families.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Family</label>
                                <select
                                    value={formData.family_id}
                                    onChange={handleFamilyChange}
                                    style={{ width: '100%', padding: '0.45rem' }}
                                >
                                    <option value="">— None —</option>
                                    {familiesForSelect.map(f => (
                                        <option key={f.id} value={f.id}>
                                            {f._topName ? `${f.name}` : `${f.name} (no top)`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem' }}>Group</label>
                                <select
                                    value={formData.group_id}
                                    onChange={handleGroupChange}
                                    style={{ width: '100%', padding: '0.45rem' }}
                                >
                                    <option value="">— None —</option>
                                    {groupsForSelect.map(g => (
                                        <option key={g.id} value={g.id}>
                                            {g._famName ? `${g.name}` : `${g.name} (no family)`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {orphanText.length > 0 && (
                            <div style={{
                                marginTop: '0.6rem', padding: '0.4rem 0.6rem', fontSize: '0.78rem',
                                background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px', color: '#92400e',
                            }}>
                                <strong>Heads up:</strong>{' '}
                                {orphanText.join('; ')}.
                                Promote them in <Link to="/admin/taxonomy">/admin/taxonomy</Link> or pick replacements above.
                            </div>
                        )}
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>ISO code</label>
                            <input type="text" name="isocode" value={formData.isocode} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Glottocode</label>
                            <input type="text" name="glottocode" value={formData.glottocode} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Location</label>
                        <input type="text" name="location" value={formData.location} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Latitude</label>
                            <input type="number" step="any" name="latitude" value={formData.latitude} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Longitude</label>
                            <input type="number" step="any" name="longitude" value={formData.longitude} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem'}}>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Supervisor</label>
                            <input type="text" name="supervisor" value={formData.supervisor} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                        <div>
                            <label style={{display: 'block', fontWeight: 'bold'}}>Informant</label>
                            <input type="text" name="informant" value={formData.informant} onChange={handleChange} style={{width: '100%', padding: '0.5rem'}} />
                        </div>
                    </div>

                    <div>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Source</label>
                        <textarea name="source" value={formData.source} onChange={handleChange} rows="2" style={{width: '100%', padding: '0.5rem'}} />
                    </div>

                    <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem'}}>
                        <input type="checkbox" id="historical_language" name="historical_language" checked={formData.historical_language} onChange={handleChange} />
                        <label htmlFor="historical_language" style={{fontWeight: 'bold'}}>Historical language</label>
                    </div>

                    <div style={{marginTop: '0.5rem'}}>
                        <label style={{display: 'block', fontWeight: 'bold'}}>Assign to a user</label>
                        <select name="assigned_user_id" value={formData.assigned_user_id} onChange={handleChange} style={{width: '100%', padding: '0.5rem', marginTop: '0.25rem'}}>
                            <option value="">-- No user assigned --</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>
                                    {u.name} {u.surname} ({u.email})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{display: 'flex', gap: '1rem', marginTop: '1.5rem'}}>
                        <button type="submit" className="btn btn--primary">Save Language</button>
                        <Link to="/languages" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}
