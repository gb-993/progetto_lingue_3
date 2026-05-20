import { useNavigate } from 'react-router-dom';
import ErrorCard from './ErrorCard';

// Componente catch-all per la route '*'. Sostituisce il fallback default
// di React Router (un piccolo testo "404 not found" senza layout) con la
// scheda PCM-style coerente con frontend/public/404.html.
export default function NotFound() {
    const navigate = useNavigate();

    return (
        <ErrorCard
            pageTitle="Page not found"
            icon={
                <svg
                    viewBox="0 0 24 24"
                    width="48"
                    height="48"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                    <path d="m8 8 6 6" />
                    <path d="m14 8-6 6" />
                </svg>
            }
            title="Page not found"
            description="The page you were looking for doesn't exist or has been moved."
            primaryAction={{
                label: 'Back to home',
                onClick: () => navigate('/'),
            }}
            ghostLink={{
                label: 'or go back to the previous page',
                onClick: () => navigate(-1),
            }}
        />
    );
}
