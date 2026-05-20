import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
    LayoutDashboard, Quote, Languages, SlidersHorizontal, HelpCircle,
    MessageSquareQuote, Network, Table, Filter, Users, History,
    DatabaseZap, Upload, BookOpen, BookA, PanelLeftClose, PanelLeftOpen, Workflow,
    FileText, BookMarked,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

const THEME_STORAGE_KEY = 'pcm-theme';
const SIDEBAR_COLLAPSED_KEY = 'pcm-sidebar-collapsed';

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
    'manual': 'Manual',
    'glossary': 'Glossary',
    'how-to-cite': 'How to cite',
    'me': 'My Account',
    'parameters': 'Parameters',
    'graph': 'Graph',
    'questions': 'Questions',
    'motivations': 'Motivations',
    'taxonomy': 'Taxonomy',
    'accounts': 'Accounts',
    'history': 'History & Backups',
    'backups': 'History & Backups',
    'migration-import': 'Migration Import',
    'backup-restore': 'Backup Restore',
    'legal-documents': 'Legal Documents',
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
export function SiteFooter({ role }) {
    const year = new Date().getFullYear();
    const roleLabel =
        role === 'admin' ? 'Admin Access'
        : role === 'public' ? 'Public View'
        : 'User Access';

    // Versioni correnti di ToU e Privacy Notice (caricate via UI admin).
    // I link "Privacy Policy" / "Disclaimer" puntano sempre all'ultima
    // versione pubblicata invece di un PDF statico hardcoded. L'endpoint
    // /api/legal-documents/current e' pubblico (no auth) e whitelistato
    // nel consent enforcement, quindi funziona anche per visitatori non
    // loggati e per utenti loggati ma non ancora in regola con i consensi.
    //
    // Fallback ai PDF in /docs/ (versione "v1.0" hardcoded in frontend/public)
    // se il backend non risponde o non ha ancora nessuna versione corrente:
    // meglio un link a un PDF vecchio che un link rotto.
    const [legalUrls, setLegalUrls] = useState({});
    useEffect(() => {
        let active = true;
        api.get('/api/legal-documents/current')
            .then(res => { if (active) setLegalUrls(res.data || {}); })
            .catch(() => { /* lascia legalUrls = {} -> fallback statico */ });
        return () => { active = false; };
    }, []);
    const privacyUrl = legalUrls.privacy_notice?.public_url || '/docs/Informativa%20WebAPP_revDPO.pdf';
    const termsUrl = legalUrls.terms_of_use?.public_url || '/docs/Terms_of_use_CG.pdf';

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
                                <a href={privacyUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
                                    Privacy Policy
                                </a>
                            </li>
                            <li>
                                <a href={termsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
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
                            href="http://www.parametricomparison.unimore.it"
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
                        © {year} – The PCM Hub. All rights reserved.
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
    const location = useLocation();
    const { logout: contextLogout, user } = useAuth();
    const role = localStorage.getItem('role');
    // Solo per voci sidebar "pericolose" (Migration Import, Backup Restore).
    // Backend riconosce super-admin via env var SUPER_ADMIN_EMAIL e lo
    // espone in /api/me come `is_super_admin`. Senza il flag le voci
    // restano nascoste e le rotte sono comunque protette server-side.
    const isSuperAdmin = !!user?.is_super_admin;

    const [theme, setTheme] = useState(getInitialTheme);
    const [collapsed, setCollapsed] = useState(() =>
        typeof window !== 'undefined' && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
    );

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);

    useEffect(() => {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    }, [collapsed]);

    const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
    const toggleSidebar = () => setCollapsed((c) => !c);

    const handleLogout = () => {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
        localStorage.clear();
        if (savedTheme) localStorage.setItem(THEME_STORAGE_KEY, savedTheme);
        // Delega al context: oltre a `removeItem('token')` (già coperto da
        // localStorage.clear() sopra) azzera lo stato `user` del provider e
        // ridireziona. Senza questa chiamata il context restava sporco e
        // AdminRoute (che legge dal context) poteva lasciar passare
        // un utente "logoutato" finché non veniva fatto un refresh.
        contextLogout('/');
    };

    // Helper per evidenziare il link attivo
    const isCurrent = (path) => location.pathname.startsWith(path) ? 'is-current' : '';

    const citeLabel = role === 'admin' ? 'How to cite (edit)' : 'Citation Guidelines';

    return (
        <>
            <div className={`app-wrapper${collapsed ? ' is-sidebar-collapsed' : ''}`}>
                {/* SIDEBAR */}
                <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`} id="main-sidebar">
                    <div className="sidebar-header">
                        {!collapsed && <h1 className="site-title">The PCM Hub</h1>}
                        <button
                            type="button"
                            className="sidebar-toggle"
                            onClick={toggleSidebar}
                            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                            aria-pressed={collapsed}
                        >
                            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                        </button>
                    </div>
                    <nav className="sidebar-nav">
                        <ul className="nav-list">
                            <li>
                                <Link className={`btn ${location.pathname === '/dashboard' ? 'is-current' : ''}`} to="/dashboard" title="Dashboard">
                                    <LayoutDashboard size={18} className="nav-icon" />
                                    <span className="nav-label">Dashboard</span>
                                </Link>
                            </li>

                            {/* How to cite — visibile a tutti, etichetta diversa per admin */}
                            <li>
                                <Link className={`btn ${isCurrent('/how-to-cite')}`} to="/how-to-cite" title={citeLabel}>
                                    <Quote size={18} className="nav-icon" />
                                    <span className="nav-label">{citeLabel}</span>
                                </Link>
                            </li>

                            {/* Voci per User loggati e Admin (ordine come nel vecchio base.html) */}
                            {role !== 'public' && (
                                <>
                                    <li className="nav-divider-label">Data & Tools</li>
                                    <li>
                                        <Link className={`btn ${isCurrent('/languages')}`} to="/languages" title="Languages">
                                            <Languages size={18} className="nav-icon" />
                                            <span className="nav-label">Languages</span>
                                        </Link>
                                    </li>

                                    {/* Strumenti esclusivi Admin */}
                                    {role === 'admin' && (
                                        <>
                                            <li>
                                                <Link
                                                    className={`btn ${location.pathname.startsWith('/admin/parameters') && !location.pathname.startsWith('/admin/parameters/graph') ? 'is-current' : ''}`}
                                                    to="/admin/parameters"
                                                    title="Parameters"
                                                >
                                                    <SlidersHorizontal size={18} className="nav-icon" />
                                                    <span className="nav-label">Parameters</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/parameters/graph')}`} to="/admin/parameters/graph" title="Parameters Graph">
                                                    <Workflow size={18} className="nav-icon" />
                                                    <span className="nav-label">Parameters Graph</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/questions')}`} to="/admin/questions" title="Questions">
                                                    <HelpCircle size={18} className="nav-icon" />
                                                    <span className="nav-label">Questions</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/motivations')}`} to="/admin/motivations" title="Motivations">
                                                    <MessageSquareQuote size={18} className="nav-icon" />
                                                    <span className="nav-label">Motivations</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/taxonomy')}`} to="/admin/taxonomy" title="Taxonomy">
                                                    <Network size={18} className="nav-icon" />
                                                    <span className="nav-label">Taxonomy</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/tablea')}`} to="/tablea" title="Table A">
                                                    <Table size={18} className="nav-icon" />
                                                    <span className="nav-label">Table A</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/queries')}`} to="/queries" title="Filters">
                                                    <Filter size={18} className="nav-icon" />
                                                    <span className="nav-label">Filters</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/accounts')}`} to="/admin/accounts" title="Accounts">
                                                    <Users size={18} className="nav-icon" />
                                                    <span className="nav-label">Accounts</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/history')}`} to="/admin/history" title="History & Backups">
                                                    <History size={18} className="nav-icon" />
                                                    <span className="nav-label">History & Backups</span>
                                                </Link>
                                            </li>
                                            <li>
                                                <Link className={`btn ${isCurrent('/admin/legal-documents')}`} to="/admin/legal-documents" title="Legal Documents">
                                                    <FileText size={18} className="nav-icon" />
                                                    <span className="nav-label">Legal Documents</span>
                                                </Link>
                                            </li>
                                            {/* Voci super-admin: visibili solo agli admin la
                                                cui email e' in SUPER_ADMIN_EMAIL (env backend).
                                                Operazioni distruttive sull'intero DB. */}
                                            {isSuperAdmin && (
                                                <>
                                                    <li>
                                                        <Link className={`btn ${isCurrent('/admin/migration-import')}`} to="/admin/migration-import" title="Migration Import" style={{ color: '#b91c1c' }}>
                                                            <DatabaseZap size={18} className="nav-icon" />
                                                            <span className="nav-label">Migration Import</span>
                                                        </Link>
                                                    </li>
                                                    <li>
                                                        <Link className={`btn ${isCurrent('/admin/backup-restore')}`} to="/admin/backup-restore" title="Backup Restore">
                                                            <Upload size={18} className="nav-icon" />
                                                            <span className="nav-label">Backup Restore</span>
                                                        </Link>
                                                    </li>
                                                </>
                                            )}
                                        </>
                                    )}

                                    {/* Tool comuni a User e Admin (in fondo, come nel vecchio) */}
                                    <li>
                                        <Link className={`btn ${isCurrent('/instructions')}`} to="/instructions" title="Instructions">
                                            <BookOpen size={18} className="nav-icon" />
                                            <span className="nav-label">Instructions</span>
                                        </Link>
                                    </li>
                                    <li>
                                        <Link className={`btn ${isCurrent('/manual')}`} to="/manual" title="Manual">
                                            <BookMarked size={18} className="nav-icon" />
                                            <span className="nav-label">Manual</span>
                                        </Link>
                                    </li>
                                    <li>
                                        <Link className={`btn ${isCurrent('/glossary')}`} to="/glossary" title="Glossary">
                                            <BookA size={18} className="nav-icon" />
                                            <span className="nav-label">Glossary</span>
                                        </Link>
                                    </li>
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
