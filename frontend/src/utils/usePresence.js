import { useState, useEffect } from 'react';
import api from '../api';

// quanti altri utenti stanno modificando la stessa pagina

// deve restare sotto il TTL del backend (presence.py)
const HEARTBEAT_MS = 10000;

export default function usePresence(entityType, entityId, enabled = true) {
    const [others, setOthers] = useState(0);

    useEffect(() => {
        if (!enabled || !entityType || !entityId) {
            return undefined;
        }
        let cancelled = false;
        const body = { entity_type: entityType, entity_id: entityId };

        const sendHeartbeat = async () => {
            try {
                const res = await api.post('/api/presence/heartbeat', body);
                if (!cancelled) setOthers(res.data?.others || 0);
            } catch {
                // errore di rete: riprova al prossimo giro
            }
        };

        sendHeartbeat();
        const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

        return () => {
            cancelled = true;
            clearInterval(heartbeatTimer);
            api.post('/api/presence/leave', body).catch(() => {});
            setOthers(0);
        };
    }, [entityType, entityId, enabled]);

    return others;
}
