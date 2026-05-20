import React from 'react';
import { useRouteError } from 'react-router-dom';
import ErrorCard from './ErrorCard';

function ErrorFallback() {
    return (
        <ErrorCard
            pageTitle="Something went wrong"
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
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
            }
            title="Something went wrong"
            description="An unexpected error occurred while loading this page. Reloading usually fixes it."
            primaryAction={{
                label: 'Reload page',
                onClick: () => { window.location.reload(); },
            }}
            ghostLink={{
                label: 'or go to the home page',
                onClick: () => { window.location.href = '/'; },
            }}
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
