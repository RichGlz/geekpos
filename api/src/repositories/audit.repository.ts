import type { Db } from "../db/pool.js";

export interface AuditEntry {
  id: string;
  organizationId: string | null;
  userId: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

export async function insert(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (id, organization_id, user_id, action, entity, entity_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.id,
      entry.organizationId,
      entry.userId,
      entry.action,
      entry.entity,
      entry.entityId,
      entry.ipAddress,
      entry.userAgent,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export async function listForOrganization(
  db: Db,
  organizationId: string,
  limit = 100,
): Promise<Array<Omit<AuditEntry, "metadata"> & { metadata: unknown; createdAt: Date }>> {
  const { rows } = await db.query<{
    id: string;
    organization_id: string | null;
    user_id: string | null;
    action: string;
    entity: string | null;
    entity_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    metadata: unknown;
    created_at: Date;
  }>(
    `SELECT id, organization_id, user_id, action, entity, entity_id, ip_address, user_agent, metadata, created_at
       FROM audit_log
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [organizationId, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
  }));
}
