import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

export default function LanguageList() {
    const [languages, setLanguages] = useState([]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        const fetchLangs = async () => {
            const res = await axios.get(`http://localhost:8000/api/languages?q=${search}`);
            setLanguages(res.data);
        };
        fetchLangs();
    }, [search]);

    return (
        <div className="container">
            <header className="dashboard-hero">
                <h1>Languages</h1>
            </header>

            <section className="toolbar">
                <div className="toolbar__form">
                    <input
                        type="search"
                        placeholder="Search languages..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="toolbar__add">
                    <Link to="/languages/add" className="btn btn--primary">Add Language</Link>
                </div>
            </section>

            <div className="card" style={{padding: 0, overflow: 'hidden'}}>
                <table className="table">
                    <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Family</th>
                        <th>Geography</th>
                        <th style={{textAlign: 'right'}}>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                    {languages.map(lang => (
                        <tr key={lang.id}>
                            <td style={{fontWeight: 'bold'}}>{lang.id}</td>
                            <td>{lang.name_full}</td>
                            <td className="muted">{lang.family}</td>
                            <td className="small">
                                {lang.latitude ? `${lang.latitude}, ${lang.longitude}` : "No coords"}
                            </td>
                            <td className="row-actions">
                                <Link to={`/languages/${lang.id}/data`} className="btn">Data</Link>
                                <Link to={`/languages/${lang.id}/edit`} className="btn">Edit</Link>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}