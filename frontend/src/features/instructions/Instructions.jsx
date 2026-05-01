import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import api from '../../api';

// TinyMCE is heavy (~500 KB gzip). Load it only when an admin opens the
// editor, not on every page render.
const InstructionsEditor = lazy(() => import('./InstructionsEditor'));

const CONTENT_KEY = 'instr_body';

export default function Instructions() {
    const [content, setContent] = useState('');
    const [draft, setDraft] = useState('');
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const editorRef = useRef(null);

    const role = localStorage.getItem('role');
    const isAdmin = role === 'admin';

    useEffect(() => {
        const fetchContent = async () => {
            try {
                const res = await api.get(`/api/content/${CONTENT_KEY}`);
                setContent((res.data.content && res.data.content.trim()) || DEFAULT_CONTENT);
            } catch (err) {
                console.error('Errore caricamento istruzioni:', err);
                setContent(DEFAULT_CONTENT);
            } finally {
                setLoading(false);
            }
        };
        fetchContent();
    }, []);

    const startEditing = () => {
        setDraft(content);
        setError('');
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setDraft('');
        setError('');
        setIsEditing(false);
    };

    const loadDefaultTemplate = () => {
        if (!window.confirm('Replace the current draft with the default template? Unsaved changes will be lost.')) return;
        setDraft(DEFAULT_CONTENT);
        if (editorRef.current) editorRef.current.setContent(DEFAULT_CONTENT);
    };

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            const html = editorRef.current ? editorRef.current.getContent() : draft;
            await api.put(`/api/content/${CONTENT_KEY}`, { content: html });
            setContent(html);
            setIsEditing(false);
        } catch (err) {
            console.error(err);
            setError('Save failed. Please retry.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="container mt-2">
                <p className="muted">Loading instructions…</p>
            </div>
        );
    }

    return (
        <div className="container instructions-page" style={{ paddingBottom: '4rem' }}>
            <header
                className="dashboard-hero"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.75rem' }}
            >
                <h1 style={{ margin: 0 }}>Instructions</h1>
                {isAdmin && !isEditing && (
                    <button type="button" className="btn" onClick={startEditing}>
                        Edit
                    </button>
                )}
            </header>

            {error && (
                <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ marginTop: '1rem', minHeight: '320px' }}>
                {isEditing && isAdmin ? (
                    <div className="instructions-editor">
                        <div
                            className="editor-bar"
                            style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                marginBottom: '.6rem',
                            }}
                        >
                            <button type="button" className="btn" onClick={loadDefaultTemplate}>
                                Load default template
                            </button>
                        </div>

                        <Suspense fallback={<p className="muted">Loading editor…</p>}>
                            <InstructionsEditor
                                initialValue={draft}
                                onReady={(editor) => { editorRef.current = editor; }}
                            />
                        </Suspense>

                        <p className="muted" style={{ marginTop: '.6rem', fontSize: '.85rem' }}>
                            Use the toolbar to format text and insert tables. Click the “&lt;/&gt;” icon to edit raw HTML if needed.
                        </p>

                        <div
                            style={{
                                marginTop: '1rem',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '.5rem',
                            }}
                        >
                            <button type="button" className="btn" onClick={cancelEditing} disabled={saving}>
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn btn--primary"
                                onClick={handleSave}
                                disabled={saving}
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </button>
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

const DEFAULT_CONTENT = `
<h2>General instructions for entering data</h2>
<ol>
  <li><strong>Read</strong> the question carefully.</li>
  <li><strong>Identify</strong> the corresponding structure in your language (you may refer to the illustrative examples for guidance).</li>
  <li>
    If your language:
    <ul>
      <li><strong>has examples</strong> of this structure, select <strong>YES</strong> and provide <strong>at least two examples</strong> in the relevant boxes;</li>
      <li><strong>has no examples</strong> of this structure, select <strong>NO</strong>. If possible, provide an ungrammatical example; otherwise, select the appropriate motivation(s) in the checkbox.</li>
    </ul>
    In the <strong>Comments</strong> field, you can add any note, clarification, or issue related to your answer and data.
  </li>
  <li>
    <strong>After completing each parameter</strong>, <strong>save</strong> your answer and data by selecting one of the two confidence buttons:
    <ul>
      <li><strong>green</strong>: the data are complete and require no further revision;</li>
      <li><strong>red</strong>: you are not sure the data match your answer.</li>
    </ul>
    Once you click one of these buttons, your answers (and data) are saved and will <strong>remain available</strong> after you log out. You can modify them anytime you log in again, until final submission.
  </li>
  <li>
    Click <strong>Submit</strong> only after <strong>all data</strong> have been entered. After submission, you can still view your entries, but <strong>you will no longer be able to modify</strong> them.
  </li>
</ol>

<h2>Specific instructions for writing glosses</h2>
<p>
  Be aware that we are not requesting an exhaustive analysis of every word in your example: <strong>gloss as little as possible</strong>, just focusing on what is <strong>relevant</strong> with respect to the question you are answering.
</p>
<p>
  Whenever possible, use the glosses provided in the list below. If you need further instructions/details, check the
  <a href="https://www.eva.mpg.de/lingua/pdf/Glossing-Rules.pdf" target="_blank" rel="noopener noreferrer">Leipzig Glossing Rules</a>.
</p>
<p>
  If your example comes from a published source, you may keep the original glosses unchanged. Please cite your source in the references box.
</p>

<table>
  <thead>
    <tr><th>Gloss</th><th>Meaning</th></tr>
  </thead>
  <tbody>
    <tr><td>1</td><td>first person</td></tr>
    <tr><td>2</td><td>second person</td></tr>
    <tr><td>3</td><td>third person</td></tr>
    <tr><td>ACC</td><td>accusative</td></tr>
    <tr><td>ART</td><td>article</td></tr>
    <tr><td>CLF</td><td>classifier</td></tr>
    <tr><td>CLI</td><td>clitic</td></tr>
    <tr><td>DAT</td><td>dative</td></tr>
    <tr><td>DEF</td><td>definiteness marker</td></tr>
    <tr><td>DEM</td><td>demonstrative</td></tr>
    <tr><td>F</td><td>feminine</td></tr>
    <tr><td>GEN</td><td>genitive</td></tr>
    <tr><td>LK</td><td>linker</td></tr>
    <tr><td>LOC</td><td>locative</td></tr>
    <tr><td>M</td><td>masculine</td></tr>
    <tr><td>N</td><td>neuter</td></tr>
    <tr><td>NEG</td><td>negation, negative item</td></tr>
    <tr><td>NOM</td><td>nominative</td></tr>
    <tr><td>OBL</td><td>oblique</td></tr>
    <tr><td>PL</td><td>plural</td></tr>
    <tr><td>POSS</td><td>possessive</td></tr>
    <tr><td>REL</td><td>relative</td></tr>
    <tr><td>SG</td><td>singular</td></tr>
    <tr><td>VOC</td><td>vocative</td></tr>
  </tbody>
</table>

<p>In the following table, we provide some examples to be used as a model.</p>

<table>
  <thead>
    <tr><th>Form</th><th>Description</th><th>Gloss</th></tr>
  </thead>
  <tbody>
    <tr><td>I</td><td>1st person pronoun, subject</td><td>1SG.NOM</td></tr>
    <tr><td>she</td><td>3rd person pronoun, feminine, subject</td><td>3SG.F.NOM</td></tr>
    <tr><td>vi</td><td>2nd person pronoun, plural, accusative/dative, clitic</td><td>2PL.ACC/DAT.CLI</td></tr>
    <tr><td>suo</td><td>3rd person, singular, possessive, masculine</td><td>3SG.POSS.M.SG</td></tr>
    <tr><td>sua</td><td>3rd person, singular, possessive, feminine</td><td>3SG.POSS.F.SG</td></tr>
    <tr><td rowspan="3">τον</td><td>(definite) article, masculine, singular, accusative</td><td>ART.M.SG.ACC</td></tr>
    <tr><td>the, masculine, singular, accusative</td><td>DEF.M.SG.ACC</td></tr>
    <tr><td>the, masculine, singular, accusative</td><td>the.M.SG.ACC</td></tr>
    <tr><td rowspan="2">bambin-o<br><em>or</em><br>bambino</td><td>child, masculine, singular</td><td>child-M.SG</td></tr>
    <tr><td>child, masculine, singular</td><td>child.M.SG</td></tr>
    <tr><td colspan="3"><strong>il libro nuovo che ho letto</strong> — &ldquo;the new book I read&rdquo;</td></tr>
    <tr><td>il</td><td>(definite) article, masculine, singular</td><td>ART.M.SG / DEF.M.SG / the.M.SG</td></tr>
    <tr><td>libro</td><td>book, masculine, singular</td><td>book.M.SG</td></tr>
    <tr><td>nuovo</td><td>new, masculine, singular</td><td>new.M.SG</td></tr>
    <tr><td>che</td><td>relative</td><td>REL</td></tr>
    <tr><td>ho</td><td>have, 1st person, singular</td><td>have.1SG</td></tr>
    <tr><td>letto</td><td>read</td><td>read</td></tr>
    <tr><td colspan="3"><strong>ο βασιλιάς έφυγε</strong> — &ldquo;the king has left&rdquo;</td></tr>
    <tr><td>ο</td><td>(definite) article, masculine, singular, nominative</td><td>ART.M.SG.NOM / DEF.M.SG.NOM / the.M.SG.NOM</td></tr>
    <tr><td>βασιλιάς</td><td>king, masculine, singular, nominative</td><td>king.M.SG.NOM</td></tr>
    <tr><td>έφυγε</td><td>leave, 3rd person, singular, past</td><td>leave.3SG.PST</td></tr>
  </tbody>
</table>
`.trim();
