import { useEffect } from 'react';

// Scheda PCM-style condivisa fra le pagine di errore React (NotFound 404 e
// ErrorBoundary crash JS). Layout "hero": icona tonda brand + titolo grande
// + frase muted + 1 bottone primario + 1 ghost link.
//
// Le pagine statiche frontend/public/404.html e maintenance.html replicano
// lo stesso layout in HTML+CSS inline perche' devono renderizzare anche
// quando il bundle React non e' raggiungibile (network down, build rotta,
// service worker che serve un fallback). Tenerle allineate.
export default function ErrorCard({
    icon,
    title,
    description,
    primaryAction,
    ghostLink,
    pageTitle,
}) {
    useEffect(() => {
        const prev = document.title;
        document.title = `${pageTitle || title} | PCM Hub`;
        return () => { document.title = prev; };
    }, [pageTitle, title]);

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
            <header
                style={{
                    maxWidth: '920px',
                    width: '100%',
                    marginBottom: '2rem',
                    fontSize: '0.95rem',
                    color: 'var(--text-muted)',
                    letterSpacing: '0.01em',
                    textAlign: 'center',
                }}
            >
                <strong style={{ color: 'var(--text)', fontWeight: 700 }}>PCM Hub</strong>
            </header>

            <section
                style={{
                    maxWidth: '560px',
                    width: '100%',
                    textAlign: 'center',
                    margin: 'auto 0',
                }}
            >
                <div
                    aria-hidden="true"
                    style={{
                        width: '96px',
                        height: '96px',
                        margin: '0 auto 1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'color-mix(in oklab, var(--brand) 15%, transparent)',
                        borderRadius: '50%',
                        color: 'var(--brand)',
                    }}
                >
                    {icon}
                </div>

                <h1
                    style={{
                        margin: '0 0 0.75rem',
                        fontSize: '2.5rem',
                        fontWeight: 700,
                        lineHeight: 1.1,
                        color: 'var(--text)',
                    }}
                >
                    {title}
                </h1>

                <p
                    style={{
                        margin: '0 auto 2.25rem',
                        maxWidth: '420px',
                        color: 'var(--text-muted)',
                        fontSize: '1.1rem',
                        lineHeight: 1.55,
                    }}
                >
                    {description}
                </p>

                {primaryAction && (
                    <button
                        type="button"
                        onClick={primaryAction.onClick}
                        style={{
                            display: 'inline-block',
                            padding: '0.9rem 2rem',
                            background: 'var(--brand)',
                            color: '#fff',
                            border: '1px solid color-mix(in oklab, var(--brand) 75%, black)',
                            borderRadius: '10px',
                            font: 'inherit',
                            fontSize: '1.05rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        {primaryAction.label}
                    </button>
                )}

                {ghostLink && (
                    <button
                        type="button"
                        onClick={ghostLink.onClick}
                        style={{
                            display: 'block',
                            margin: '1.25rem auto 0',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            font: 'inherit',
                            fontSize: '0.9rem',
                            textDecoration: 'none',
                            cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = 'var(--brand)';
                            e.currentTarget.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = 'var(--text-muted)';
                            e.currentTarget.style.textDecoration = 'none';
                        }}
                    >
                        {ghostLink.label}
                    </button>
                )}
            </section>
        </main>
    );
}
