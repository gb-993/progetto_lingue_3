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
import WhatsNewModal from './components/WhatsNewModal';
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
import ParameterByLanguage from './features/parameters/ParameterByLanguage';
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
import Manual from './features/manual/Manual';

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
import WhatsNew from './features/admin/WhatsNew';
import History from './features/history/History';
import Taxonomy from './features/taxonomy/Taxonomy';

function ScrollToTop() {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
}

function AppRoot() {
    return (
        <AuthProvider>
            <ScrollToTop />
            <Outlet />
            <LegalConsentsModal />
            <WhatsNewModal />
        </AuthProvider>
    );
}

function ConditionalLayout({ children }) {
    const role = typeof window !== 'undefined' ? localStorage.getItem('role') : null;
    if (role === 'admin' || role === 'user') {
        return <Layout>{children}</Layout>;
    }
    return (
        <>
            {children}
            <SiteFooter />
        </>
    );
}

function HomeRoute() {
    const { user } = useAuth();
    if (user) return <Navigate to="/dashboard" replace />;
    return <ConditionalLayout><PublicHome /></ConditionalLayout>;
}

const router = createBrowserRouter([
    {
        path: '/',
        element: <AppRoot />,
        errorElement: <RouterErrorElement />,
        children: [
            { index: true, element: <HomeRoute /> },
            { path: 'how-to-cite', element: <ConditionalLayout><HowToCite /></ConditionalLayout> },
            { path: 'login', element: <Login /> },
            { path: 'forgot-password', element: <ForgotPassword /> },
            { path: 'reset-password', element: <ResetPassword /> },

            { path: 'dashboard', element: <Layout><Dashboard /></Layout> },
            { path: 'me', element: <Layout><MyAccount /></Layout> },

            { path: 'glossary', element: <Layout><GlossaryList /></Layout> },

            { path: 'languages', element: <Layout><LanguageList /></Layout> },
            { path: 'languages/:id/data', element: <Layout><LanguageData /></Layout> },
            { path: 'instructions', element: <Layout><Instructions /></Layout> },
            { path: 'manual', element: <Layout><Manual /></Layout> },

            { path: 'languages/add', element: <AdminRoute><Layout><LanguageForm /></Layout></AdminRoute> },
            { path: 'languages/:id/edit', element: <AdminRoute><Layout><LanguageForm /></Layout></AdminRoute> },
            { path: 'languages/:id/debug', element: <AdminRoute><Layout><LanguageDebug /></Layout></AdminRoute> },

            { path: 'admin/glossary/add', element: <AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute> },
            { path: 'admin/glossary/:id/edit', element: <AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute> },

            { path: 'admin/parameters', element: <AdminRoute><Layout><ParameterList /></Layout></AdminRoute> },
            { path: 'admin/parameters/graph', element: <AdminRoute><Layout><ParameterGraph /></Layout></AdminRoute> },
            { path: 'admin/parameters/add', element: <AdminRoute><Layout><ParameterForm /></Layout></AdminRoute> },
            {
                path: 'admin/parameters/:id/edit',
                element: <AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>,
                children: [
                    { path: 'questions/add', element: <QuestionForm mode="drawer" /> },
                    { path: 'questions/:qid/edit', element: <QuestionForm mode="drawer" /> },
                ],
            },
            { path: 'admin/parameters/:id/by-language', element: <AdminRoute><Layout><ParameterByLanguage /></Layout></AdminRoute> },

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
            { path: 'admin/migration-import', element: <AdminRoute requireSuperAdmin><Layout><MigrationImport /></Layout></AdminRoute> },
            { path: 'admin/backup-restore', element: <AdminRoute requireSuperAdmin><Layout><BackupRestore /></Layout></AdminRoute> },
            { path: 'admin/whats-new', element: <AdminRoute requireSuperAdmin><Layout><WhatsNew /></Layout></AdminRoute> },
            { path: 'admin/legal-documents', element: <AdminRoute><Layout><LegalDocuments /></Layout></AdminRoute> },
            { path: 'admin/history', element: <AdminRoute><Layout><History /></Layout></AdminRoute> },
            { path: 'admin/taxonomy', element: <AdminRoute><Layout><Taxonomy /></Layout></AdminRoute> },
            { path: 'tablea', element: <AdminRoute><Layout><TableA /></Layout></AdminRoute> },
            { path: 'tablea/:id', element: <AdminRoute><Layout><TableA /></Layout></AdminRoute> },
            { path: 'queries', element: <AdminRoute><Layout><QueriesDashboard /></Layout></AdminRoute> },

            { path: '*', element: <ConditionalLayout><NotFound /></ConditionalLayout> },
        ],
    },
]);

export default function App() {
    return (
        <ErrorBoundary>
            <RouterProvider router={router} />
        </ErrorBoundary>
    );
}