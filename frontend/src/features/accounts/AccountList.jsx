import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function AccountList() {
    const [users, setUsers] = useState([]);
    const [search, setSearch] = useState('');

    const fetchUsers = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await axios.get('http://localhost:8000/api/admin/accounts', {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(res.data);
        } catch (error) {
            console.error("Errore nel recupero degli account:", error);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleDelete = async (userId) => {
        if (!window.confirm("Sei sicuro di voler eliminare questo account? L'azione è irreversibile.")) return;
        try {
            const token = localStorage.getItem('token');
            await axios.delete(`http://localhost:8000/api/admin/accounts/${userId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchUsers();
        } catch (error) {
            alert(error.response?.data?.detail || "Errore durante l'eliminazione");
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

                            {/* COLONNA LINGUE MODIFICATA */}
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

            <section className="toolbar">
                <div className="toolbar__form">
                    <input type="search" placeholder="Cerca un utente..." value={search} onChange={(e) => setSearch(e.target.value)} />
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