import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token') || '';

    const [password1, setPassword1] = useState('');
    const [password2, setPassword2] = useState('');
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!token) {
            setError('Invalid reset link: the token is missing. Please request a new one.');
            return;
        }
        if (password1 !== password2) {
            setError('The two passwords do not match.');
            return;
        }
        if (password1.length < 8) {
            setError('The password must be at least 8 characters long.');
            return;
        }

        try {
            await api.post('/auth/reset-password', {
                token,
                new_password: password1,
            });
            setDone(true);
            // Dopo 2.5s reindirizziamo al login per chiudere il flusso.
            setTimeout(() => navigate('/login'), 2500);
        } catch (err) {
            const detail = err?.response?.data?.detail;
            if (detail) {
                setError(detail);
            } else if (err?.response?.status === 429) {
                setError('Too many attempts. Please try again in a minute.');
            } else {
                setError('Network error. Please try again.');
            }
        }
    };

    return (
        <div className="auth-shell">
            <section className="card auth-card">
                <h1 className="auth-title">Set a new password</h1>
                {done ? (
                    <>
                        <div className="alert alert-success">
                            Password updated. Redirecting you to the login page...
                        </div>
                        <div className="auth-secondary">
                            <Link to="/login">Go to login now</Link>
                        </div>
                    </>
                ) : (
                    <>
                        {!token && (
                            <div className="alert alert-error">
                                Invalid link: the token is missing. Request a new
                                link from the <Link to="/forgot-password">Forgot password</Link> page.
                            </div>
                        )}
                        {error && <div className="alert alert-error">{error}</div>}
                        <form onSubmit={handleSubmit}>
                            <div className="form-row">
                                <label>New password</label>
                                <input
                                    type="password"
                                    value={password1}
                                    onChange={(e) => setPassword1(e.target.value)}
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="form-row">
                                <label>Confirm new password</label>
                                <input
                                    type="password"
                                    value={password2}
                                    onChange={(e) => setPassword2(e.target.value)}
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                />
                            </div>
                            <div className="auth-actions">
                                <button type="submit" className="btn btn--primary fit" disabled={!token}>
                                    Set password
                                </button>
                            </div>
                        </form>
                        <div className="auth-secondary">
                            <Link to="/login">Back to login</Link>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
