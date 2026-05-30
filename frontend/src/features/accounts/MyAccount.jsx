import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api'; // Sostituito axios
import SegmentedToggle from '../../components/SegmentedToggle';

// Stessa logica del toggle tema (data-theme): la densita' del layout vive in
// un attributo data-density su <html>, persistito in localStorage e applicato
// gia' in index.html per evitare il flash al reload.
const DENSITY_STORAGE_KEY = 'pcm-density';
const THEME_STORAGE_KEY = 'pcm-theme';

function getInitialDensity() {
    if (typeof window === 'undefined') return 'compact';
    // Default = "compact". Solo la scelta esplicita 'zoom' dell'utente attiva la
    // modalita' grande, e resta salvata in localStorage (rispettata per sempre,
    // anche dopo i deploy). Ogni altro valore (null o il vecchio 'comfortable')
    // ricade sul default compact.
    return localStorage.getItem(DENSITY_STORAGE_KEY) === 'zoom' ? 'zoom' : 'compact';
}

// Il tema (data-theme) e' gia' applicato da index.html prima di React, quindi
// lo leggiamo dall'attributo: e' la verita' corrente, coerente con la top bar.
function getInitialTheme() {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export default function MyAccount() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState({ name: '', surname: '', email: '' });
    const [passwords, setPasswords] = useState({ old_password: '', new_password1: '', new_password2: '' });
    const [message, setMessage] = useState({ text: '', type: '' });
    const [density, setDensity] = useState(getInitialDensity);
    const [theme, setTheme] = useState(getInitialTheme);

    const applyDensity = (value) => {
        setDensity(value);
        if (value === 'compact') {
            document.documentElement.setAttribute('data-density', 'compact');
        } else {
            document.documentElement.removeAttribute('data-density');
        }
        localStorage.setItem(DENSITY_STORAGE_KEY, value);
    };

    // Cambia il tema e notifica la top bar (e ogni altro toggle) via evento,
    // così restano sempre in sync. Stessa sorgente di verità: data-theme +
    // localStorage. La top bar fa esattamente lo stesso quando viene cliccata.
    const applyTheme = (value) => {
        setTheme(value);
        document.documentElement.setAttribute('data-theme', value);
        localStorage.setItem(THEME_STORAGE_KEY, value);
        window.dispatchEvent(new CustomEvent('pcm-theme-change', { detail: value }));
    };

    // Tiene allineato questo toggle quando il tema cambia dalla top bar.
    useEffect(() => {
        const handler = (e) => setTheme(prev => (prev === e.detail ? prev : e.detail));
        window.addEventListener('pcm-theme-change', handler);
        return () => window.removeEventListener('pcm-theme-change', handler);
    }, []);

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
                <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap'}}>
                    <label style={{margin: 0, minWidth: '8rem'}}>Layout density</label>
                    <SegmentedToggle
                        ariaLabel="Layout density"
                        value={density}
                        onChange={applyDensity}
                        options={[{ value: 'zoom', label: 'Zoom' }, { value: 'compact', label: 'Compact' }]}
                    />
                </div>
                <div className="form-group" style={{display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginTop: '1rem'}}>
                    <label style={{margin: 0, minWidth: '8rem'}}>Theme</label>
                    <SegmentedToggle
                        ariaLabel="Theme"
                        value={theme}
                        onChange={applyTheme}
                        options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                    />
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