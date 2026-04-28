import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import { searchMatches } from '../../utils/search';

// Stesso helper di LanguageList — forza download della blob ricevuta
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

const INITIAL_FILTERS = {
    schema: '',
    param_type: '',
    level_of_comparison: '',
    active: 'all',  // 'all' | 'yes' | 'no'
};

export default function ParameterList() {
    const [parameters, setParameters] = useState([]);
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState(INITIAL_FILTERS);
    const [options, setOptions] = useState({ opt_schemas: [], opt_types: [], opt_levels: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const [paramsRes, optsRes] = await Promise.all([
                    api.get('/api/admin/parameters'),
                    api.get('/api/tablea/options').catch(() => ({ data: {} })),
                ]);
                setParameters(paramsRes.data || []);
                setOptions({
                    opt_schemas: optsRes.data.opt_schemas || [],
                    opt_types: optsRes.data.opt_types || [],
                    opt_levels: optsRes.data.opt_levels || [],
                });
            } catch (err) {
                console.error('Errore nel recupero dei parametri', err);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, []);

    const handleFilter = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const resetAll = () => {
        setFilters(INITIAL_FILTERS);
        setSearch('');
    };

    const filteredParams = useMemo(() => {
        return parameters.filter(p => {
            if (filters.schema && p.schema !== filters.schema) return false;
            if (filters.param_type && p.param_type !== filters.param_type) return false;
            if (filters.level_of_comparison && p.level_of_comparison !== filters.level_of_comparison) return false;
            if (filters.active === 'yes' && !p.is_active) return false;
            if (filters.active === 'no' && p.is_active) return false;
            return searchMatches(p, search, [
                'id', 'name', 'short_description', 'implicational_condition',
                'schema', 'param_type', 'level_of_comparison',
            ]);
        });
    }, [parameters, filters, search]);

    const activeFilterCount =
        (filters.schema ? 1 : 0) +
        (filters.param_type ? 1 : 0) +
        (filters.level_of_comparison ? 1 : 0) +
        (filters.active !== 'all' ? 1 : 0) +
        (search ? 1 : 0);

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Parameter Management</h1>
                <p className="muted dashboard-copy">Manage syntactic parameters (Admin)</p>
            </header>

            {/* ==== FILTRI ==== */}
            <div className="card" style={{ padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    <FilterField label="Search">
                        <input
                            type="search"
                            placeholder="Search every field..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={inputStyle}
                        />
                    </FilterField>
                    <FilterField label="Schema">
                        <select name="schema" value={filters.schema} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_schemas.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Type">
                        <select name="param_type" value={filters.param_type} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_types.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Level">
                        <select name="level_of_comparison" value={filters.level_of_comparison} onChange={handleFilter} style={inputStyle}>
                            <option value="">All</option>
                            {options.opt_levels.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </FilterField>
                    <FilterField label="Active">
                        <select name="active" value={filters.active} onChange={handleFilter} style={inputStyle}>
                            <option value="all">All</option>
                            <option value="yes">Only Active</option>
                            <option value="no">Only Inactive</option>
                        </select>
                    </FilterField>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div className="small muted">
                        {filteredParams.length} of {parameters.length} parameters
                        {activeFilterCount > 0 && <span> · {activeFilterCount} active filters</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={resetAll} className="btn btn--small">Reset</button>
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    await downloadBlob(
                                        api.get('/api/admin/export/schema/xlsx', { responseType: 'blob' }),
                                        'PCM_schema.xlsx'
                                    );
                                } catch {
                                    alert("Error while exporting the schema.");
                                }
                            }}
                            className="btn btn--small"
                            title="Export full schema: parameters, questions, motivations, links"
                        >
                            Export schema (.xlsx)
                        </button>
                        <Link to="/admin/parameters/add" className="btn btn--primary btn--small">Add Parameter</Link>
                    </div>
                </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table className="table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Pos</th>
                            <th>Name</th>
                            <th>Schema</th>
                            <th>Type</th>
                            <th>Level</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && filteredParams.map(param => (
                            <tr key={param.id} style={{ opacity: param.is_active ? 1 : 0.5 }}>
                                <td style={{ fontWeight: 'bold' }}>{param.id}</td>
                                <td>{param.position}</td>
                                <td>{param.name} {param.is_active ? '' : '(Inactive)'}</td>
                                <td className="muted small">{param.schema || '—'}</td>
                                <td>{param.param_type ? <span className="badge">{param.param_type}</span> : '—'}</td>
                                <td className="muted small">{param.level_of_comparison || '—'}</td>
                                <td className="row-actions">
                                    <Link to={`/admin/parameters/${param.id}/edit`} className="btn">Edit</Link>
                                </td>
                            </tr>
                        ))}
                        {filteredParams.length === 0 && !loading && (
                            <tr>
                                <td colSpan="7" style={{ textAlign: 'center', padding: '2rem' }}>No parameter found.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ===== Helper UI =====
const inputStyle = { width: '100%', padding: '0.45rem', fontSize: '0.85rem' };

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
