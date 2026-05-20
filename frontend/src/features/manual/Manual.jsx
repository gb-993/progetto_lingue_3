import { Download, BookMarked, GraduationCap } from 'lucide-react';

// =============================================================================
// Pagina "Manual": raccoglie i manuali utente scaricabili in PDF.
//
// È volutamente separata da "Instructions" (che serve solo a spiegare come
// compilare le question): i linguisti non volevano mescolare le due cose.
//
// I PDF sono file statici serviti da Vite da `frontend/public/docs/`.
// Per pubblicare/aggiornare un manuale: (1) genera il PDF, (2) mettilo in
// `frontend/public/docs/`, (3) imposta `available: true` e il `file` qui sotto.
// Finché `available` è false la voce resta visibile ma disabilitata
// ("in preparazione"), così la pagina mostra già la struttura definitiva.
// =============================================================================

// `audience` decide chi vede la voce: gli admin vedono il manuale completo
// (che include anche la parte utente), i linguisti solo quello utente.
const MANUALS = [
    {
        id: 'complete',
        audience: 'admin',
        icon: BookMarked,
        title: 'Complete manual (linguists + administrators)',
        description:
            'Full guide covering everything: data entry for linguists plus all the ' +
            'admin-only features (parameters, questions, accounts, backups, exports…).',
        files: {
            // Phase 2: drop the rewritten PDFs and flip `available` to true.
            en: { available: false, file: '/docs/PCM-Hub_manual_complete_en.pdf' },
            it: { available: false, file: '/docs/PCM-Hub_manuale_completo_it.pdf' },
        },
    },
    {
        id: 'user',
        audience: 'user',
        icon: GraduationCap,
        title: 'User manual (linguists)',
        description:
            'Streamlined guide for the people who compile languages, without the ' +
            'administration sections.',
        files: {
            en: { available: false, file: '/docs/PCM-Hub_manual_user_en.pdf' },
            it: { available: false, file: '/docs/PCM-Hub_manuale_utente_it.pdf' },
        },
    },
];

function DownloadButton({ label, entry }) {
    if (!entry.available) {
        return (
            <span
                className="btn"
                aria-disabled="true"
                title="Coming soon"
                style={{ opacity: 0.5, cursor: 'not-allowed', pointerEvents: 'none' }}
            >
                <Download size={16} className="nav-icon" />
                <span>{label} — coming soon</span>
            </span>
        );
    }
    return (
        <a className="btn btn--primary" href={entry.file} download>
            <Download size={16} className="nav-icon" />
            <span>{label}</span>
        </a>
    );
}

export default function Manual() {
    // Gli admin (incl. super-admin: hanno comunque role 'admin') vedono il
    // manuale completo; i linguisti quello utente. I 'public' non hanno manuali.
    const role = localStorage.getItem('role');
    const audience = role === 'admin' ? 'admin' : role === 'user' ? 'user' : null;
    const visible = audience ? MANUALS.filter((m) => m.audience === audience) : [];

    return (
        <div className="container" style={{ paddingBottom: '4rem' }}>
            <header className="dashboard-hero">
                <h1 style={{ margin: 0 }}>Manual</h1>
            </header>

            <p className="muted" style={{ marginTop: '0.75rem' }}>
                Downloadable PDF manuals for the PCM-Hub. For step-by-step help while
                entering data, see the <strong>Instructions</strong> page.
            </p>

            {visible.length === 0 && (
                <p className="muted" style={{ marginTop: '1.5rem' }}>
                    No manuals are available for your account.
                </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                {visible.map((m) => {
                    const Icon = m.icon;
                    return (
                        <div key={m.id} className="card" style={{ padding: '1.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                <Icon size={20} />
                                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{m.title}</h2>
                            </div>
                            <p className="muted" style={{ marginTop: 0 }}>{m.description}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.6rem' }}>
                                <DownloadButton label="English (PDF)" entry={m.files.en} />
                                <DownloadButton label="Italiano (PDF)" entry={m.files.it} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
