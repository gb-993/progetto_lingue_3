import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api'; // Sostituito axios

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            // Chiamata centralizzata
            const resp = await api.post('/auth/login', { email, password });
            localStorage.setItem('token', resp.data.access_token);
            localStorage.setItem('role', resp.data.role);
            localStorage.setItem('name', resp.data.name);
            navigate('/dashboard');
        } catch {
            setError('Credenziali non valide');
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