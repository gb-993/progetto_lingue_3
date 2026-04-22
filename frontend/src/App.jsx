import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
// Importa i componenti di layout e protezione
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';

import PublicHome from './features/public/PublicHome';
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


export default function App() {
    return (
        <AuthProvider>
            <Router>
                <Routes>
                    {/* Rotte pubbliche */}
                    <Route path="/" element={<PublicHome />} />
                    <Route path="/login" element={<Login />} />

                    {/* Rotta protetta generica */}
                    <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
                    <Route path="/me" element={<Layout><MyAccount /></Layout>} />

                    {/* ROTTE LINGUE (Aperte a Admin e User) */}
                    <Route path="/languages" element={<Layout><LanguageList /></Layout>} />
                    <Route path="/languages/:id/data" element={<Layout><LanguageData /></Layout>} />
                    <Route path="/instructions" element={<Layout><Instructions /></Layout>} />

                    {/* ROTTE ESCLUSIVE ADMIN */}
                    <Route path="/languages/add" element={<AdminRoute><Layout><LanguageForm /></Layout></AdminRoute>} />
                    <Route path="/languages/:id/edit" element={<AdminRoute><Layout><LanguageForm /></Layout></AdminRoute>} />
                    <Route path="/languages/:id/debug" element={<AdminRoute><Layout><LanguageDebug /></Layout></AdminRoute>} />

                    {/* Glossario */}
                    <Route path="/admin/glossary" element={<AdminRoute><Layout><GlossaryList /></Layout></AdminRoute>} />
                    <Route path="/admin/glossary/add" element={<AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute>} />
                    <Route path="/admin/glossary/:id/edit" element={<AdminRoute><Layout><GlossaryForm /></Layout></AdminRoute>} />

                    {/* Parametri */}
                    <Route path="/admin/parameters" element={<AdminRoute><Layout><ParameterList /></Layout></AdminRoute>} />
                    <Route path="/admin/parameters/add" element={<AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>} />
                    <Route path="/admin/parameters/:id/edit" element={<AdminRoute><Layout><ParameterForm /></Layout></AdminRoute>} />

                    {/* Domande */}
                    <Route path="/admin/questions" element={<AdminRoute><Layout><QuestionList /></Layout></AdminRoute>} />
                    <Route path="/admin/questions/add" element={<AdminRoute><Layout><QuestionForm /></Layout></AdminRoute>} />
                    <Route path="/admin/questions/:id/edit" element={<AdminRoute><Layout><QuestionForm /></Layout></AdminRoute>} />

                    {/* Account */}
                    <Route path="/admin/accounts" element={<AdminRoute><Layout><AccountList /></Layout></AdminRoute>} />
                    <Route path="/admin/accounts/add" element={<AdminRoute><Layout><AccountCreate /></Layout></AdminRoute>} />
                    <Route path="/admin/accounts/:id/assign" element={<AdminRoute><Layout><AccountAssign /></Layout></AdminRoute>} />

                    {/* Motivations */}
                    <Route path="/admin/motivations" element={<AdminRoute><Layout><MotivationList /></Layout></AdminRoute>} />

                </Routes>
            </Router>
        </AuthProvider>
    );
}