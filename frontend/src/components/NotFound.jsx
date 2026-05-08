import { useNavigate } from 'react-router-dom';
import ErrorCard from './ErrorCard';

// Componente catch-all per la route '*'. Sostituisce il fallback default
// di React Router (un piccolo testo "404 not found" senza layout) con la
// scheda PCM-style coerente con frontend/public/404.html.
export default function NotFound() {
    const navigate = useNavigate();

    return (
        <ErrorCard
            code="ERR_404"
            description="Page not found"
            question="Does this website show the page you requested?"
            motivations={[
                'Page does not exist',
                'Address may have been mistyped or moved',
            ]}
            primaryAction={{
                context: 'Sure where you wanted to go?',
                label: 'Confident -> Proceed',
                onClick: () => navigate('/'),
            }}
            secondaryAction={{
                context: 'Not really? Try the previous page.',
                label: 'Unsure -> Back',
                onClick: () => navigate(-1),
            }}
            footerText="The page you requested could not be found."
        />
    );
}
