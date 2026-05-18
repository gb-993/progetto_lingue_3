import { useEffect } from 'react';
import {
    createBrowserRouter,
    RouterProvider,
    Outlet,
    Navigate,
    useLocation,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout, { SiteFooter } from './components/Layout';
import AdminRoute from './components/AdminRoute';
import ErrorBoundary, { RouterErrorElement } from './components/ErrorBoundary';
import LegalConsentsModal from './components/LegalConsentsModal';
import NotFound from './components/NotFound';

import PublicHome from './features/public/PublicHome';
import HowToCite from './features/public/HowToCite';
import Login from './features/auth/Login';
import ForgotPassword from './features/auth/ForgotPassword';
import ResetPassword from './features/auth/ResetPassword';
import Dashboard from './features/dashboard/Dashboard';

import LanguageList from './features/languages/LanguageList';
import LanguageForm from './features/languages/LanguageForm';

import GlossaryList from './features/glossary/GlossaryList';
import GlossaryForm from './features/glossary/GlossaryForm';

import ParameterList from './features/parameters/ParameterList';
import ParameterForm from './features/parameters/ParameterForm';
import ParameterGraph from './features/parameters/ParameterGraph';
import QuestionList from './features/questions/QuestionList';
import QuestionForm from './features/questions/QuestionForm';
import LanguageData from './features/compilation/LanguageData';
import LanguageDebug from "./features/compilation/LanguageDebug.jsx";
import AccountList from './features/accounts/AccountList';
import MyAccount from './features/accounts/MyAccount';
import AccountCreate from './features/accounts/AccountCreate';
import AccountAssign from './features/accounts/AccountAssign';
import MotivationList from './features/motivations/MotivationList.jsx';
import Instructions from './features/instructions/Instructions';

import BackupFolder from './features/backups/BackupFolder';
import BackupDetail from './features/backups/BackupDetail';
import ParameterBackupFolder from './features/backups/ParameterBackupFolder';
import ParameterBackupDetail from './features/backups/ParameterBackupDetail';
import ArchivedQuestionDetail from './features/backups/ArchivedQuestionDetail';
import EditSiteContent from './features/public/EditSiteContent';
import TableA from './features/tablea/TableA';
import QueriesDashboard from "./features/queries/QueriesDashboard.jsx";
import ImportExcel from './features/admin/ImportExcel';
import LegalDocuments from './features/admin/LegalDocuments';
import MigrationImport from './features/admin/MigrationImport';
import BackupRestore from './features/admin/BackupRestore';
import History from './features/history/History';
import Taxonomy from './features/taxonomy/Taxonomy';

// Scroll automatico in cima ad ogni cambio di rotta. Senza questo, React Router
// preserva la posizione di scroll fra navigazioni, dando l'impressione che le
// nuove pagine si aprano "a metà".
function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
}

// Root element del Data Router: AuthProvider deve restare DENTRO il
// RouterProvider (cioè qui dentro l'Outlet) perché alcuni hook usati da
// AuthProvider o dai suoi consumer assumono il context del router.
//
// LegalConsentsModal e' montato qui (al livello piu' alto sotto AuthProvider)
// cosi' galleggia sopra qualunque pagina: e' bloccante per definizione, non
// deve essere sotto la sidebar/topbar. Si nasconde da solo quando l'utente
// e' in regola (vedi requiredConsents in AuthContext).
function AppRoot() {
    return (
        <AuthProvider>
            <ScrollToTop />
            <Outlet />
            <LegalConsentsModal />
        </AuthProvider>
    );
}

// Wrappa con Layout (sidebar + topbar) solo per utenti loggati come admin o user.
// Usato per le rotte pubbliche che però vogliamo "decorare" quando l'utente è autenticato.
function ConditionalLayout({ children }) {
    const role = typeof window !== 'undefined' ? localStorage.getItem('role') : null;
    if (role === 'admin' || role === 'user') {
        return <Layout>{children}</Layout>;
    }
    return (
        <>
            {children}
            <SiteFooter role="public" />
        </>
    );
}

// La rotta `/` mostra PublicHome (landing pubblica con hero "Welcome" e bottone
// Login). Per un utente autenticato non ha senso: vedrebbe sidebar + Logout
// insieme al bottone Login della landing. Redirigiamo a /dashboard. La mappa
// pubblica resta comunque accessibile agli admin tramite Languages.
function HomeRoute() {
    const { user } = useAuth();
    if (user) return <Navigate to="/dashboard" replace />;
    return <ConditionalLayout><PublicHome /></ConditionalLayout>;
}

