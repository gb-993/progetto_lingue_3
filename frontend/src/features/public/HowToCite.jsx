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

    const paramsText = contents.params_cite || "Crisma, Paola, Giulia Fabbris, Giuseppe Longobardi, and Cristina Guardiano. 2025. What are your values? Journal of Historical Syntax, Volume 9, Article 3: 1-26, DOI: 10.18148/hs/2025.v9i2-10.182 (Electronic appendix also available at www.parametricomparison.unimore.it)";
    const dataText = contents.data_cite || "Guardiano, Cristina, Paola Crisma, Giuseppe Longobardi, Marco Longhin, Giovanni Battista Matteazzi, Emanuela Li Destri, Gaia Sorge (eds). 2026. The PCM_Hub (version 1, Accessed on XX/XX/20XX)";

    return (
        <div className="container" style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
            <header className="dashboard-hero" style={{ marginBottom: '3rem' }}>
                <h1>Citation Guidelines</h1>
            </header>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>

                {/* CARD 1: PARAMETERS */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <small style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>For Admins and Users</small>
                    <h3 style={{ margin: '0.5rem 0' }}>Parameters & Manifestations</h3>
                    <p className="small" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        Unless otherwise specified in the description of each parameter, if you quote a parameter description or any parameter manifestation, please refer to:
                    </p>

                    <div style={{
                        background: 'var(--surface-2)', padding: '1.2rem', borderRadius: '8px',
                        fontSize: '0.85rem', border: '1px solid var(--border)', position: 'relative', flexGrow: 1,
                        color: 'var(--text)',
                    }}>
                        <button
                            onClick={() => copyToClipboard(paramsText, 'params')}
                            style={{
                                position: 'absolute', top: '8px', right: '8px',
                                padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer',
                                background: copyStatus.params === 'Copy' ? 'var(--surface)' : '#28a745',
                                color: copyStatus.params === 'Copy' ? 'var(--text)' : '#fff',
                                border: '1px solid var(--border)', borderRadius: '4px'
                            }}
                        >
                            {copyStatus.params}
                        </button>
                        <div dangerouslySetInnerHTML={{ __html: paramsText }} />
                    </div>

                    {isAdmin && (
                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <Link to="/admin/edit-content/params_cite" style={{ fontSize: '0.85rem', color: 'var(--brand)', fontWeight: 'bold', textDecoration: 'none' }}>
                                Edit reference
                            </Link>
                        </div>
                    )}
                </div>

                {/* CARD 2: DATA & MAP */}
                <div className="card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
                    <small style={{ fontWeight: 'bold', color: 'var(--text-muted)' }}>For Public and Admins</small>
                    <h3 style={{ margin: '0.5rem 0' }}>Updated language list & map, analyses, graphs and scripts</h3>
                    <p className="small" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        To cite any content of the PCM Hub (except for parameters and manifestations):
                    </p>

                    <div style={{
                        background: 'var(--surface-2)', padding: '1.2rem', borderRadius: '8px',
                        fontSize: '0.85rem', border: '1px solid var(--border)', position: 'relative', flexGrow: 1,
                        color: 'var(--text)',
                    }}>
                        <button
                            onClick={() => copyToClipboard(dataText, 'data')}
                            style={{
                                position: 'absolute', top: '8px', right: '8px',
                                padding: '4px 8px', fontSize: '0.7rem', cursor: 'pointer',
                                background: copyStatus.data === 'Copy' ? 'var(--surface)' : '#28a745',
                                color: copyStatus.data === 'Copy' ? 'var(--text)' : '#fff',
                                border: '1px solid var(--border)', borderRadius: '4px'
                            }}
                        >
                            {copyStatus.data}
                        </button>
                        <div dangerouslySetInnerHTML={{ __html: dataText }} />
                    </div>

                    {isAdmin && (
                        <div style={{ marginTop: '10px', textAlign: 'right' }}>
                            <Link to="/admin/edit-content/data_cite" style={{ fontSize: '0.85rem', color: 'var(--brand)', fontWeight: 'bold', textDecoration: 'none' }}>
                                Edit reference
                            </Link>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}