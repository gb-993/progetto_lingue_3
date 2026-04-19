import { useState } from 'react';

export default function Dashboard() {
    const [user] = useState({ name: localStorage.getItem('name'), role: localStorage.getItem('role') });

    return (
        <>
            <header className="dashboard-hero">
                <h1>Welcome, {user.name}</h1>
                <p className="muted dashboard-copy">Here is your PCM Hub overview.</p>
            </header>

            {user.role === 'admin' ? (
                <div className="dashboard-columns">
                    <div className="stats-grid">
                        <div className="card stat-card">
                            <h3 className="stat-label">Pending Approvals</h3>
                            <div className="stat-value">0</div>
                        </div>
                        <div className="card stat-card">
                            <h3 className="stat-label">Languages Completed</h3>
                            <div className="stat-value">0 / 90</div>
                        </div>
                    </div>
                    <section className="card dashboard-section">
                        <h3>Latest Changes</h3>
                        <p className="muted">No recent changes.</p>
                    </section>
                </div>
            ) : (
                <section className="card dashboard-section">
                    <h3>Your assigned languages</h3>
                    <div className="card muted">No languages assigned yet.</div>
                </section>
            )}
        </>
    );
}