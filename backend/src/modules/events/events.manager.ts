import crypto from 'crypto';
import { Response } from 'express';

export type SseEventType = 'pin:created' | 'pin:updated' | 'pin:deleted';

interface SseTicket {
  userId: string;
  expiresAt: number;
}

interface SseClient {
  id: string;
  userId: string;
  res: Response;
  heartbeatTimer: NodeJS.Timeout;
}

const TICKET_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_CONNECTIONS_PER_USER = 3;

class SseManager {
  private tickets = new Map<string, SseTicket>();
  private clients = new Map<string, SseClient>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    // Limpia tickets expirados que nunca se usaron (.unref() evita bloquear el cierre de Node)
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [ticket, data] of this.tickets.entries()) {
        if (data.expiresAt <= now) {
          this.tickets.delete(ticket);
        }
      }
    }, 60_000);
    this.cleanupTimer.unref();
  }

  issueTicket(userId: string): { ticket: string; expiresInSeconds: number } {
    const ticket = crypto.randomBytes(32).toString('hex');
    this.tickets.set(ticket, {
      userId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return { ticket, expiresInSeconds: TICKET_TTL_MS / 1000 };
  }

  consumeTicket(ticket: string): string | null {
    const record = this.tickets.get(ticket);
    if (!record) return null;

    // Un solo uso: se elimina en el acto
    this.tickets.delete(ticket);

    if (record.expiresAt <= Date.now()) {
      return null;
    }
    return record.userId;
  }

  addClient(userId: string, res: Response): string {
    // Si el usuario ya tiene 3 pestañas/móviles abiertos, cierra la conexión más antigua
    const userClients = Array.from(this.clients.values()).filter((c) => c.userId === userId);
    if (userClients.length >= MAX_CONNECTIONS_PER_USER) {
      const oldest = userClients[0];
      this.removeClient(oldest.id);
      oldest.res.end();
    }

    const clientId = crypto.randomUUID();

    // Latido cada 25s para mantener viva la conexión en redes móviles 4G/5G
    const heartbeatTimer = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref();

    this.clients.set(clientId, { id: clientId, userId, res, heartbeatTimer });

    // Confirmación inicial al cliente móvil
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

    return clientId;
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    clearInterval(client.heartbeatTimer);
    this.clients.delete(clientId);
  }

  broadcast(event: SseEventType, payload: Record<string, unknown>): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients.values()) {
      client.res.write(message);
    }
  }

  closeAll(): void {
    clearInterval(this.cleanupTimer);
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeatTimer);
      client.res.end();
    }
    this.clients.clear();
    this.tickets.clear();
  }
}

export const sseManager = new SseManager();