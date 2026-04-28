import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api';

export default function EditSiteContent() {
    const { key } = useParams();
    const navigate = useNavigate();
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        // Carichiamo tutti i contenuti e filtriamo per la chiave corretta
        api.get('/api/public/site-content')
            .then(res => {
                if (res.data[key]) {
                    setContent(res.data[key]);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error("Errore recupero contenuto:", err);
                setError("Could not retrieve the content to edit.");
                setLoading(false);
            });
    }, [key]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/api/admin/site-content/${key}`, { content });
            navigate('/how-to-cite');
        } catch (err) {
            setError("Error while saving.");
        }
    };

    if (loading) return <div className="container"><p>Loading editor...</p></div>;

    return (
        <div className="container" style={{ marginTop: '2rem' }}>
            <header style={{ marginBottom: '1.5rem' }}>
                <h2>Edit visible text</h2>
                <p className="muted">You are editing: <strong>{key}</strong></p>
            </header>

            {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

            <div className="card" style={{ maxWidth: '800px', padding: '2rem' }}>
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label htmlFor="content" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                            Content (HTML tags allowed, e.g. &lt;em&gt;Title&lt;/em&gt;):
                        </label>
                        <textarea
                            id="content"
                            className="form-control"
                            rows="10"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            style={{
                                width: '100%', padding: '1rem', fontFamily: 'monospace',
                                fontSize: '0.95rem', border: '1px solid #ccc', borderRadius: '4px'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button type="submit" className="btn btn--primary">Save Changes</button>
                        <Link to="/how-to-cite" className="btn">Cancel</Link>
                    </div>
                </form>
            </div>
        </div>
    );
}