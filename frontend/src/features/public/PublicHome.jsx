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

function dimHsl(cssColor, alpha) {
    if (typeof cssColor !== 'string') return cssColor;
    if (cssColor.startsWith('hsl(') && cssColor.endsWith(')')) {
        return cssColor.replace('hsl(', 'hsla(').replace(/\)$/, `, ${alpha})`);
    }
    return cssColor;
}

export default function PublicHome() {
    const [loading, setLoading] = useState(true);
    const mapRef = useRef(null);
    const mapInstance = useRef(null);
    const vectorSourceRef = useRef(null);

    const [familyColors, setFamilyColors] = useState([]);
    const [hoveredKey, setHoveredKey] = useState(null);

    useEffect(() => {
        const fetchMapData = async () => {
            try {
                const response = await api.get('/api/public/map-data');
                const langs = response.data;

                // Hue distribuita sulle top-level family (alfabetico)
                const tops = [...new Set(langs.map(l => l.family).filter(Boolean))]
                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                const colorByFamily = {};
                tops.forEach((t, i) => {
                    const hue = (i * 360) / Math.max(tops.length, 1);
                    colorByFamily[t] = `hsl(${hue}, 65%, 50%)`;
                });
                setFamilyColors(tops.map(t => ({ name: t, color: colorByFamily[t] })));

                if (!mapInstance.current && mapRef.current) {
                    const features = langs.map(l => {
                        const f = new Feature({
                            geometry: new Point(fromLonLat([l.lng, l.lat])),
                            name: l.name,
                            family: l.family,
                            baseColor: colorByFamily[l.family] || '#9ca3af',
                        });
                        f.setStyle(new Style({
                            image: new Circle({
                                radius: 6,
                                fill: new Fill({ color: colorByFamily[l.family] || '#9ca3af' }),
                                stroke: new Stroke({ color: '#fff', width: 2 }),
                            }),
                        }));
                        return f;
                    });

                    const vectorSource = new VectorSource({ features });
                    vectorSourceRef.current = vectorSource;
                    const vectorLayer = new VectorLayer({ source: vectorSource });

                    mapInstance.current = new Map({
                        target: mapRef.current,
                        layers: [
                            new TileLayer({ source: new OSM() }),
                            vectorLayer
                        ],
                        view: new View({
                            center: fromLonLat([12, 42]),
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

    // Aggiorna lo stile dei marker quando cambia la voce di legenda sotto al mouse
    useEffect(() => {
        const src = vectorSourceRef.current;
        if (!src) return;
        src.getFeatures().forEach(f => {
            const baseColor = f.get('baseColor') || '#9ca3af';
            const family = f.get('family');
            const isHighlighted = hoveredKey === null || hoveredKey === family;
            const fillColor = isHighlighted ? baseColor : dimHsl(baseColor, 0.15);
            const strokeColor = isHighlighted ? '#fff' : 'rgba(255,255,255,0.3)';
            f.setStyle(new Style({
                image: new Circle({
                    radius: isHighlighted ? (hoveredKey ? 8 : 6) : 5,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({ color: strokeColor, width: 2 }),
                }),
            }));
        });
    }, [hoveredKey]);

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
                {familyColors.length > 0 && (
                    <div style={{
                        padding: '0.55rem 0.75rem',
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.35rem 0.9rem',
                        alignItems: 'center',
                        background: 'var(--surface-alt)',
                    }}>
                        <span className="small" style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.7rem', marginRight: '0.4rem' }}>
                            Top-Family
                        </span>
                        {familyColors.map(({ name, color }) => {
                            const isActive = hoveredKey === name;
                            return (
                                <span
                                    key={name}
                                    onMouseEnter={() => setHoveredKey(name)}
                                    onMouseLeave={() => setHoveredKey(null)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                        fontSize: '0.78rem',
                                        cursor: 'pointer',
                                        padding: '0.15rem 0.4rem',
                                        borderRadius: '4px',
                                        background: isActive ? 'var(--surface-2)' : 'transparent',
                                        transition: 'background 0.12s ease',
                                        opacity: hoveredKey && !isActive ? 0.5 : 1,
                                    }}
                                >
                                    <span style={{
                                        width: '12px', height: '12px',
                                        borderRadius: '50%',
                                        background: color,
                                        border: '1px solid rgba(0,0,0,0.2)',
                                        display: 'inline-block',
                                        flexShrink: 0,
                                    }} />
                                    <span>{name}</span>
                                </span>
                            );
                        })}
                    </div>
                )}
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