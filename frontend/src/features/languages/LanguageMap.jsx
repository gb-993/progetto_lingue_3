import { useEffect, useRef, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Style, Circle, Fill, Stroke } from 'ol/style';

const NULL_COLOR = '#9ca3af';
const NULL_LABEL = '— Unassigned';

// Riduce l'opacità di un colore CSS (hsl o hex) sostituendolo con hsla / rgba
function dimCssColor(cssColor, alpha) {
    if (typeof cssColor !== 'string') return cssColor;
    if (cssColor.startsWith('hsl(') && cssColor.endsWith(')')) {
        return cssColor.replace('hsl(', 'hsla(').replace(/\)$/, `, ${alpha})`);
    }
    if (cssColor.startsWith('#')) {
        const h = cssColor.replace('#', '');
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return cssColor;
}

function buildTopHueMap(allTopFamilies) {
    const sorted = [...(allTopFamilies || [])].sort((a, b) =>
        (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
    );
    const map = {};
    const n = Math.max(sorted.length, 1);
    sorted.forEach((t, i) => {
        map[t] = (i * 360) / n;
    });
    return map;
}

function spreadByLightness(items, hue) {
    const sorted = [...items].sort((a, b) =>
        (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
    );
    const map = {};
    sorted.forEach((item, i) => {
        const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
        const lightness = 32 + t * 38; // 32% -> 70%
        map[item] = `hsl(${hue}, 65%, ${lightness}%)`;
    });
    return map;
}

function pickBaseHue(filters, languages, topHueMap) {
    if (filters.top_family && topHueMap[filters.top_family] !== undefined) {
        return topHueMap[filters.top_family];
    }
    const first = languages.find(l => l.top_level_family && topHueMap[l.top_level_family] !== undefined);
    return first ? topHueMap[first.top_level_family] : 210;
}

function computeColorPlan({ languages, filters, allTopFamilies }) {
    const topHueMap = buildTopHueMap(allTopFamilies);
    const mode = filters.family ? 'group' : filters.top_family ? 'family' : 'top_family';

    if (mode === 'top_family') {
        const tops = [...new Set(languages.map(l => l.top_level_family).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        const colorMap = {};
        tops.forEach(t => {
            const hue = topHueMap[t] ?? 0;
            colorMap[t] = `hsl(${hue}, 65%, 50%)`;
        });
        return {
            mode,
            modeLabel: 'by Top-Family',
            colorOf: (l) => (l.top_level_family && colorMap[l.top_level_family]) || NULL_COLOR,
            labelOf: (l) => l.top_level_family || NULL_LABEL,
            entries: tops.map(k => ({ key: k, color: colorMap[k] })),
        };
    }

    if (mode === 'family') {
        const hue = pickBaseHue(filters, languages, topHueMap);
        const families = [...new Set(languages.map(l => l.family).filter(Boolean))];
        const colorMap = spreadByLightness(families, hue);
        return {
            mode,
            modeLabel: 'by Subfamily',
            colorOf: (l) => (l.family && colorMap[l.family]) || NULL_COLOR,
            labelOf: (l) => l.family || NULL_LABEL,
            entries: Object.entries(colorMap).map(([key, color]) => ({ key, color })),
        };
    }

    // mode === 'group'
    const hue = pickBaseHue(filters, languages, topHueMap);
    const groups = [...new Set(languages.map(l => l.grp).filter(Boolean))];
    const colorMap = spreadByLightness(groups, hue);
    return {
        mode,
        modeLabel: 'by Group',
        colorOf: (l) => (l.grp && colorMap[l.grp]) || NULL_COLOR,
        labelOf: (l) => l.grp || NULL_LABEL,
        entries: Object.entries(colorMap).map(([key, color]) => ({ key, color })),
    };
}

export default function LanguageMap({ languages, filters, allTopFamilies }) {
    const navigate = useNavigate();
    const mapRef = useRef(null);
    const tooltipRef = useRef(null);
    const mapInstance = useRef(null);
    const vectorSource = useRef(null);
    const navigateRef = useRef(navigate);
    const [hoveredKey, setHoveredKey] = useState(null);

    useEffect(() => { navigateRef.current = navigate; }, [navigate]);

    const plan = useMemo(
        () => computeColorPlan({ languages, filters, allTopFamilies }),
        [languages, filters, allTopFamilies]
    );

    const counts = useMemo(() => {
        const c = {};
        languages.forEach(l => {
            const k = plan.labelOf(l);
            c[k] = (c[k] || 0) + 1;
        });
        return c;
    }, [languages, plan]);

    // init map once
    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return;
        vectorSource.current = new VectorSource();
        const vectorLayer = new VectorLayer({ source: vectorSource.current });
        const map = new Map({
            target: mapRef.current,
            layers: [
                new TileLayer({ source: new OSM() }),
                vectorLayer,
            ],
            view: new View({
                center: fromLonLat([12, 42]),
                zoom: 2,
            }),
        });
        mapInstance.current = map;

        const tooltipOverlay = new Overlay({
            element: tooltipRef.current,
            offset: [10, 0],
            positioning: 'bottom-left',
            stopEvent: false,
        });
        map.addOverlay(tooltipOverlay);

        const onPointerMove = (evt) => {
            if (evt.dragging) {
                tooltipRef.current.style.display = 'none';
                return;
            }
            const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);
            const target = map.getTargetElement();
            if (feature) {
                tooltipRef.current.innerText = feature.get('name') || '';
                tooltipRef.current.style.display = 'block';
                tooltipOverlay.setPosition(evt.coordinate);
                if (target) target.style.cursor = 'pointer';
            } else {
                tooltipRef.current.style.display = 'none';
                if (target) target.style.cursor = '';
            }
        };

        const onClick = (evt) => {
            const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);
            if (feature) {
                const id = feature.get('languageId');
                if (id) navigateRef.current(`/languages/${id}/data`);
            }
        };

        map.on('pointermove', onPointerMove);
        map.on('click', onClick);

        return () => {
            map.un('pointermove', onPointerMove);
            map.un('click', onClick);
            map.setTarget(null);
            mapInstance.current = null;
        };
    }, []);

    // refresh features when data, coloring or legend hover change
    useEffect(() => {
        if (!vectorSource.current) return;
        vectorSource.current.clear();
        languages.forEach(l => {
            const lat = Number(l.latitude);
            const lng = Number(l.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            const key = plan.labelOf(l);
            const isHighlighted = hoveredKey === null || hoveredKey === key;
            const baseColor = plan.colorOf(l);
            const fillColor = isHighlighted ? baseColor : dimCssColor(baseColor, 0.15);
            const strokeColor = isHighlighted ? '#fff' : 'rgba(255,255,255,0.3)';
            const f = new Feature({
                geometry: new Point(fromLonLat([lng, lat])),
                name: l.name_full,
                languageId: l.id,
            });
            f.setStyle(new Style({
                image: new Circle({
                    radius: isHighlighted ? (hoveredKey ? 7 : 5) : 4,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({ color: strokeColor, width: 1.5 }),
                }),
            }));
            vectorSource.current.addFeature(f);
        });
    }, [languages, plan, hoveredKey]);

    return (
        <div>
            <div ref={mapRef} style={{ width: '100%', height: '420px', background: 'var(--surface-2)', position: 'relative' }} />
            <div
                ref={tooltipRef}
                style={{
                    display: 'none',
                    position: 'absolute',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '0.25rem 0.55rem',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                    zIndex: 100,
                }}
            />
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
                    Coloring {plan.modeLabel}
                </span>
                {plan.entries.length === 0 ? (
                    <span className="muted small">No data to display.</span>
                ) : (
                    plan.entries.map(({ key, color }) => {
                        const isActive = hoveredKey === key;
                        return (
                            <span
                                key={key}
                                onMouseEnter={() => setHoveredKey(key)}
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
                                <span>{key}</span>
                                <span className="muted" style={{ fontSize: '0.7rem' }}>({counts[key] || 0})</span>
                            </span>
                        );
                    })
                )}
            </div>
        </div>
    );
}
