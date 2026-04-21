import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function ParameterList() {
    const [parameters, setParameters] = useState([]);
    const [search, setSearch] = useState('');

    const fetchParameters = async () => {
        try {
            const res = await api.get('/api/admin/parameters');
            setParameters(res.data);
        } catch (error) {
            console.error("Errore nel recupero dei parametri", error);
        }
    };

    useEffect(() => {
        fetchParameters();
    }, []);

    const filteredParams = parameters.filter(param =>
        param.name.toLowerCase().includes(search.toLowerCase()) ||
        param.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Parameter Management</h1>
                <p className="muted dashboard-copy">Gestione dei parametri sintattici (Admin)</p>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input
                        type="search"
                        placeholder="Cerca per ID o nome..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="toolbar__add">
                    <Link to="/admin/parameters/add" className="btn btn--primary">Add Parameter</Link>
                </div>
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Pos</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {filteredParams.map(param => (
                        <tr key={param.id} style={{ opacity: param.is_active ? 1 : 0.5 }}>
                            <td style={{fontWeight: 'bold'}}>{param.id}</td>
                            <td>{param.position}</td>
                            <td>{param.name} {param.is_active ? '' : '(Inattivo)'}</td>
                            <td><span className="badge">{param.param_type}</span></td>
                            <td className="row-actions">
                                <Link to={`/admin/parameters/${param.id}/edit`} className="btn">Edit</Link>
                            </td>
                        </tr>
                    ))}
                    {filteredParams.length === 0 && (
                        <tr>
                            <td colSpan="5" style={{textAlign: 'center', padding: '2rem'}}>Nessun parametro trovato.</td>
                        </tr>
                    )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}