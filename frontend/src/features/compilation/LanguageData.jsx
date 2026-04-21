import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api';
import ParameterBlock from './ParameterBlock';

export default function LanguageData() {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [activeIndex, setActiveIndex] = useState(0); // Indice del parametro visibile
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchCompilationData = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/api/languages/${id}/compilation`);
            setData(res.data);
            setError('');
        } catch (err) {
            console.error(err);
            setError('Impossibile caricare i dati della lingua.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchCompilationData(); }, [id]);

    const handleWorkflowAction = async (action) => {
        try {
            setLoading(true);
            const res = await api.post(`/api/languages/${id}/workflow/${action}`);
            alert(res.data.detail);
            fetchCompilationData();
        } catch (err) {
            alert(err.response?.data?.detail || `Errore durante: ${action}`);
            setLoading(false);
        }
    };

    if (loading) return <div className="container" style={{ marginTop: '2rem' }}>Caricamento...</div>;
    if (error) return <div className="container alert alert-error" style={{ marginTop: '2rem' }}>{error}</div>;
    if (!data) return null;

    const { language, parameters } = data;
    const currentParam = parameters[activeIndex];
    const isAdmin = localStorage.getItem('role') === 'admin';
    const isReadOnly = isAdmin ? false : false; // TODO: Logica status

    return (
        <main className="container" style={{ marginTop: '2rem', paddingBottom: '10rem' }}>

            {/* Header Lingua */}
            <div className="card lang-header-card" style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ margin: 0 }}>
                    {language.name_full} <span className="muted" style={{ fontWeight: 400, fontSize: '0.7em' }}>({language.id})</span>
                </h2>
            </div>

            {/* Navigazione Wizard (Quadratini) */}
            <div className="param-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem', background: '#fff', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                {parameters.map((p, idx) => {
                    const { answered = 0, total = 0 } = p.stats || {};
                    const isFlagged = p.is_flagged || false;

                    let bg = '#f8f9fa'; // Sfondo default chiaro
                    let color = '#333';
                    let borderColor = '#ddd';

                    // Logica Colori
                    if (isFlagged || (answered > 0 && answered < total)) {
                        bg = '#dc3545'; // Rosso
                        color = '#fff';
                        borderColor = '#a71d2a';
                    } else if (answered === total && total > 0) {
                        bg = '#198754'; // Verde
                        color = '#fff';
                        borderColor = '#0f5132';
                    }

                    const isActive = idx === activeIndex;

                    return (
                        <button
                            key={p.id}
                            onClick={() => setActiveIndex(idx)}
                            className="param-btn"
                            style={{
                                background: bg,
                                color: color,
                                border: `1px solid ${borderColor}`,
                                // La linea nera in basso se attivo
                                borderBottom: isActive ? '3px solid #000' : `1px solid ${borderColor}`,
                                // Centratura del testo
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '2.5rem',
                                height: '2.5rem',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                padding: 0 // Importante per l'allineamento con flex
                            }}
                            title={isFlagged ? "Marked as unsure" : `Progress: ${answered}/${total}`}
                        >
                            {p.id}
                        </button>
                    );
                })}
            </div>

            {/* Blocco Parametro Corrente */}
            {currentParam && (
                <ParameterBlock
                    key={currentParam.id}
                    parameter={currentParam}
                    langId={language.id}
                    isReadOnly={isReadOnly}
                    onSaved={() => {
                        fetchCompilationData();
                        if (activeIndex < parameters.length - 1) setActiveIndex(activeIndex + 1);
                    }}
                />
            )}
        </main>
    );
}