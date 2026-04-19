import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

export default function Layout({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const role = localStorage.getItem('role');
    const name = localStorage.getItem('name');

    const handleLogout = () => {
        localStorage.clear();
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

                        {role === 'admin' && (
                            <>
                                <li className="nav-divider-label">Admin Tools</li>
                                <li><Link className={`btn ${isCurrent('/languages')}`} to="/languages">Languages</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/parameters')}`} to="/admin/parameters">Parameters</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/questions')}`} to="/admin/questions">Questions</Link></li>
                                <li><Link className={`btn ${isCurrent('/admin/glossary')}`} to="/admin/glossary">Glossary</Link></li>
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
                        <span className="role-badge">{role} Access</span>
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