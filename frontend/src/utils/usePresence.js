import { useState, useEffect } from 'react';
import api from '../api';

// Heartbeat di presence per l'avviso anonimo di modifica concorrente.
//
// Mentre il componente è montato e `enabled` è true, batte un heartbeat ogni
// HEARTBEAT_MS verso /api/presence/heartbeat per (entityType, entityId) e
// tiene aggiornato il numero di ALTRI utenti attivi sulla stessa entità (mai
// l'identità: solo un conteggio). All'unmount libera lo slot (best-effort);
// in caso di chiusura brusca della tab la riga scade comunque per TTL lato
// server.
//
// Uso: const others = usePresence('question', id, isEditMode && !!id);

// Battito ogni 8s. Deve restare ben sotto il TTL lato server
// (PRESENCE_TTL_SECONDS=25 in routers/presence.py): il margine TTL−heartbeat
// (~17s) assorbe un paio di battiti in ritardo/persi senza far lampeggiare il
// badge — utenti su VPN e WiFi universitario hanno battiti irregolari.
const HEARTBEAT_MS = 8000;

export default function usePresence(entityType, entityId, enabled = true) {
    const [others, setOthers] = useState(0);

    useEffect(() => {
        // Disabilitato: nessun heartbeat. `others` resta a 0 (stato iniziale o
        // azzerato dal cleanup del giro precedente).
        if (!enabled || !entityType || !entityId) {
            return undefined;
        }
        let cancelled = false;
        const body = { entity_type: entityType, entity_id: entityId };

        const beat = async () => {
            try {
                const res = await api.post('/api/presence/heartbeat', body);
                if (!cancelled) setOthers(res.data?.others || 0);
            } catch {
                // rete/errore transitorio: riprova al prossimo giro, niente alert
            }
        };

        beat();
        const timer = setInterval(beat, HEARTBEAT_MS);

        return () => {
            cancelled = true;
            clearInterval(timer);
            // Libera subito lo slot (altrimenti scade per TTL).
            api.post('/api/presence/leave', body).catch(() => {});
            setOthers(0);
        };
    }, [entityType, entityId, enabled]);

    return others;
}
