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
            setError('Link di reset non valido: token mancante. Richiedine uno nuovo.');
            return;
        }
        if (password1 !== password2) {
            setError('Le due password non coincidono.');
            return;
        }
        if (password1.length < 8) {
            setError('La password deve essere lunga almeno 8 caratteri.');
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
                setError('Troppi tentativi. Riprova tra un minuto.');
            } else {
                setError('Errore di rete. Riprova.');
            }
        }
    };

    return (
        <div className="auth-shell">
            <section className="card auth-card">
                <h1 className="auth-title">Imposta una nuova password</h1>
                {done ? (
                    <>
                        <div className="alert alert-success">
                            Password aggiornata. Ti reindirizzo al login...
                        </div>
                        <div className="auth-secondary">
                            <Link to="/login">Vai al login adesso</Link>
                        </div>
                    </>
                ) : (
                    <>
                        {!token && (
                            <div className="alert alert-error">
                                Link non valido: manca il token. Richiedi un nuovo
                                link dalla pagina <Link to="/forgot-password">Password dimenticata</Link>.
                            </div>
                        )}
                        {error && <div className="alert alert-error">{error}</div>}
                        <form onSubmit={handleSubmit}>
                            <div className="form-row">
                                <label>Nuova password</label>
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
                                <label>Conferma nuova password</label>
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
                                    Imposta password
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
