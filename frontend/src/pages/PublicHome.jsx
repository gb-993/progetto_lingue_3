import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function PublicHome() {
    const [languages, setLanguages] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Chiamata all'API pubblica creata in FastAPI
        axios.get('http://localhost:8000/api/public/languages')
            .then((response) => {
                setLanguages(response.data);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Errore nel caricamento delle lingue:", error);
                setLoading(false);
            });
    }, []);

    return (
        <div className="page-shell">
            <header className="page-hero">
                <h1 className="page-title">Welcome to the PCM Hub</h1>
                <p className="page-lead">
                    The Parametric Comparison Method compares languages using universal syntactic parameters.
                </p>
                <div className="page-actions">
                    <Link to="/login" className="btn btn--primary">Login</Link>
                </div>
            </header>

            <div className="card page-placeholder">
                {loading ? (
                    <span className="page-muted-block">Loading map data...</span>
                ) : (
                    <span className="page-muted-block">
                        Mappa interattiva: {languages.length} lingue caricate. (Implementeremo OpenLayers qui)
                    </span>
                )}
            </div>

            <div className="page-grid">
                <section className="card page-card">
                    <div className="p-6 flex-grow">
                        <h3>How to cite</h3>
                        <p className="page-muted-block">If you use data from the PCM Hub, please cite your source appropriately.</p>
                    </div>
                    <div className="page-card-footer">
                        <button className="btn btn--primary fit">
                            View Citation Guidelines
                        </button>
                    </div>
                </section>

                <section className="card page-card">
                    <div className="p-6 flex-grow">
                        <h3>Collaborations</h3>
                        <p className="page-muted-block">Are you interested in contributing to data collection?</p>
                        <p className="dashboard-copy">Contact us at: <a href="mailto:pcm_lab@unimore.it">pcm_lab@unimore.it</a></p>
                    </div>
                </section>
            </div>
        </div>
    );
}