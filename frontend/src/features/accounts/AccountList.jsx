import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function AccountList() {
    const [users, setUsers] = useState([]);
    const [search, setSearch] = useState('');

    const fetchUsers = async () => {
        try {
            const res = await api.get('/api/admin/accounts');
            setUsers(res.data);
        } catch (error) {
            console.error("Errore nel recupero degli account:", error);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleDelete = async (userId) => {
        if (!window.confirm("Are you sure you want to delete this account? The action is irreversible.")) return;
        try {
            await api.delete(`/api/admin/accounts/${userId}`);
            fetchUsers();
        } catch (error) {
            alert(error.response?.data?.detail || "Error during deletion");
        }
    };

    const filteredUsers = users.filter(u =>
        (u.email && u.email.toLowerCase().includes(search.toLowerCase())) ||
        (u.name && u.name.toLowerCase().includes(search.toLowerCase())) ||
        (u.surname && u.surname.toLowerCase().includes(search.toLowerCase()))
    );

    const admins = filteredUsers.filter(u => u.role === 'admin');
    const standardUsers = filteredUsers.filter(u => u.role === 'user');
    const publicUsers = filteredUsers.filter(u => u.role === 'public');

    const renderTable = (userList, title, showAssignBtn = false) => (
        <div style={{marginBottom: '2rem'}}>
            <h3>{title}</h3>
            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Languages</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {userList.map(u => (
                        <tr key={u.id}>
                            <td>{u.email}</td>
                            <td>{u.name} {u.surname}</td>

                            <td>
                                {u.role === 'admin' ? (
                                    <span className="badge">All</span>
                                ) : u.assigned_languages.length > 0 ? (
                                    <details>
                                        <summary style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--brand)' }}>
                                            {u.assigned_languages.length} assigned
                                        </summary>
                                        <ul style={{ margin: '0.5rem 0 0 1rem', padding: 0, color: 'var(--text-muted)' }}>
                                            {u.assigned_languages.map(langId => (
                                                <li key={langId}>{langId}</li>
                                            ))}
                                        </ul>
                                    </details>
                                ) : (
                                    <span className="muted">None</span>
                                )}
                            </td>

                            <td className="row-actions">
                                {showAssignBtn && (
                                    <Link to={`/admin/accounts/${u.id}/assign`} className="btn">Assign Langs</Link>
                                )}
                                <button onClick={() => handleDelete(u.id)} className="btn btn--danger" style={{color: 'red'}}>Delete</button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Accounts</h1>
            </header>

            <section className="toolbar" style={{
                position: 'sticky',
                top: '5rem',
                zIndex: 10,
                background: 'color-mix(in oklab, var(--surface) 75%, transparent)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                padding: '0.85rem 1rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                marginBottom: '1rem',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: '1rem',
            }}>
                <div className="toolbar__form" style={{ maxWidth: 'none', width: '100%' }}>
                    <input type="search" placeholder="Search a user..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="toolbar__add">
                    <Link to="/admin/accounts/add" className="btn btn--primary">Add Account</Link>
                </div>
            </section>

            {renderTable(admins, "Administrators", false)}
            {renderTable(standardUsers, "Users", true)}
            {renderTable(publicUsers, "Public Users", false)}
        </div>
    );
}