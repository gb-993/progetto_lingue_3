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
                setError('Troppi tentativi. Riprova tra un minuto.');
            } else {
                setError('Errore di rete. Riprova.');
            }
        }
    };

    return (
        <div className="auth-shell">
            <section className="card auth-card">
                <h1 className="auth-title">Password dimenticata</h1>
                {submitted ? (
                    <>
                        <p>
                            Se l'email <strong>{email}</strong> e' registrata,
                            riceverai a breve un messaggio con il link per
                            reimpostare la password.
                        </p>
                        <p style={{ fontSize: '.9rem', color: 'var(--text-muted)' }}>
                            Il link e' valido per 30 minuti. Controlla anche la
                            cartella spam.
                        </p>
                        <div className="auth-secondary">
                            <Link to="/login">Torna al login</Link>
                        </div>
                    </>
                ) : (
                    <>
                        <p>
                            Inserisci l'email associata al tuo account: ti
                            invieremo un link per impostare una nuova password.
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
                                    Invia link
                                </button>
                            </div>
                        </form>
                        <div className="auth-secondary">
                            <Link to="/login">Torna al login</Link>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
