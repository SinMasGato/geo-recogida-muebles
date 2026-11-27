import { query } from '../../config/database';

export interface AuditLogInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export const auditRepository = {
  async log(entry: AuditLogInput): Promise<void> {
    await query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::inet)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.metadata ?? {}),
        entry.ipAddress || null,
      ]
    );
  },
};