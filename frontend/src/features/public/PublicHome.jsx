import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

// OpenLayers imports corretti per Vite
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import { fromLonLat } from 'ol/proj';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';   // CORRETTO
import VectorSource from 'ol/source/Vector'; // CORRETTO
import { Style, Circle, Fill, Stroke } from 'ol/style';

export default function PublicHome() {
    const [loading, setLoading] = useState(true);
    const mapRef = useRef(null);
    const mapInstance = useRef(null);

    useEffect(() => {
        const fetchMapData = async () => {
            try {
                const response = await api.get('/api/public/map-data');
                const langs = response.data;

                if (!mapInstance.current && mapRef.current) {
                    // Creazione dei marker per le lingue
                    const features = langs.map(l => {
                        const feature = new Feature({
                            geometry: new Point(fromLonLat([l.lng, l.lat])),
                            name: l.name,
                        });
                        return feature;
                    });

                    const vectorSource = new VectorSource({ features });
                    const vectorLayer = new VectorLayer({
                        source: vectorSource,
                        style: new Style({
                            image: new Circle({
                                radius: 6,
                                fill: new Fill({ color: '#ff4500' }),
                                stroke: new Stroke({ color: '#fff', width: 2 }),
                            }),
                        }),
                    });

                    // Inizializzazione Mappa
                    mapInstance.current = new Map({
                        target: mapRef.current,
                        layers: [
                            new TileLayer({ source: new OSM() }),
                            vectorLayer
                        ],
                        view: new View({
                            center: fromLonLat([12, 42]), // Centro sull'Italia come default
                            zoom: 3,
                        }),
                    });
                }
                setLoading(false);
            } catch (error) {
                console.error("Errore nel caricamento della mappa:", error);
                setLoading(false);
            }
        };

        fetchMapData();

        return () => {
            if (mapInstance.current) {
                mapInstance.current.setTarget(null);
                mapInstance.current = null;
            }
        };
    }, []);

    return (
        <div className="page-shell">
            <header className="page-hero" style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h1 className="page-title">Welcome to the PCM Hub</h1>
                <p className="page-lead" style={{ maxWidth: '800px', margin: '0 auto 1.5rem' }}>
                    The <a href="http://www.parametricomparison.unimore.it" target="_blank" rel="noreferrer"><strong>Parametric Comparison Method</strong></a> (PCM) compares languages using universal syntactic parameters to measure similarity and reconstruct phylogenetic relationships.
                </p>
                <div className="page-actions">
                    <Link to="/login" className="btn btn--primary">Login</Link>
                </div>
            </header>

            {/* MAPPA INTERATTIVA */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '3rem' }}>
                <div ref={mapRef} style={{ width: '100%', height: '450px' }}>
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', background: 'var(--surface-2)', color: 'var(--text)' }}>
                            <span>Loading interactive map...</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="page-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <section className="card page-card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="p-6" style={{ padding: '1.5rem', flexGrow: 1 }}>
                        <h3>How to cite</h3>
                        <p className="page-muted-block">
                            If you use data, methodology or any resource from the PCM Hub, please cite your source appropriately following our guidelines.
                        </p>
                    </div>
                    <div className="page-card-footer" style={{ padding: '1rem 1.5rem', borderTop: '1px solid #eee' }}>
                        <Link to="/how-to-cite" className="btn btn--primary" style={{ width: '100%', textAlign: 'center' }}>
                            View Citation Guidelines
                        </Link>
                    </div>
                </section>

                <section className="card page-card" style={{ borderTop: '4px solid #2c3e50' }}>
                    <div className="p-6" style={{ padding: '1.5rem' }}>
                        <h3>Collaborations</h3>
                        <p className="page-muted-block">
                            Interested in contributing to data collection or proposing a scientific collaboration?
                        </p>
                        <p style={{ marginTop: '1rem', fontWeight: 'bold' }}>
                            Contact us at: <br />
                            <a href="mailto:pcm_lab@unimore.it" style={{ color: '#ff4500' }}>pcm_lab@unimore.it</a>
                        </p>
                    </div>
                </section>
            </div>
        </div>
    );
}