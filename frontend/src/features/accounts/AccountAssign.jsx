import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function AccountAssign() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [languages, setLanguages] = useState([]);
    const [selectedLangs, setSelectedLangs] = useState(new Set());
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchData = async () => {
            try {
                const userRes = await api.get(`/api/admin/accounts/${id}`);
                setUser(userRes.data);
                setSelectedLangs(new Set(userRes.data.assigned_languages));

                const langRes = await api.get('/api/admin/languages');
                setLanguages(langRes.data);
            } catch (err) {
                setError('Could not load the data.');
            }
        };
        fetchData();
    }, [id]);

    const handleCheckboxChange = (langId) => {
        const newSelected = new Set(selectedLangs);
        if (newSelected.has(langId)) newSelected.delete(langId);
        else newSelected.add(langId);
        setSelectedLangs(newSelected);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/api/admin/accounts/${id}/languages`, {
                language_ids: Array.from(selectedLangs)
            });
            navigate('/admin/accounts');
        } catch (err) {
            setError(err.response?.data?.detail || 'Error while saving.');
        }
    };

    if (!user) return <div className="container">Loading...</div>;

    return (
        <div className="container" style={{ maxWidth: '800px', marginTop: '2rem' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem' }}>
                    <h2>Assign Languages to: {user.name} {user.surname}</h2>
                    <p className="muted">{user.email}</p>
                </header>

                {error && <div className="alert alert-error mb-1">{error}</div>}

                <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
                    <strong>Warning:</strong> If you select a language labelled "Assigned to others", it will be <strong>immediately revoked</strong> from the previous owner and transferred to this user.
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
                        {languages.map(lang => (
                            <label key={lang.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--surface-2)' }}>
                                <input
                                    type="checkbox"
                                    checked={selectedLangs.has(lang.id)}
                                    onChange={() => handleCheckboxChange(lang.id)}
                                />
                                <span><strong>{lang.id}</strong> — {lang.name_full}</span>

                                {lang.assigned_user_id && lang.assigned_user_id !== user.id && (
                                    <span className="badge" style={{ marginLeft: 'auto', backgroundColor: 'var(--pill-warn-bg)', color: 'var(--warn)' }}>
                                        Assigned to others (will be transferred)
                                    </span>
                                )}
                            </label>
                        ))}
                    </div>
                    <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
                        <Link to="/admin/accounts" className="btn">Cancel</Link>
                        <button type="submit" className="btn btn--primary">Save Assignments</button>
                    </div>
                </form>
            </div>
        </div>
    );
}