const router = createBrowserRouter([
    {
        path: '/',
        element: <AppRoot />,
        // errorElement: il data router (createBrowserRouter) cattura i crash
        // dentro le sue children e li manda qui. Senza questo, React Router
        // mostra un fallback minimal ("Unexpected Application Error!") prima
        // ancora che l'ErrorBoundary class esterno possa intervenire.
        errorElement: <RouterErrorElement />,
        children: [
            // Rotte pubbliche
            { index: true, element: <HomeRoute /> },
            { path: 'how-to-cite', element: <ConditionalLayout><HowToCite /></ConditionalLayout> },
            { path: 'login', element: <Login /> },
            { path: 'forgot-password', element: <ForgotPassword /> },
            { path: 'reset-password', element: <ResetPassword /> },

            // Rotta protetta generica
            { path: 'dashboard', element: <Layout><Dashboard /></Layout> },
            { path: 'me', element: <Layout><MyAccount /></Layout> },

            // GLOSSARIO UNIFICATO
            { path: 'glossary', element: <Layout><GlossaryList /></Layout> },

            // ROTTE LINGUE
            { path: 'languages', element: <Layout><LanguageList /></Layout> },
            { path: 'languages/:id/data', element: <Layout><LanguageData /></Layout> },
            { path: 'instructions', element: <Layout><Instructions /></Layout> },

            // ROTTE ESCLUSIVE ADMIN
            { path: 'languages/add', element: <AdminRoute><Layout><LanguageForm /></Layout></AdminRoute> },
            { path: 'languages/:id/edit', element: <AdminRoute><Layout><LanguageForm /></Layout></AdminRoute> },
            { path: 'languages/:id/debug', element: <AdminRoute><Layout><LanguageDebug /></Layout></AdminRoute> },

            { path: 'admin/glossary/add', element: <AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute> },
            { path: 'admin/glossary/:id/edit', element: <AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute> },

            { path: 'admin/parameters', element: <AdminRoute><Layout><ParameterList /></Layout></AdminRoute> },
            { path: 'admin/parameters/graph', element: <AdminRoute><Layout><ParameterGraph /></Layout></AdminRoute> },
            { path: 'admin/parameters/add', element: <AdminRoute><Layout><ParameterForm /></Layout></AdminRoute> },
            // Edit di un parametro: la rotta ha figli nested per la edit/aggiunta
            // di una question, che vengono renderizzate come drawer sopra il
            // parametro stesso (vedi ParameterForm + Drawer).
            {
                path: 'admin/parameters/:id/edit',
                element: <AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>,
                children: [
                    { path: 'questions/add', element: <QuestionForm mode="drawer" /> },
                    { path: 'questions/:qid/edit', element: <QuestionForm mode="drawer" /> },
                ],
            },

            { path: 'admin/questions', element: <AdminRoute><Layout><QuestionList /></Layout></AdminRoute> },
            { path: 'admin/questions/add', element: <AdminRoute><Layout><QuestionForm /></Layout></AdminRoute> },
            { path: 'admin/questions/:id/edit', element: <AdminRoute><Layout><QuestionForm /></Layout></AdminRoute> },

            { path: 'admin/accounts', element: <AdminRoute><Layout><AccountList /></Layout></AdminRoute> },
            { path: 'admin/accounts/add', element: <AdminRoute><Layout><AccountCreate /></Layout></AdminRoute> },
            { path: 'admin/accounts/:id/assign', element: <AdminRoute><Layout><AccountAssign /></Layout></AdminRoute> },

            { path: 'admin/motivations', element: <AdminRoute><Layout><MotivationList /></Layout></AdminRoute> },

            { path: 'admin/backups/parameters/:timestamp', element: <AdminRoute><Layout><ParameterBackupFolder /></Layout></AdminRoute> },
            { path: 'admin/backups/parameters/submissions/:id', element: <AdminRoute><Layout><ParameterBackupDetail /></Layout></AdminRoute> },
            { path: 'admin/backups/:timestamp', element: <AdminRoute><Layout><BackupFolder /></Layout></AdminRoute> },
            { path: 'admin/backups/submissions/:id', element: <AdminRoute><Layout><BackupDetail /></Layout></AdminRoute> },
            { path: 'admin/archived-questions/:id', element: <AdminRoute><Layout><ArchivedQuestionDetail /></Layout></AdminRoute> },

            { path: 'admin/edit-content/:key', element: <AdminRoute><Layout><EditSiteContent /></Layout></AdminRoute> },
            { path: 'admin/import-excel', element: <AdminRoute><Layout><ImportExcel /></Layout></AdminRoute> },
            // Rotte super-admin: oltre a essere admin, l'utente deve avere
            // l'email in SUPER_ADMIN_EMAIL (env var backend). Operazioni
            // distruttive sull'intero DB.
            { path: 'admin/migration-import', element: <AdminRoute requireSuperAdmin><Layout><MigrationImport /></Layout></AdminRoute> },
            { path: 'admin/backup-restore', element: <AdminRoute requireSuperAdmin><Layout><BackupRestore /></Layout></AdminRoute> },
            // Gestione versioni documenti legali (ToU, Privacy Notice). Super-admin
            // perche' una pubblicazione errata forza tutti gli utenti a ri-accettare.
            { path: 'admin/legal-documents', element: <AdminRoute requireSuperAdmin><Layout><LegalDocuments /></Layout></AdminRoute> },
            { path: 'admin/history', element: <AdminRoute><Layout><History /></Layout></AdminRoute> },
            { path: 'admin/taxonomy', element: <AdminRoute><Layout><Taxonomy /></Layout></AdminRoute> },
            // TableA e Queries sono admin-only: la sidebar le mostra solo
            // agli admin e gli endpoint backend (/api/tablea/*, /api/queries/*)
            // sono protetti da require_admin. Avvolgiamo anche le rotte SPA
            // con AdminRoute per coerenza UX: un utente non admin che digiti
            // l'URL a mano viene rimandato a /dashboard invece di vedere una
            // pagina che farà solo errori 403 sulle proprie chiamate.
            { path: 'tablea', element: <AdminRoute><Layout><TableA /></Layout></AdminRoute> },
            { path: 'tablea/:id', element: <AdminRoute><Layout><TableA /></Layout></AdminRoute> },
            { path: 'queries', element: <AdminRoute><Layout><QueriesDashboard /></Layout></AdminRoute> },

            // Catch-all: qualsiasi URL non riconosciuto cade qui invece del
            // fallback minimal di React Router. Mostra una scheda PCM-style
            // coerente con frontend/public/404.html.
            { path: '*', element: <ConditionalLayout><NotFound /></ConditionalLayout> },
        ],
    },
]);

export default function App() {
    // ErrorBoundary fuori dal RouterProvider: cattura crash JS in qualsiasi
    // pagina/route e mostra una scheda PCM-style invece dello schermo bianco.
    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}