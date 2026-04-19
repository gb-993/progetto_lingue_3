import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Importa i componenti di layout e protezione
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';

// Importa le pagine pubbliche e utente
import PublicHome from './pages/PublicHome';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';

// Importa le pagine Admin: Lingue
import LanguageList from './pages/LanguageList';

// Importa le pagine Admin: Glossario
import GlossaryList from './pages/GlossaryList';
import GlossaryForm from './pages/GlossaryForm';

// Importa le pagine Admin: Parametri
import ParameterList from './pages/ParameterList';
import ParameterForm from './pages/ParameterForm';

// Importa le pagine Admin: Domande (per ora creiamo solo la rotta per la lista)
import QuestionList from './pages/QuestionList';
import QuestionForm from './pages/QuestionForm';

export default function App() {
    return (
        <Router>
            <Routes>
                {/* Rotte pubbliche */}
                <Route path="/" element={<PublicHome />} />
                <Route path="/login" element={<Login />} />

                {/* Rotta protetta generica */}
                <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />

                {/* ROTTE ESCLUSIVE ADMIN (Protette da AdminRoute) */}

                {/* Lingue */}
                <Route path="/languages" element={<AdminRoute><Layout><LanguageList /></Layout></AdminRoute>} />

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

            </Routes>
        </Router>
    );
}