import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function HowToCite() {
    const [contents, setContents] = useState({});
    const [loading, setLoading] = useState(true);
    const [copyStatus, setCopyStatus] = useState({ params: 'Copy', data: 'Copy' });

    // Verifichiamo se l'utente è admin per mostrare i tasti "Edit"
    const isAdmin = localStorage.getItem('role') === 'admin';

    useEffect(() => {
        api.get('/api/public/site-content')
            .then(res => {
                setContents(res.data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Errore caricamento contenuti:", err);
                setLoading(false);
            });
    }, []);

    const copyToClipboard = (text, key) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyStatus(prev => ({ ...prev, [key]: 'Copied' }));
            setTimeout(() => {
                setCopyStatus(prev => ({ ...prev, [key]: 'Copy' }));
            }, 2000);
        });
    };

    if (loading) return <div className="container"><p>Loading citation guidelines...</p></div>;

    const paramsText = contents.params_cite || "Longobardi, Giuseppe & Cristina Guardiano. 2009. Evidence for syntax as a signal of historical relatedness. Lingua 119. 1679-1706.";
    const dataText = contents.data_cite || "Guardiano, Cristina, et al. (eds.). 2026. The PCM_Hub (version 1).";

    return (
        <div className="container" style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '3rem' }}>
                <h1>Citation Guidelines</h1>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

                {/* CARD 1: PARAMETERS */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <small style={{ fontWeight: 'bold', color: '#888' }}>For Admins and Users</small>
                    <h3 style={{ margin: '0.5rem 0' }}>Parameters & Manifestations</h3>
                    <p className="small" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        Unless otherwise specified, if you quote a parameter description, please refer to:
                    </p>

                    <div style={{
                        background: '#f8f9fa', padding: '1.2rem', borderRadius: '8px',
                        fontSize: '0.85rem', border: '1px solid #ddd', position: 'relative', flexGrow: 1
                    }}>
                        <button
                            onClick={() => copyToClipboard(paramsText, 'params')}
                            style={{
                                position: 'absolute', top: '8px', right: '8px',
                                padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer',
                                background: copyStatus.params === 'Copy' ? '#fff' : '#28a745',
                                color: copyStatus.params === 'Copy' ? '#333' : '#fff',
                                border: '1px solid #ddd', borderRadius: '4px'
                            }}
                        >
                            {copyStatus.params}
                        </button>
                        <div dangerouslySetInnerHTML={{ __html: paramsText }} />
                    </div>

                    {isAdmin && (
                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <Link to="/admin/edit-content/params_cite" style={{ fontSize: '0.85rem', color: '#ff4500', fontWeight: 'bold', textDecoration: 'none' }}>
                                Edit reference
                            </Link>
                        </div>
                    )}
                </div>

                {/* CARD 2: DATA & MAP */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <small style={{ fontWeight: 'bold', color: '#888' }}>For Public and Admins</small>
                    <h3 style={{ margin: '0.5rem 0' }}>Data, Map & Scripts</h3>
                    <p className="small" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        To cite any content of the PCM Hub (except for parameters):
                    </p>

                    <div style={{
                        background: '#f8f9fa', padding: '1.2rem', borderRadius: '8px',
                        fontSize: '0.85rem', border: '1px solid #ddd', position: 'relative', flexGrow: 1
                    }}>
                        <button
                            onClick={() => copyToClipboard(dataText, 'data')}
                            style={{
                                position: 'absolute', top: '8px', right: '8px',
                                padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer',
                                background: copyStatus.data === 'Copy' ? '#fff' : '#28a745',
                                color: copyStatus.data === 'Copy' ? '#333' : '#fff',
                                border: '1px solid #ddd', borderRadius: '4px'
                            }}
                        >
                            {copyStatus.data}
                        </button>
                        <div dangerouslySetInnerHTML={{ __html: dataText }} />
                    </div>

                    {isAdmin && (
                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <Link to="/admin/edit-content/data_cite" style={{ fontSize: '0.85rem', color: '#ff4500', fontWeight: 'bold', textDecoration: 'none' }}>
                                Edit reference
                            </Link>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}