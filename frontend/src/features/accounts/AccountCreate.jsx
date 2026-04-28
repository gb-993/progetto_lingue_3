import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function AccountCreate() {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '', surname: '', email: '', password: '', role: 'user'
    });
    const [error, setError] = useState('');

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/api/admin/accounts', formData);
            navigate('/admin/accounts');
        } catch (err) {
            setError(err.response?.data?.detail || 'Error while creating the account.');
        }
    };

    return (
        <div className="container" style={{ maxWidth: '600px', marginTop: '2rem' }}>
            <div className="card">
                <header style={{ marginBottom: '1.5rem' }}><h2>Create New Account</h2></header>
                {error && <div className="alert alert-error mb-1">{error}</div>}

                <form onSubmit={handleSubmit} className="grid grid-2">
                    <div className="form-group">
                        <label>Name</label>
                        <input type="text" name="name" value={formData.name} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>Surname</label>
                        <input type="text" name="surname" value={formData.surname} onChange={handleChange} required />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label>Email</label>
                        <input type="email" name="email" value={formData.email} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>Temporary Password: "password"</label>
                        <input type="password" name="password" value={formData.password} onChange={handleChange} required />
                    </div>
                    <div className="form-group">
                        <label>Role</label>
                        <select name="role" value={formData.role} onChange={handleChange}>
                            <option value="user">Standard User</option>
                            <option value="admin">Administrator</option>
                            <option value="public">Public User</option>
                        </select>
                    </div>
                    <div className="toolbar" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end', marginTop: '1rem' }}>
                        <Link to="/admin/accounts" className="btn">Cancel</Link>
                        <button type="submit" className="btn btn--primary">Create Account</button>
                    </div>
                </form>
            </div>
        </div>
    );
}