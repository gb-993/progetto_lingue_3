import { useEffect } from 'react';
import {
    createBrowserRouter,
    RouterProvider,
    Outlet,
    useLocation,
} from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout, { SiteFooter } from './components/Layout';
import AdminRoute from './components/AdminRoute';

import PublicHome from './features/public/PublicHome';
import HowToCite from './features/public/HowToCite';
import Login from './features/auth/Login';
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
import MigrationImport from './features/admin/MigrationImport';
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
function AppRoot() {
    return (
        <AuthProvider>
            <ScrollToTop />
            <Outlet />
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

const router = createBrowserRouter([
    {
        path: '/',
        element: <AppRoot />,
        children: [
            // Rotte pubbliche
            { index: true, element: <ConditionalLayout><PublicHome /></ConditionalLayout> },
            { path: 'how-to-cite', element: <ConditionalLayout><HowToCite /></ConditionalLayout> },
            { path: 'login', element: <Login /> },

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
            { path: 'admin/migration-import', element: <AdminRoute><Layout><MigrationImport /></Layout></AdminRoute> },
            { path: 'admin/history', element: <AdminRoute><Layout><History /></Layout></AdminRoute> },
            { path: 'admin/taxonomy', element: <AdminRoute><Layout><Taxonomy /></Layout></AdminRoute> },
            { path: 'tablea', element: <Layout><TableA /></Layout> },
            { path: 'tablea/:id', element: <Layout><TableA /></Layout> },
            { path: 'queries', element: <Layout><QueriesDashboard /></Layout> },
        ],
    },
]);

export default function App() {
    return <RouterProvider router={router} />;
}