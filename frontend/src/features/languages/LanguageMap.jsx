import { useEffect, useRef, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
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

// deve restare uguale alla citazione del backend (citation.py)
const CITATION_EDITORS =
    'Guardiano, Cristina, Paola Crisma, Giuseppe Longobardi, ' +
    'Marco Longhin, Giovanni Battista Matteazzi, Emanuela Li Destri, Gaia Sorge';
const CITATION_YEAR = '2026';
const CITATION_WORK_TITLE = 'The PCM_Hub';
const CITATION_VERSION = 'version 1';

// data in UTC, come nel backend
function buildCitationLines() {
    const now = new Date();
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    const accessed = `${dd}/${mm}/${yyyy}`;
    return [
        'Downloaded from:',
        `${CITATION_EDITORS} (eds). ${CITATION_YEAR}. ${CITATION_WORK_TITLE} ` +
        `(${CITATION_VERSION}, Accessed on ${accessed})`,
    ];
}

function dimCssColor(cssColor, alpha) {
    if (typeof cssColor !== 'string') return cssColor;
    if (cssColor.startsWith('hsl(') && cssColor.endsWith(')')) {
        return cssColor.replace('hsl(', 'hsla(').replace(/\)$/, `, ${alpha})`);
    }
    if (cssColor.startsWith('#')) {
        const hex = cssColor.replace('#', '');
        const full = hex.length === 3 ? hex.split('').map(digit => digit + digit).join('') : hex;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return cssColor;
}

// colori ben distinguibili tra loro
const CATEGORICAL_PALETTE = [
    '#e6194b',
    '#3cb44b',
    '#4363d8',
    '#f58231',
    '#911eb4',
    '#469990',
    '#f032e6',
    '#9a6324',
    '#42d4f4',
    '#808000',
    '#000075',
    '#800000',
    '#bfef45',
    '#6a5acd',
    '#2e8b57',
    '#ff8c00',
    '#c71585',
    '#1f78b4',
];

// stesso nome = stesso colore, sempre
function buildNameColorMap(allNames) {
    const PHI = (1 + Math.sqrt(5)) / 2;
    const sorted = [...new Set((allNames || []).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    const colorByName = {};
    sorted.forEach((name, i) => {
        if (i < CATEGORICAL_PALETTE.length) {
            colorByName[name] = CATEGORICAL_PALETTE[i];
            return;
        }
        const extraIndex = i - CATEGORICAL_PALETTE.length;
        const hue = ((extraIndex * PHI) % 1) * 360;
        const lightPos = (extraIndex * PHI * PHI) % 1;
        const lightness = 42 + lightPos * 16;
        colorByName[name] = `hsl(${hue.toFixed(1)}, 68%, ${lightness.toFixed(1)}%)`;
    });
    return colorByName;
}

function computeColorPlan({ languages, filters, allTopFamilies, allFamilies, allGroups }) {
    // scende di livello solo con una voce sola
    const numTop = filters.top_family?.length || 0;
    const numFamily = filters.family?.length || 0;
    const numGroup = filters.grp?.length || 0;
    let mode;
    if (numGroup >= 1) mode = 'group';
    else if (numFamily >= 1) mode = numFamily === 1 ? 'group' : 'family';
    else if (numTop >= 1) mode = numTop === 1 ? 'family' : 'top_family';
    else mode = 'top_family';

    // così nessun punto resta senza colore
    const buildPlan = (modeLabel, fieldOf, globalNames) => {
        const present = languages.map(fieldOf).filter(Boolean);
        const colorMap = buildNameColorMap([...(globalNames || []), ...present]);
        const keys = [...new Set(present)].sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        return {
            mode,
            modeLabel,
            colorOf: (lang) => { const name = fieldOf(lang); return (name && colorMap[name]) || NULL_COLOR; },
            labelOf: (lang) => fieldOf(lang) || NULL_LABEL,
            entries: keys.map(key => ({ key, color: colorMap[key] || NULL_COLOR })),
        };
    };

    if (mode === 'top_family') return buildPlan('by Top-Family', lang => lang.top_level_family, allTopFamilies);
    if (mode === 'family') return buildPlan('by Subfamily', lang => lang.family, allFamilies);
    return buildPlan('by Group', lang => lang.grp, allGroups);
}

function LanguageMap({ languages, filters, allTopFamilies, allFamilies, allGroups }, ref) {
    const navigate = useNavigate();
    const mapRef = useRef(null);
    const tooltipRef = useRef(null);
    const mapInstance = useRef(null);
    const vectorSource = useRef(null);
    const navigateRef = useRef(navigate);
    const planRef = useRef(null);
    const countsRef = useRef(null);
    const [hoveredKey, setHoveredKey] = useState(null);

    useEffect(() => { navigateRef.current = navigate; }, [navigate]);

    // export PNG: mappa + legenda + citazione
    useImperativeHandle(ref, () => ({
        exportPng: () => new Promise((resolve, reject) => {
            const map = mapInstance.current;
            if (!map) {
                reject(new Error('Map not ready'));
                return;
            }
            map.once('rendercomplete', () => {
                try {
                    const size = map.getSize();
                    const mapW = size[0];
                    const mapH = size[1];
                    const plan = planRef.current;
                    const counts = countsRef.current || {};

                    // layout legenda
                    const PAD = 16;
                    const TITLE_FONT = 'bold 12px system-ui, -apple-system, "Segoe UI", sans-serif';
                    const ENTRY_FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
                    const TITLE_H = 16;
                    const TITLE_GAP = 10;
                    const ROW_H = 22;
                    const CIRCLE_R = 5;
                    const CIRCLE_TEXT_GAP = 6;
                    const ENTRY_GAP_X = 18;

                    const measureCtx = document.createElement('canvas').getContext('2d');
                    measureCtx.font = ENTRY_FONT;

                    const entries = plan && plan.entries.length > 0 ? plan.entries : [];
                    const entryWidths = entries.map(({ key }) => {
                        const text = `${key} (${counts[key] || 0})`;
                        return CIRCLE_R * 2 + CIRCLE_TEXT_GAP + measureCtx.measureText(text).width;
                    });

                    const maxRow = mapW - 2 * PAD;
                    let rows = entries.length === 0 ? 1 : 1;
                    let rowW = 0;
                    entryWidths.forEach(width => {
                        const candidate = rowW === 0 ? width : rowW + ENTRY_GAP_X + width;
                        if (rowW > 0 && candidate > maxRow) {
                            rows++;
                            rowW = width;
                        } else {
                            rowW = candidate;
                        }
                    });

                    const legendH = PAD + TITLE_H + TITLE_GAP + rows * ROW_H + PAD;

                    // layout citazione
                    const CITE_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
                    const CITE_LINE_H = 15;
                    const CITE_PAD = 14;
                    measureCtx.font = CITE_FONT;
                    const citeMaxW = mapW - 2 * PAD;
                    const citeLines = [];
                    buildCitationLines().forEach(logical => {
                        let line = '';
                        logical.split(' ').forEach(word => {
                            const test = line ? `${line} ${word}` : word;
                            if (line && measureCtx.measureText(test).width > citeMaxW) {
                                citeLines.push(line);
                                line = word;
                            } else {
                                line = test;
                            }
                        });
                        if (line) citeLines.push(line);
                    });
                    const citeH = CITE_PAD + citeLines.length * CITE_LINE_H + CITE_PAD;

                    const totalH = mapH + legendH + citeH;

                    const outputCanvas = document.createElement('canvas');
                    outputCanvas.width = mapW;
                    outputCanvas.height = totalH;
                    const ctx = outputCanvas.getContext('2d');

                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, mapW, totalH);

                    // mappa
                    const viewport = map.getViewport();
                    const canvases = viewport.querySelectorAll('.ol-layer canvas, canvas.ol-layer');
                    canvases.forEach(canvas => {
                        if (canvas.width === 0) return;
                        const opacity = canvas.parentNode?.style.opacity || canvas.style.opacity;
                        ctx.globalAlpha = opacity === '' || opacity === undefined ? 1 : Number(opacity);

                        const transform = canvas.style.transform;
                        let matrix;
                        if (transform && transform.startsWith('matrix(')) {
                            matrix = transform.match(/^matrix\(([^)]*)\)$/)[1].split(',').map(Number);
                        } else {
                            matrix = [
                                parseFloat(canvas.style.width) / canvas.width || 1,
                                0, 0,
                                parseFloat(canvas.style.height) / canvas.height || 1,
                                0, 0,
                            ];
                        }
                        ctx.setTransform(...matrix);

                        const background = canvas.parentNode?.style.backgroundColor;
                        if (background) {
                            ctx.fillStyle = background;
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                        ctx.drawImage(canvas, 0, 0);
                    });
                    ctx.globalAlpha = 1;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);

                    // legenda
                    const legendY = mapH;
                    ctx.fillStyle = '#e5e7eb';
                    ctx.fillRect(0, legendY, mapW, 1);

                    ctx.fillStyle = '#6b7280';
                    ctx.font = TITLE_FONT;
                    ctx.textBaseline = 'top';
                    const titleText = plan
                        ? `Coloring ${plan.modeLabel}`.toUpperCase()
                        : 'COLORING';
                    ctx.fillText(titleText, PAD, legendY + PAD);

                    ctx.font = ENTRY_FONT;
                    ctx.textBaseline = 'middle';
                    let cursorX = PAD;
                    let cursorY = legendY + PAD + TITLE_H + TITLE_GAP;

                    if (entries.length === 0) {
                        ctx.fillStyle = '#9ca3af';
                        ctx.fillText('No data to display.', PAD, cursorY + ROW_H / 2);
                    } else {
                        entries.forEach(({ key, color }, i) => {
                            const width = entryWidths[i];
                            if (cursorX > PAD && cursorX + width > mapW - PAD) {
                                cursorX = PAD;
                                cursorY += ROW_H;
                            }
                            const centerY = cursorY + ROW_H / 2;
                            ctx.fillStyle = color;
                            ctx.beginPath();
                            ctx.arc(cursorX + CIRCLE_R, centerY, CIRCLE_R, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                            ctx.lineWidth = 1;
                            ctx.stroke();
                            ctx.fillStyle = '#111827';
                            const text = `${key} (${counts[key] || 0})`;
                            ctx.fillText(text, cursorX + CIRCLE_R * 2 + CIRCLE_TEXT_GAP, centerY);
                            cursorX += width + ENTRY_GAP_X;
                        });
                    }
                    ctx.textBaseline = 'alphabetic';

                    // citazione
                    const citeY = mapH + legendH;
                    ctx.fillStyle = '#e5e7eb';
                    ctx.fillRect(0, citeY, mapW, 1);
                    ctx.font = CITE_FONT;
                    ctx.fillStyle = '#787878';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    citeLines.forEach((line, i) => {
                        ctx.fillText(line, mapW / 2, citeY + CITE_PAD + i * CITE_LINE_H);
                    });
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'alphabetic';

                    outputCanvas.toBlob(blob => {
                        if (blob) resolve(blob);
                        else reject(new Error('Canvas toBlob failed (tainted canvas?)'));
                    }, 'image/png');
                } catch (err) {
                    reject(err);
                }
            });
            map.renderSync();
        }),
    }), []);

    const plan = useMemo(
        () => computeColorPlan({ languages, filters, allTopFamilies, allFamilies, allGroups }),
        [languages, filters, allTopFamilies, allFamilies, allGroups]
    );

    const counts = useMemo(() => {
        const labelCounts = {};
        languages.forEach(lang => {
            const label = plan.labelOf(lang);
            labelCounts[label] = (labelCounts[label] || 0) + 1;
        });
        return labelCounts;
    }, [languages, plan]);

    // ref per leggere plan e counts aggiornati
    useEffect(() => { planRef.current = plan; }, [plan]);
    useEffect(() => { countsRef.current = counts; }, [counts]);

    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return;
        vectorSource.current = new VectorSource();
        const vectorLayer = new VectorLayer({ source: vectorSource.current });
        const map = new Map({
            target: mapRef.current,
            layers: [
                new TileLayer({ source: new OSM({ crossOrigin: 'anonymous' }) }),
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
            const feature = map.forEachFeatureAtPixel(evt.pixel, hit => hit);
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
            const feature = map.forEachFeatureAtPixel(evt.pixel, hit => hit);
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

    useEffect(() => {
        if (!vectorSource.current) return;
        vectorSource.current.clear();
        languages.forEach(lang => {
            const lat = Number(lang.latitude);
            const lng = Number(lang.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            const key = plan.labelOf(lang);
            const isHighlighted = hoveredKey === null || hoveredKey === key;
            const baseColor = plan.colorOf(lang);
            const fillColor = isHighlighted ? baseColor : dimCssColor(baseColor, 0.15);
            const strokeColor = isHighlighted ? '#fff' : 'rgba(255,255,255,0.3)';
            const feature = new Feature({
                geometry: new Point(fromLonLat([lng, lat])),
                name: lang.name_full,
                languageId: lang.id,
            });
            feature.setStyle(new Style({
                image: new Circle({
                    radius: isHighlighted ? (hoveredKey ? 7 : 5) : 4,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({ color: strokeColor, width: 1.5 }),
                }),
            }));
            vectorSource.current.addFeature(feature);
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

export default forwardRef(LanguageMap);
