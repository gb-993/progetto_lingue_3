import { useState, useEffect } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import api from '../../api';

export default function Instructions() {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    useEffect(() => {
        const fetchContent = async () => {
            try {
                const res = await api.get('/api/content/instr_body');
                setContent(res.data.content || getDefaultContent());
            } catch (err) {
                console.error("Errore caricamento istruzioni:", err);
                setContent(getDefaultContent());
            } finally {
                setLoading(false);
            }
        };
        fetchContent();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put('/api/content/instr_body', { content });
            setIsEditing(false);
        } catch (err) {
            alert("Errore durante il salvataggio.");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="container mt-2">Caricamento istruzioni...</div>;

    return (
        <div className="container" style={{ marginTop: '2rem', paddingBottom: '5rem' }}>
            <header className="dashboard-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1>Instructions</h1>
                {isAdmin && (
                    <button
                        className={`btn ${isEditing ? 'btn--primary' : ''}`}
                        onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : isEditing ? '💾 Save Changes' : '✏️ Edit Instructions'}
                    </button>
                )}
            </header>

            <div className="card" style={{ marginTop: '1.5rem', minHeight: '400px' }}>
                {isEditing && isAdmin ? (
                    <div className="editor-container">
                        <ReactQuill
                            theme="snow"
                            value={content}
                            onChange={setContent}
                            modules={quillModules}
                        />
                        <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                            <button className="btn" onClick={() => setIsEditing(false)} style={{ marginRight: '0.5rem' }}>Cancel</button>
                            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>Save</button>
                        </div>
                    </div>
                ) : (
                    <div
                        className="instructions-view"
                        dangerouslySetInnerHTML={{ __html: content }}
                    />
                )}
            </div>
        </div>
    );
}

// Configurazione barra degli strumenti editor (WYSIWYG)
const quillModules = {
    toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        ['link', 'blockquote', 'code-block'],
        ['clean']
    ],
};

// Contenuto di fallback se il DB è vuoto
function getDefaultContent() {
    return `
        <h2>General instructions for entering data</h2>
        <p>Welcome to the PCM Hub. Please follow these steps:</p>
        <ol>
            <li><strong>Read</strong> the question carefully.</li>
            <li><strong>Identify</strong> the corresponding structure in your language.</li>
            <li>Fill in the <strong>Yes/No</strong> answers and provide examples.</li>
        </ol>
    `;
}