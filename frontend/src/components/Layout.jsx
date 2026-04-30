import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'pcm-theme';

function getInitialTheme() {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// =============================================================================
// Breadcrumb (auto-generato dal pathname)
// =============================================================================
const PATH_LABELS = {
    'dashboard': 'Dashboard',
    'languages': 'Languages',
    'instructions': 'Instructions',
    'glossary': 'Glossary',
    'how-to-cite': 'How to cite',
    'me': 'My Account',
    'parameters': 'Parameters',
    'questions': 'Questions',
    'motivations': 'Motivations',
    'taxonomy': 'Taxonomy',
    'accounts': 'Accounts',
    'history': 'History & Backups',
    'backups': 'History & Backups',
    'migration-import': 'Migration Import',
    'import-excel': 'Import Excel',
    'edit-content': 'Edit content',
    'submissions': 'Submissions',
    'tablea': 'Table A',
    'queries': 'Filters',
    'edit': 'Edit',
    'add': 'Add',
    'data': 'Data',
    'debug': 'Debug',
    'assign': 'Assign',
    'admin': null, // segmento ignorato nel breadcrumb
};

function Breadcrumb({ pathname }) {
    // Quando siamo dentro una nested route che si presenta come drawer
    // (es. /admin/parameters/P12/edit/questions/P12_Qa/edit), il breadcrumb
    // deve riflettere la pagina di contesto (il parametro), non l'overlay
    // temporaneo. Tronchiamo il pathname al segmento parent.
    const drawerMatch = pathname.match(
        /^(\/admin\/parameters\/[^/]+\/edit)\/questions\b/
    );
    const effectivePath = drawerMatch ? drawerMatch[1] : pathname;

    const segments = effectivePath.split('/').filter(Boolean);
    const crumbs = [{ to: '/dashboard', label: 'Dashboard', clickable: true }];
    let acc = '';

    segments.forEach((seg) => {
        acc += '/' + seg;
        if (seg === 'dashboard') return;
        const mapped = PATH_LABELS[seg];
        if (mapped === null) return; // segmenti da nascondere (es. "admin")
        // Se il segmento non è nel dizionario, è un ID dinamico (es. P12,
        // P12_Qa, uuid di una lingua): mostrato letterale ma NON cliccabile,
        // perché la rotta `/admin/parameters/P12` da sola non esiste — solo
        // `/admin/parameters/P12/edit`. Cliccarlo porterebbe a una 404.
        const isDynamic = mapped === undefined;
        const label = mapped || seg;
        crumbs.push({ to: acc, label, clickable: !isDynamic });
    });

    return (
        <nav className="breadcrumb" aria-label="Breadcrumb">
            <ol>
                {crumbs.map((c, i) => {
                    const isLast = i === crumbs.length - 1;
                    return (
                        <li key={c.to + i}>
                            {(!isLast && c.clickable)
                                ? <Link to={c.to}>{c.label}</Link>
                                : <span>{c.label}</span>}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}

// =============================================================================
// Back-to-top button
// =============================================================================
function BackToTop() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const onScroll = () => setVisible(window.scrollY > 400);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    if (!visible) return null;

    return (
        <button
            type="button"
            className="back-to-top"
            aria-label="Back to top"
            title="Back to top"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
            ↑
        </button>
    );
}

// =============================================================================
// Footer
// =============================================================================
function SiteFooter({ role }) {
    const year = new Date().getFullYear();
    const roleLabel =
        role === 'admin' ? 'Admin Access'
        : role === 'public' ? 'Public View'
        : 'User Access';

    return (
        <footer className="site-footer" role="contentinfo">
            <div className="footer-container">
                <div className="footer-grid">

                    <div className="footer-col">
                        <h4>The PCM Hub</h4>
                        <p className="muted muted-text">
                            The Hub of the <strong>Parametric Comparison Method</strong> collects and organizes syntactic data from natural languages.
                        </p>
                        <div className="footer-license">
                            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
                                <img
                                    src="https://licensebuttons.net/l/by/4.0/88x31.png"
                                    alt="CC BY 4.0"
                                    style={{ height: '31px', borderRadius: '3px', opacity: 0.8 }}
                                />
                            </a>
                            <span className="muted" style={{ fontSize: '0.75rem', lineHeight: 1.2 }}>
                                Licensed under <br />
                                <a
                                    href="https://creativecommons.org/licenses/by/4.0/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'underline' }}
                                >
                                    CC BY 4.0 International
                                </a>
                            </span>
                        </div>
                    </div>

                    <div className="footer-col">
                        <h4>Resources</h4>
                        <ul className="footer-links">
                            <li>
                                <a href="/docs/Informativa%20WebAPP_revDPO.pdf" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
                                    Privacy Policy
                                </a>
                            </li>
                            <li>
                                <a href="/docs/Terms_of_use_CG.pdf" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
                                    Disclaimer
                                </a>
                            </li>
                            <li style={{ marginTop: '0.5rem' }}>
                                <span className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.2rem' }}>
                                    Get in touch:
                                </span>
                                <a href="mailto:pcm_lab@unimore.it" style={{ color: 'var(--text)', fontWeight: 500 }}>
                                    pcm_lab@unimore.it
                                </a>
                            </li>
                        </ul>
                    </div>

                    <div className="footer-col footer-parent-project">
                        <h4>Parent Project</h4>
                        <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
                            DHisGram - Syntax out of Africa. Deep history through human grammars.
                        </p>
                        <a
                            href="http://www.parametricomparison.unimore.it/site/home.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="footer-btn"
                        >
                            Visit the PCM website →
                        </a>
                    </div>

                </div>

                <div className="footer-bottom">
                    <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                        © {year} – The PCM Hub Database. All rights reserved.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span className="role-badge">{roleLabel}</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}

// =============================================================================
// Layout
// =============================================================================
export default function Layout({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const role = localStorage.getItem('role');
    const name = localStorage.getItem('name');

    const [theme, setTheme] = useState(getInitialTheme);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);

    const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

    const handleLogout = () => {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        localStorage.clear();
        if (savedTheme) localStorage.setItem(THEME_STORAGE_KEY, savedTheme);
        navigate('/');
    };

    // Helper per evidenziare il link attivo
    const isCurrent = (path) => location.pathname.startsWith(path) ? 'is-current' : '';

    const citeLabel = role === 'admin' ? 'How to cite (edit)' : 'Citation Guidelines';

    return (
        <>
            <div className="app-wrapper">
                {/* SIDEBAR */}
                <aside className="sidebar" id="main-sidebar">
                    <div className="sidebar-header">
                        <h1 className="site-title">The PCM Hub</h1>
                    </div>
                    <nav className="sidebar-nav">
                        <ul className="nav-list">
                            <li>
                                <Link className={`btn ${location.pathname === '/dashboard' ? 'is-current' : ''}`} to="/dashboard">
                                    Dashboard
                                </Link>
                            </li>

                            {/* How to cite — visibile a tutti, etichetta diversa per admin */}
                            <li>
                                <Link className={`btn ${isCurrent('/how-to-cite')}`} to="/how-to-cite">
                                    {citeLabel}
                                </Link>
                            </li>

                            {/* Voci per User loggati e Admin (ordine come nel vecchio base.html) */}
                            {role !== 'public' && (
                                <>
                                    <li className="nav-divider-label">Data & Tools</li>
                                    <li><Link className={`btn ${isCurrent('/languages')}`} to="/languages">Languages</Link></li>

                                    {/* Strumenti esclusivi Admin */}
                                    {role === 'admin' && (
                                        <>
                                            <li><Link className={`btn ${isCurrent('/admin/parameters')}`} to="/admin/parameters">Parameters</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/questions')}`} to="/admin/questions">Questions</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/motivations')}`} to="/admin/motivations">Motivations</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/taxonomy')}`} to="/admin/taxonomy">Taxonomy</Link></li>
                                            <li><Link className={`btn ${isCurrent('/tablea')}`} to="/tablea">Table A</Link></li>
                                            <li><Link className={`btn ${isCurrent('/queries')}`} to="/queries">Filters</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/accounts')}`} to="/admin/accounts">Accounts</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/history')}`} to="/admin/history">History & Backups</Link></li>
                                            <li><Link className={`btn ${isCurrent('/admin/migration-import')}`} to="/admin/migration-import" style={{ color: '#b91c1c' }}>Migration Import</Link></li>
                                        </>
                                    )}

                                    {/* Tool comuni a User e Admin (in fondo, come nel vecchio) */}
                                    <li><Link className={`btn ${isCurrent('/instructions')}`} to="/instructions">Instructions</Link></li>
                                    <li><Link className={`btn ${isCurrent('/glossary')}`} to="/glossary">Glossary</Link></li>
                                </>
                            )}
                        </ul>
                    </nav>
                </aside>

                <div className="main-layout">
                    {/* TOP BAR */}
                    <header className="top-bar">
                        <div className="top-bar-left">
                            <Breadcrumb pathname={location.pathname} />
                        </div>
                        <div className="top-bar-right">
                            <Link to="/me" className="btn" style={{ background: 'transparent', border: 'none', fontWeight: 'bold', textDecoration: 'underline' }}>
                                MyAccount
                            </Link>
                            <button
                                type="button"
                                className="theme-toggle"
                                onClick={toggleTheme}
                                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                                aria-pressed={theme === 'dark'}
                            >
                                {theme === 'dark' ? (
                                    <svg className="theme-toggle__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="12" r="4" />
                                        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                                    </svg>
                                ) : (
                                    <svg className="theme-toggle__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                                    </svg>
                                )}
                                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                            </button>
                            <button className="btn" onClick={handleLogout}>Logout</button>
                        </div>
                    </header>

                    <main id="main">
                        <div className="main-container">
                            {children}
                        </div>
                    </main>
                </div>
            </div>

            <SiteFooter role={role} />
            <BackToTop />
        </>
    );
}
