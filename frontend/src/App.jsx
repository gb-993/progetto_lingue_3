import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
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

import BackupList from './features/backups/BackupList';
import BackupFolder from './features/backups/BackupFolder';
import BackupDetail from './features/backups/BackupDetail';
import EditSiteContent from './features/public/EditSiteContent';
import TableA from './features/tablea/TableA';
import LogicTree  from "./features/queries/LogicTree.jsx";
import QueriesDashboard from "./features/queries/QueriesDashboard.jsx";
import ImportExcel from './features/admin/ImportExcel';
import History from './features/history/History';

export default function App() {
    return (
        <AuthProvider>
            <Router>
                <Routes>
                    {/* Rotte pubbliche */}
                    <Route path="/" element={<PublicHome />} />
                    <Route path="/how-to-cite" element={<HowToCite />} />
                    <Route path="/login" element={<Login />} />

                    {/* Rotta protetta generica */}
                    <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
                    <Route path="/me" element={<Layout><MyAccount /></Layout>} />

                    {/* GLOSSARIO UNIFICATO */}
                    <Route path="/glossary" element={<Layout><GlossaryList /></Layout>} />

                    {/* ROTTE LINGUE */}
                    <Route path="/languages" element={<Layout><LanguageList /></Layout>} />
                    <Route path="/languages/:id/data" element={<Layout><LanguageData /></Layout>} />
                    <Route path="/instructions" element={<Layout><Instructions /></Layout>} />

                    {/* ROTTE ESCLUSIVE ADMIN */}
                    <Route path="/languages/add" element={<AdminRoute><Layout><LanguageForm /></Layout></AdminRoute>} />
                    <Route path="/languages/:id/edit" element={<AdminRoute><Layout><LanguageForm /></Layout></AdminRoute>} />
                    <Route path="/languages/:id/debug" element={<AdminRoute><Layout><LanguageDebug /></Layout></AdminRoute>} />

                    <Route path="/admin/glossary/add" element={<AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute>} />
                    <Route path="/admin/glossary/:id/edit" element={<AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute>} />

                    <Route path="/admin/parameters" element={<AdminRoute><Layout><ParameterList /></Layout></AdminRoute>} />
                    <Route path="/admin/parameters/add" element={<AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>} />
                    <Route path="/admin/parameters/:id/edit" element={<AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>} />

                    <Route path="/admin/questions" element={<AdminRoute><Layout><QuestionList /></Layout></AdminRoute>} />
                    <Route path="/admin/questions/add" element={<AdminRoute><Layout><QuestionForm /></Layout></AdminRoute>} />
                    <Route path="/admin/questions/:id/edit" element={<AdminRoute><Layout><QuestionForm /></Layout></AdminRoute>} />

                    <Route path="/admin/accounts" element={<AdminRoute><Layout><AccountList /></Layout></AdminRoute>} />
                    <Route path="/admin/accounts/add" element={<AdminRoute><Layout><AccountCreate /></Layout></AdminRoute>} />
                    <Route path="/admin/accounts/:id/assign" element={<AdminRoute><Layout><AccountAssign /></Layout></AdminRoute>} />

                    <Route path="/admin/motivations" element={<AdminRoute><Layout><MotivationList /></Layout></AdminRoute>} />

                    <Route path="/admin/backups" element={<AdminRoute><Layout><BackupList /></Layout></AdminRoute>} />
                    <Route path="/admin/backups/:timestamp" element={<AdminRoute><Layout><BackupFolder /></Layout></AdminRoute>} />
                    <Route path="/admin/backups/submissions/:id" element={<AdminRoute><Layout><BackupDetail /></Layout></AdminRoute>} />

                    <Route path="/admin/edit-content/:key" element={<AdminRoute><Layout><EditSiteContent /></Layout></AdminRoute>} />
                    <Route path="/admin/import-excel" element={<AdminRoute><Layout><ImportExcel /></Layout></AdminRoute>} />
                    <Route path="/admin/history" element={<AdminRoute><Layout><History /></Layout></AdminRoute>} />
                    <Route path="/tablea" element={<Layout><TableA /></Layout>} />
                    <Route path="/tablea/:id" element={<Layout><TableA /></Layout>} />
                    <Route path="/queries" element={<Layout><QueriesDashboard /></Layout>} />


                </Routes>
            </Router>
        </AuthProvider>
    );
}