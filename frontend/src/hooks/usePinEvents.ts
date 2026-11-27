import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { PinSummary } from '../types/api';

interface UsePinEventsOptions {
  enabled: boolean;
  onCreated: (pin: PinSummary) => void;
  onUpdated: (pin: PinSummary) => void;
  onDeleted: (pinId: string) => void;
  onResync: () => void;
}

export function usePinEvents({
  enabled,
  onCreated,
  onUpdated,
  onDeleted,
  onResync,
}: UsePinEventsOptions) {
  const [connected, setConnected] = useState(false);

  const handlersRef = useRef({ onCreated, onUpdated, onDeleted, onResync });
  handlersRef.current = { onCreated, onUpdated, onDeleted, onResync };

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let retryDelayMs = 2000;

    const cleanupSource = () => {
      if (source) {
        source.close();
        source = null;
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const connect = async () => {
      if (cancelled) return;
      cleanupSource();

      try {
        const { ticket } = await api.getSseTicket();
        if (cancelled) return;

        const es = new EventSource(`/api/events/stream?ticket=${encodeURIComponent(ticket)}`);
        source = es;

        es.addEventListener('connected', () => {
          retryDelayMs = 2000;
          setConnected(true);
        });

        es.addEventListener('pin:created', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { pin: PinSummary };
            handlersRef.current.onCreated(payload.pin);
          } catch {
            // Ignora eventos malformados
          }
        });

        es.addEventListener('pin:updated', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { pin: PinSummary };
            handlersRef.current.onUpdated(payload.pin);
          } catch {
            // Ignora eventos malformados
          }
        });

        es.addEventListener('pin:deleted', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { pinId: string };
            handlersRef.current.onDeleted(payload.pinId);
          } catch {
            // Ignora eventos malformados
          }
        });

        es.onerror = () => {
          setConnected(false);
          es.close();
          source = null;
          if (!cancelled) {
            reconnectTimer = window.setTimeout(() => {
              void connect();
            }, retryDelayMs);
            retryDelayMs = Math.min(retryDelayMs * 2, 20000);
          }
        };
      } catch {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 20000);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        handlersRef.current.onResync();
        if (!source || source.readyState === EventSource.CLOSED) {
          retryDelayMs = 2000;
          void connect();
        }
      }
    };

    void connect();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupSource();
    };
  }, [enabled]);

  return { connected };
}