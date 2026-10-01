import { Download, BookMarked, GraduationCap } from 'lucide-react';

// per pubblicare un manuale: PDF in public/docs e available: true

// admin: manuale completo; linguisti: manuale utente
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
            en: { available: true, file: '/docs/PCM-Hub_manual_complete_en.pdf' },
            it: { available: true, file: '/docs/PCM-Hub_manuale_completo_it.pdf' },
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
            en: { available: true, file: '/docs/PCM-Hub_manual_user_en.pdf' },
            it: { available: true, file: '/docs/PCM-Hub_manuale_utente_it.pdf' },
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
    const role = localStorage.getItem('role');
    const audience = role === 'admin' ? 'admin' : role === 'user' ? 'user' : null;
    const visible = audience ? MANUALS.filter((manual) => manual.audience === audience) : [];

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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-grid-gap, 1rem)', marginTop: 'var(--form-col-gap, 1.5rem)' }}>
                {visible.map((manual) => {
                    const Icon = manual.icon;
                    return (
                        <div key={manual.id} className="card" style={{ padding: 'var(--form-box-pad, 1.25rem)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                <Icon size={20} />
                                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{manual.title}</h2>
                            </div>
                            <p className="muted" style={{ marginTop: 0 }}>{manual.description}</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.6rem' }}>
                                <DownloadButton label="English (PDF)" entry={manual.files.en} />
                                <DownloadButton label="Italiano (PDF)" entry={manual.files.it} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
