import React from 'react';
import { useRouteError } from 'react-router-dom';
import ErrorCard from './ErrorCard';

function ErrorFallback() {
    return (
        <ErrorCard
            code="ERR_JSx"
            description="Unexpected error"
            question="Does this website show the page you requested?"
            motivations={[
                'Internal client error',
                'Component failed to render',
            ]}
            primaryAction={{
                context: 'Looks like a temporary glitch?',
                label: 'Confident -> Reload',
                onClick: () => { window.location.reload(); },
            }}
            secondaryAction={{
                context: 'Get back to safe ground.',
                label: 'Unsure -> Home',
                onClick: () => { window.location.href = '/'; },
            }}
            footerText="An unexpected error occurred while rendering the page."
        />
    );
}

// errorElement per il data router (createBrowserRouter). React Router cattura
// internamente i crash dentro le rotte e li espone via useRouteError(): qui
// li intercettiamo per mostrare la nostra scheda PCM-style invece del
// "Unexpected Application Error!" default di React Router.
export function RouterErrorElement() {
    const error = useRouteError();
    // eslint-disable-next-line no-console
    console.error('Caught by RouterErrorElement:', error);
    return <ErrorFallback />;
}

// Cattura crash JS non gestiti dei componenti figli e li trasforma in
// una scheda PCM-style invece dello "schermo bianco" di default.
//
// Nota: gli ErrorBoundary intercettano SOLO errori sollevati durante il
// render, nei lifecycle methods e nei costruttori dei figli. NON catturano:
//   - errori in event handler (li' va try/catch a mano)
//   - errori in setTimeout/setInterval/fetch async non awaitati
//   - errori durante il server-side rendering
//   - errori sollevati nell'ErrorBoundary stesso
// Per tutti gli altri (la stragrande maggioranza dei bug di rendering)
// invece di "white screen" l'utente vedra' una pagina utile con bug-report.
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // Salviamo errorInfo nello state per includerlo nel bug report.
        // Niente reporting automatico: l'utente decide se inviare la mail.
        this.setState({ errorInfo });
        // Lasciamo comunque traccia in console: durante lo sviluppo aiuta,
        // in prod gli admin possono leggerla dalla devtools.
        // eslint-disable-next-line no-console
        console.error('Caught by ErrorBoundary:', error, errorInfo);
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return <ErrorFallback />;
    }
}
