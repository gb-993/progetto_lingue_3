import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import axios from 'axios';

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
                const token = localStorage.getItem('token');
                const config = { headers: { Authorization: `Bearer ${token}` } };

                const userRes = await axios.get(`http://localhost:8000/api/admin/accounts/${id}`, config);
                setUser(userRes.data);
                setSelectedLangs(new Set(userRes.data.assigned_languages));

                const langRes = await axios.get('http://localhost:8000/api/admin/languages', config);
                setLanguages(langRes.data);
            } catch (err) {
                setError('Impossibile caricare i dati.');
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
            const token = localStorage.getItem('token');
            await axios.put(`http://localhost:8000/api/admin/accounts/${id}/languages`,
                { language_ids: Array.from(selectedLangs) },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            navigate('/admin/accounts');
        } catch (err) {
            setError(err.response?.data?.detail || 'Errore durante il salvataggio.');
        }
    };

    if (!user) return <div className="container">Caricamento...</div>;

    return (
        <div className="container" style={{ maxWidth: '800px', marginTop: '2rem' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem' }}>
                    <h2>Assign Languages to: {user.name} {user.surname}</h2>
                    <p className="muted">{user.email}</p>
                </header>

                {error && <div className="alert alert-error mb-1">{error}</div>}

                {/* AVVISO DI REVOCA AGGIUNTO QUI */}
                <div className="alert alert-warning" style={{ marginBottom: '1.5rem' }}>
                    <strong>Attenzione:</strong> Se selezioni una lingua che ha l'etichetta "Assegnata ad altri", questa verrà <strong>immediatamente revocata</strong> al precedente proprietario e trasferita a questo utente.
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

                                {/* BADGE AGGIORNATO */}
                                {lang.assigned_user_id && lang.assigned_user_id !== user.id && (
                                    <span className="badge" style={{ marginLeft: 'auto', backgroundColor: 'var(--pill-warn-bg)', color: 'var(--warn)' }}>
                                        ⚠️ Assegnata ad altri (verrà trasferita)
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