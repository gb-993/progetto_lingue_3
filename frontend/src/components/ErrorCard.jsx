import { useEffect } from 'react';

const labelStyle = {
    fontSize: '0.75rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--text-muted)',
    paddingTop: '0.4rem',
};

const rowStyle = {
    display: 'grid',
    gridTemplateColumns: '9.5rem 1fr',
    columnGap: '1rem',
    alignItems: 'start',
    padding: '0.6rem 0',
};

// Scheda PCM-style condivisa fra ErrorBoundary (crash JS) e NotFound (404 SPA).
// Le pagine statiche frontend/public/maintenance.html e 404.html replicano
// lo stesso layout in HTML+CSS inline perche' devono renderizzare anche
// quando il bundle React non e' raggiungibile.
export default function ErrorCard({
    code,
    description,
    question,
    motivations = [],
    primaryAction,
    secondaryAction,
    footerText,
}) {
    useEffect(() => {
        const prev = document.title;
        document.title = `${code} - ${description} | PCM Hub`;
        return () => { document.title = prev; };
    }, [code, description]);

    return (
        <main
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '3rem 1.5rem',
                minHeight: '100dvh',
                background: 'var(--bg)',
            }}
        >
            <header style={{ maxWidth: '760px', width: '100%', marginBottom: '1.25rem' }}>
                <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 500, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
                    <strong style={{ color: 'var(--text)', fontWeight: 700 }}>PCM Hub</strong>
                    {' · '}{description.toLowerCase()}
                </h1>
            </header>

            <section
                className="card"
                style={{
                    maxWidth: '760px',
                    width: '100%',
                    padding: '1.5rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow)',
                }}
            >
                <div
                    style={{
                        borderLeft: '3px solid var(--brand)',
                        paddingLeft: '0.85rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        marginBottom: '1.5rem',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--brand)', fontSize: '1.1rem', fontWeight: 700 }}>{code}</span>
                        <span style={{ color: 'var(--brand)', fontSize: '0.95rem', fontWeight: 600 }}>{description}</span>
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.45 }}>{question}</div>
                </div>

                <div style={rowStyle}>
                    <div style={labelStyle}>Answer</div>
                    <div>
                        <select
                            disabled
                            value="NO"
                            onChange={() => {}}
                            style={{
                                padding: '0.6rem',
                                width: '100%',
                                maxWidth: '300px',
                                borderRadius: '4px',
                                border: '1px solid var(--border)',
                                background: 'var(--surface)',
                                color: 'var(--text)',
                                font: 'inherit',
                                fontSize: '1rem',
                            }}
                        >
                            <option value="NO">NO</option>
                        </select>
                    </div>
                </div>

                {motivations.length > 0 && (
                    <div style={rowStyle}>
                        <div style={labelStyle}>Motivations</div>
                        <div>
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem',
                                    background: 'var(--surface-2)',
                                    padding: '1rem',
                                    borderRadius: '6px',
                                }}
                            >
                                {motivations.map((m, i) => (
                                    <label key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input type="checkbox" checked disabled readOnly style={{ accentColor: 'var(--brand)' }} />
                                        <strong>{m}</strong>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {(primaryAction || secondaryAction) && (
                    <div
                        style={{
                            marginTop: '2rem',
                            padding: '0.85rem 1rem',
                            border: '1px solid var(--border)',
                            borderRadius: '12px',
                            background: 'var(--surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.6rem',
                            width: 'fit-content',
                            maxWidth: '100%',
                            marginLeft: 'auto',
                        }}
                    >
                        {primaryAction && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <span>{primaryAction.context}</span>
                                <button
                                    type="button"
                                    onClick={primaryAction.onClick}
                                    style={{
                                        minWidth: '180px',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '10px',
                                        border: '1px solid #15803d',
                                        background: '#16a34a',
                                        color: '#fff',
                                        font: 'inherit',
                                        fontSize: '0.95rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {primaryAction.label}
                                </button>
                            </div>
                        )}
                        {secondaryAction && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <span>{secondaryAction.context}</span>
                                <button
                                    type="button"
                                    onClick={secondaryAction.onClick}
                                    style={{
                                        minWidth: '180px',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '10px',
                                        border: '1px solid color-mix(in oklab, var(--brand) 75%, black)',
                                        background: 'var(--brand)',
                                        color: '#fff',
                                        font: 'inherit',
                                        fontSize: '0.95rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {secondaryAction.label}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {footerText && (
                <footer
                    style={{
                        maxWidth: '760px',
                        width: '100%',
                        marginTop: '1rem',
                        color: 'var(--text-muted)',
                        fontSize: '0.85rem',
                        textAlign: 'center',
                    }}
                >
                    {footerText}
                </footer>
            )}
        </main>
    );
}
