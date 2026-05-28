import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

// Stessa logica del toggle tema (data-theme): la densita' del layout vive in
// un attributo data-density su <html>, persistito in localStorage e applicato
// gia' in index.html per evitare il flash al reload.
const DENSITY_STORAGE_KEY = 'pcm-density';

function getInitialDensity() {
    if (typeof window === 'undefined') return 'comfortable';
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable';
}

export default function MyAccount() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState({ name: '', surname: '', email: '' });
    const [passwords, setPasswords] = useState({ old_password: '', new_password1: '', new_password2: '' });
    const [message, setMessage] = useState({ text: '', type: '' });
    const [density, setDensity] = useState(getInitialDensity);

    const handleDensityChange = (e) => {
        const value = e.target.value;
        setDensity(value);
        if (value === 'compact') {
            document.documentElement.setAttribute('data-density', 'compact');
        } else {
            document.documentElement.removeAttribute('data-density');
        }
        localStorage.setItem(DENSITY_STORAGE_KEY, value);
    };

    useEffect(() => {
        const fetchMe = async () => {
            try {
                const res = await api.get('/api/me');
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
            const res = await api.put('/api/me', profile);
            setMessage({ text: res.data.detail, type: 'success' });
            localStorage.setItem('name', profile.name);
        } catch (err) {
            setMessage({ text: err.response?.data?.detail || 'Profile update error', type: 'error' });
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await api.put('/api/me/password', passwords);
            setMessage({ text: res.data.detail, type: 'success' });
            setPasswords({ old_password: '', new_password1: '', new_password2: '' });
        } catch (err) {
            setMessage({ text: err.response?.data?.detail || 'Password update error', type: 'error' });
        }
    };

    return (
        <div className="container" style={{maxWidth: '800px', marginTop: 'var(--acc-page-top, 2rem)'}}>
            <header style={{marginBottom: 'var(--acc-header-gap, 1.5rem)'}}>
                <h1>My Account</h1>
            </header>

            {message.text && (
                <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`} style={{marginBottom: 'var(--acc-alert-gap, 1rem)'}}>
                    {message.text}
                </div>
            )}

            <div className="card" style={{marginBottom: 'var(--acc-section-gap, 2rem)'}}>
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
                    <div className="toolbar" style={{gridColumn: '1 / -1', justifyContent: 'flex-end', marginTop: 'var(--acc-action-top, 1rem)'}}>
                        <button type="submit" className="btn btn--primary">Save Profile</button>
                    </div>
                </form>
            </div>

            <div className="card" style={{marginBottom: 'var(--acc-section-gap, 2rem)'}}>
                <h3 className="mb-2">Appearance</h3>
                <div className="form-group">
                    <label htmlFor="density-select">Layout density</label>
                    <select
                        id="density-select"
                        value={density}
                        onChange={handleDensityChange}
                        style={{maxWidth: '320px'}}
                    >
                        <option value="comfortable">Comfortable (default)</option>
                        <option value="compact">Compact</option>
                    </select>
                    <p className="muted" style={{marginTop: '.5rem', fontSize: '.9rem'}}>
                        Compact riduce dimensioni e spaziature per un look più da gestionale. I colori restano invariati.
                    </p>
                </div>
            </div>

            <div className="card">
                <h3 className="mb-2">Change Password</h3>
                <form onSubmit={handlePasswordSubmit} className="grid grid-2">
                    <div className="form-group">
                        <label>Current Password</label>
                        <input type="password" name="old_password" value={passwords.old_password} onChange={handlePasswordChange} required />
                    </div>
                    <div className="form-group">
                        <label>New Password (min 8 characters)</label>
                        <input type="password" name="new_password1" value={passwords.new_password1} onChange={handlePasswordChange} required minLength={8} />
                    </div>
                    <div className="form-group">
                        <label>Confirm New Password</label>
                        <input type="password" name="new_password2" value={passwords.new_password2} onChange={handlePasswordChange} required minLength={8} />
                    </div>
                    <div className="toolbar" style={{gridColumn: '1 / -1', justifyContent: 'flex-end', marginTop: 'var(--acc-action-top, 1rem)'}}>
                        <button type="submit" className="btn btn--primary">Update Password</button>
                    </div>
                </form>
            </div>
        </div>
    );
}