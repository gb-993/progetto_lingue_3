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

export function RouterErrorElement() {
    const error = useRouteError();
    console.error('Caught by RouterErrorElement:', error);
    return <ErrorFallback />;
}

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        console.error('Caught by ErrorBoundary:', error, errorInfo);
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return <ErrorFallback />;
    }
}
