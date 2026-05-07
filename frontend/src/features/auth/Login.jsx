import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api'; // Sostituito axios
import { useAuth } from '../../context/AuthContext';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { login } = useAuth();

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            // Chiamata centralizzata
            const resp = await api.post('/auth/login', { email, password });
            // login() del context salva il token e popola lo stato `user`
            // chiamando /api/me — necessario perché AdminRoute legge dal
            // context. localStorage.role/name restano per Layout.jsx, che
            // ancora li usa per decidere quali voci della sidebar mostrare.
            await login(resp.data.access_token);
            localStorage.setItem('role', resp.data.role);
            // `resp.data.name` può essere null se l'utente non ha un name
            // valorizzato (es. account creato senza nome). Senza fallback
            // `setItem('name', null)` lo serializza come la stringa "null"
            // che poi compare letterale in topbar/Dashboard ("Welcome, null").
            localStorage.setItem('name', resp.data.name ?? '');
            navigate('/dashboard');
        } catch {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="auth-shell">
            <section className="card auth-card">
                <h1 className="auth-title">Login</h1>
                {error && <div className="alert alert-error">{error}</div>}
                <form onSubmit={handleLogin}>
                    <div className="form-row">
                        <label>Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-row">
                        <label>Password</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                    </div>
                    <div className="auth-actions">
                        <button type="submit" className="btn btn--primary fit">Log in</button>
                    </div>
                </form>
            </section>
        </div>
    );
}