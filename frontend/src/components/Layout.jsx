import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

const THEME_STORAGE_KEY = 'pcm-theme';

function getInitialTheme() {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

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

    return (
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

                        {/* Voci visibili a Admin e Standard User */}
                        {role !== 'public' && (
                            <>
                                <li><Link className={`btn ${isCurrent('/languages')}`} to="/languages">Languages</Link></li>
                                <li><Link className={`btn ${isCurrent('/instructions')}`} to="/instructions">Instructions</Link></li>
                                <li><Link className={`btn ${isCurrent('/glossary')}`} to="/glossary">Glossary</Link></li>
                            </>
                        )}

                        {/* Strumenti esclusivi per Admin */}
                        {role === 'admin' && (
                            <>
                                <li className="nav-divider-label">Admin Tools</li>
                                <li><Link className={`btn ${isCurrent('/admin/parameters')}`} to="/admin/parameters">Parameters</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/questions')}`} to="/admin/questions">Questions</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/motivations')}`} to="/admin/motivations">Motivations</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/taxonomy')}`} to="/admin/taxonomy">Taxonomy</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/accounts')}`} to="/admin/accounts">Accounts</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/history') || isCurrent('/admin/backups')}`} to="/admin/history">History & Backups</Link></li>
                                <li><Link className={`btn ${isCurrent('/tablea')}`} to="/tablea">Table A</Link></li>
                                <li><Link className={`btn ${isCurrent('/queries')}`} to="/queries">Filters</Link></li>
                            </>
                        )}
                    </ul>
                </nav>
            </aside>

            <div className="main-layout">
                {/* TOP BAR */}
                <header className="top-bar">
                    <div className="top-bar-left">
                        <span className="muted">PCM Hub / {name}</span>
                    </div>
                    <div className="top-bar-right">
                        <Link to="/me" className="btn" style={{background: 'transparent', border: 'none', fontWeight: 'bold'}}>
                            MyAccount
                        </Link>
                        <span className="role-badge">{role} Access</span>
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
    );
}