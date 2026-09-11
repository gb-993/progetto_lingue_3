import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/auth/forgot-password', { email });
            // Il backend risponde sempre 200 (anche se l'email non esiste)
            // per non leakare quali account sono registrati: il frontend
            // si limita a mostrare la conferma generica.
            setSubmitted(true);
        } catch (err) {
            if (err?.response?.status === 429) {
                setError('Too many attempts. Please try again in a minute.');
            } else {
                setError('Network error. Please try again.');
            }
        }
    };

    return (
        <div className="auth-shell">
            <section className="card auth-card">
                <h1 className="auth-title">Forgot password</h1>
                {submitted ? (
                    <>
                        <p>
                            If <strong>{email}</strong> is registered, you will
                            shortly receive a message with the link to reset
                            your password.
                        </p>
                        <p style={{ fontSize: '.9rem', color: 'var(--text-muted)' }}>
                            The link is valid for 30 minutes. Please check your
                            spam folder too.
                        </p>
                        <div className="auth-secondary">
                            <Link to="/login">Back to login</Link>
                        </div>
                    </>
                ) : (
                    <>
                        <p>
                            Enter the email address linked to your account: we
                            will send you a link to set a new password.
                        </p>
                        {error && <div className="alert alert-error">{error}</div>}
                        <form onSubmit={handleSubmit}>
                            <div className="form-row">
                                <label>Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="auth-actions">
                                <button type="submit" className="btn btn--primary fit">
                                    Send link
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
