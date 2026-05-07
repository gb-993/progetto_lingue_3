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

// Distribuisce hue + lightness all'interno di ciascun "gruppo padre" (top-family).
// La hue oscilla in un intorno (±25°) della hue della top così le subfamily/group
// restano riconoscibili come "stessa famiglia"; per evitare che con tante voci
// (es. 76 subfamily Indo-European) elementi adiacenti risultino quasi identici,
// usiamo una sequenza low-discrepancy basata sulla golden ratio: elementi vicini
// nella lista alfabetica ricevono hue e lightness molto distanti tra loro.
function spreadColorsGrouped(items, itemToTop, topHueMap) {
    const PHI = (1 + Math.sqrt(5)) / 2; // ~1.618
    const HUE_RANGE = 80;   // ±40° intorno alla hue della top family
    const LIGHT_MIN = 38;
    const LIGHT_RANGE = 30; // 38% - 68%

    const byTop = {};
    items.forEach(item => {
        const top = itemToTop[item] || '';
        if (!byTop[top]) byTop[top] = [];
        byTop[top].push(item);
    });
    const colorMap = {};
    Object.entries(byTop).forEach(([top, list]) => {
        const sorted = [...list].sort((a, b) =>
            (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
        );
        const baseHue = topHueMap[top] ?? 210;
        sorted.forEach((item, i) => {
            if (sorted.length === 1) {
                colorMap[item] = `hsl(${baseHue}, 65%, 50%)`;
                return;
            }
            const huePos = (i * PHI) % 1;          // [0,1) low-discrepancy
            const lightPos = (i * PHI * PHI) % 1;  // fase decorrelata
            const hue = (baseHue + (huePos - 0.5) * HUE_RANGE + 360) % 360;
            const lightness = LIGHT_MIN + lightPos * LIGHT_RANGE;
            colorMap[item] = `hsl(${hue.toFixed(1)}, 65%, ${lightness.toFixed(1)}%)`;
        });
    });
    return colorMap;
}

function computeColorPlan({ languages, filters, allTopFamilies }) {
    const topHueMap = buildTopHueMap(allTopFamilies);
    // La modalità scende di un livello rispetto al filtro più "fine" SOLO se
    // l'utente ha selezionato una sola voce a quel livello (altrimenti la mappa
    // sarebbe monocromatica). Se invece ci sono 2+ voci, la legenda resta a
    // quel livello: scendere produrrebbe troppe categorie poco distinguibili.
    const numTop = filters.top_family?.length || 0;
    const numFamily = filters.family?.length || 0;
    const numGroup = filters.grp?.length || 0;
    let mode;
    if (numGroup >= 1) mode = 'group';
    else if (numFamily >= 1) mode = numFamily === 1 ? 'group' : 'family';
    else if (numTop >= 1) mode = numTop === 1 ? 'family' : 'top_family';
    else mode = 'top_family';

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
        const families = [...new Set(languages.map(l => l.family).filter(Boolean))];
        const familyToTop = {};
        languages.forEach(l => {
            if (l.family && l.top_level_family && !familyToTop[l.family]) {
                familyToTop[l.family] = l.top_level_family;
            }
        });
        const colorMap = spreadColorsGrouped(families, familyToTop, topHueMap);
        const sortedKeys = Object.keys(colorMap).sort((a, b) =>
            (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
        );
        return {
            mode,
            modeLabel: 'by Subfamily',
            colorOf: (l) => (l.family && colorMap[l.family]) || NULL_COLOR,
            labelOf: (l) => l.family || NULL_LABEL,
            entries: sortedKeys.map(key => ({ key, color: colorMap[key] })),
        };
    }

    // mode === 'group'
    const groups = [...new Set(languages.map(l => l.grp).filter(Boolean))];
    const groupToTop = {};
    languages.forEach(l => {
        if (l.grp && l.top_level_family && !groupToTop[l.grp]) {
            groupToTop[l.grp] = l.top_level_family;
        }
    });
    const colorMap = spreadColorsGrouped(groups, groupToTop, topHueMap);
    const sortedKeys = Object.keys(colorMap).sort((a, b) =>
        (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' })
    );
    return {
        mode,
        modeLabel: 'by Group',
        colorOf: (l) => (l.grp && colorMap[l.grp]) || NULL_COLOR,
        labelOf: (l) => l.grp || NULL_LABEL,
        entries: sortedKeys.map(key => ({ key, color: colorMap[key] })),
    };
}

function LanguageMap({ languages, filters, allTopFamilies }, ref) {
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

    // Esporto exportPng al parent: cattura i canvas OL renderizzati, li fonde
    // su un canvas finale e disegna sotto la legenda (titolo + cerchi colorati
    // + label + count) con wrapping orizzontale. Ricalca l'esempio ufficiale di
    // OpenLayers (https://openlayers.org/en/latest/examples/export-map.html).
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

                    // ===== Layout legenda =====
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
                    const entryW = entries.map(({ key }) => {
                        const text = `${key} (${counts[key] || 0})`;
                        return CIRCLE_R * 2 + CIRCLE_TEXT_GAP + measureCtx.measureText(text).width;
                    });

                    const maxRow = mapW - 2 * PAD;
                    let rows = entries.length === 0 ? 1 : 1;
                    let rowW = 0;
                    entryW.forEach(w => {
                        const candidate = rowW === 0 ? w : rowW + ENTRY_GAP_X + w;
                        if (rowW > 0 && candidate > maxRow) {
                            rows++;
                            rowW = w;
                        } else {
                            rowW = candidate;
                        }
                    });

                    const legendH = PAD + TITLE_H + TITLE_GAP + rows * ROW_H + PAD;
                    const totalH = mapH + legendH;

                    const out = document.createElement('canvas');
                    out.width = mapW;
                    out.height = totalH;
                    const ctx = out.getContext('2d');

                    // sfondo bianco totale
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, mapW, totalH);

                    // ===== Mappa =====
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

                        const bg = canvas.parentNode?.style.backgroundColor;
                        if (bg) {
                            ctx.fillStyle = bg;
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                        }
                        ctx.drawImage(canvas, 0, 0);
                    });
                    ctx.globalAlpha = 1;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);

                    // ===== Legenda =====
                    const legendY = mapH;
                    // separatore
                    ctx.fillStyle = '#e5e7eb';
                    ctx.fillRect(0, legendY, mapW, 1);

                    // titolo
                    ctx.fillStyle = '#6b7280';
                    ctx.font = TITLE_FONT;
                    ctx.textBaseline = 'top';
                    const titleText = plan
                        ? `Coloring ${plan.modeLabel}`.toUpperCase()
                        : 'COLORING';
                    ctx.fillText(titleText, PAD, legendY + PAD);

                    // voci
                    ctx.font = ENTRY_FONT;
                    ctx.textBaseline = 'middle';
                    let cx = PAD;
                    let cy = legendY + PAD + TITLE_H + TITLE_GAP;

                    if (entries.length === 0) {
                        ctx.fillStyle = '#9ca3af';
                        ctx.fillText('No data to display.', PAD, cy + ROW_H / 2);
                    } else {
                        entries.forEach(({ key, color }, i) => {
                            const w = entryW[i];
                            if (cx > PAD && cx + w > mapW - PAD) {
                                cx = PAD;
                                cy += ROW_H;
                            }
                            const centerY = cy + ROW_H / 2;
                            // cerchio
                            ctx.fillStyle = color;
                            ctx.beginPath();
                            ctx.arc(cx + CIRCLE_R, centerY, CIRCLE_R, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                            ctx.lineWidth = 1;
                            ctx.stroke();
                            // testo
                            ctx.fillStyle = '#111827';
                            const text = `${key} (${counts[key] || 0})`;
                            ctx.fillText(text, cx + CIRCLE_R * 2 + CIRCLE_TEXT_GAP, centerY);
                            cx += w + ENTRY_GAP_X;
                        });
                    }
                    ctx.textBaseline = 'alphabetic';

                    out.toBlob(blob => {
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

    // Tieni i ref allineati: exportPng vive in un useImperativeHandle con deps
    // vuote e legge plan/counts via ref per non dover ricreare il handle.
    useEffect(() => { planRef.current = plan; }, [plan]);
    useEffect(() => { countsRef.current = counts; }, [counts]);

    // init map once
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

export default forwardRef(LanguageMap);
