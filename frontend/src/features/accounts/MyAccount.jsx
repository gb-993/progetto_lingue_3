import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function MyAccount() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState({ name: '', surname: '', email: '' });
    const [passwords, setPasswords] = useState({ old_password: '', new_password1: '', new_password2: '' });
    const [message, setMessage] = useState({ text: '', type: '' });

    useEffect(() => {
        const fetchMe = async () => {
            try {
                const token = localStorage.getItem('token');
                const res = await axios.get('http://localhost:8000/api/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setProfile({ name: res.data.name || '', surname: res.data.surname || '', email: res.data.email || '' });
            } catch (err) {
                console.error(err);
            }
        };
        fetchMe();
    }, []);

    const handleProfileChange = (e) => setProfile({ ...profile, [e.target.name]: e.target.value });
    const handlePasswordChange = (e) => setPasswords({ ...passwords, [e.target.name]: e.target.value });

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('token');
            const res = await axios.put('http://localhost:8000/api/me', profile, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setMessage({ text: res.data.detail, type: 'success' });
            // Aggiorna il nome nel localStorage se è cambiato
            localStorage.setItem('name', profile.name);
        } catch (err) {
            setMessage({ text: err.response?.data?.detail || 'Errore aggiornamento profilo', type: 'error' });
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        try {
            const token = localStorage.getItem('token');
            const res = await axios.put('http://localhost:8000/api/me/password', passwords, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setMessage({ text: res.data.detail, type: 'success' });
            setPasswords({ old_password: '', new_password1: '', new_password2: '' });
        } catch (err) {
            setMessage({ text: err.response?.data?.detail || 'Errore aggiornamento password', type: 'error' });
        }
    };

    return (
        <div className="container" style={{maxWidth: '800px', marginTop: '2rem'}}>
            <header style={{marginBottom: '1.5rem'}}>
                <h1>My Account</h1>
            </header>

            {message.text && (
                <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`} style={{marginBottom: '1rem'}}>
                    {message.text}
                </div>
            )}

            <div className="card" style={{marginBottom: '2rem'}}>
                <h3 className="mb-2">Profile</h3>
                <form onSubmit={handleProfileSubmit} className="grid grid-2">
                    <div className="form-group">
                        <label>Name</label>
                        <input type="text" name="name" value={profile.name} onChange={handleProfileChange} required />
                    </div>
                    <div className="form-group">
                        <label>Surname</label>
                        <input type="text" name="surname" value={profile.surname} onChange={handleProfileChange} required />
                    </div>
                    <div className="form-group">
                        <label>Email</label>
                        <input type="email" name="email" value={profile.email} onChange={handleProfileChange} required />
                    </div>
                    <div className="toolbar" style={{gridColumn: '1 / -1', justifyContent: 'flex-end', marginTop: '1rem'}}>
                        <button type="submit" className="btn btn--primary">Save Profile</button>
                    </div>
                </form>
            </div>

            <div className="card">
                <h3 className="mb-2">Change Password</h3>
                <form onSubmit={handlePasswordSubmit} className="grid grid-2">
                    <div className="form-group">
                        <label>Current Password</label>
                        <input type="password" name="old_password" value={passwords.old_password} onChange={handlePasswordChange} required />
                    </div>
                    <div className="form-group">
                        <label>New Password</label>
                        <input type="password" name="new_password1" value={passwords.new_password1} onChange={handlePasswordChange} required />
                    </div>
                    <div className="form-group">
                        <label>Confirm New Password</label>
                        <input type="password" name="new_password2" value={passwords.new_password2} onChange={handlePasswordChange} required />
                    </div>
                    <div className="toolbar" style={{gridColumn: '1 / -1', justifyContent: 'flex-end', marginTop: '1rem'}}>
                        <button type="submit" className="btn btn--primary">Update Password</button>
                    </div>
                </form>
            </div>
        </div>
    );
}