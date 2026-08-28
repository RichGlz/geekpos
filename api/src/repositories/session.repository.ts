import type { Db } from "../db/pool.js";
import type { Session } from "../types/domain.js";

interface SessionRow {
  id: string;
  organization_id: string | null;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedReason: row.revoked_reason,
  };
}

export async function insert(
  db: Db,
  input: {
    id: string;
    organizationId: string | null;
    userId: string;
    userAgent: string | null;
    ipAddress: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, organization_id, user_id, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.organizationId, input.userId, input.userAgent, input.ipAddress],
  );
}

export async function findActiveById(db: Db, sessionId: string): Promise<Session | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT id, organization_id, user_id, user_agent, ip_address, created_at, last_seen_at, revoked_at, revoked_reason
       FROM sessions
      WHERE id = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [sessionId],
  );
  const row = rows[0];
  return row ? toSession(row) : null;
}

export async function listForUser(db: Db, userId: string): Promise<Session[]> {
  const { rows } = await db.query<SessionRow>(
    `SELECT id, organization_id, user_id, user_agent, ip_address, created_at, last_seen_at, revoked_at, revoked_reason
       FROM sessions
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.map(toSession);
}

export async function touch(db: Db, sessionId: string): Promise<void> {
  await db.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [sessionId]);
}

/**
 * Revoca una sesión del propio usuario. El filtro por user_id evita que una
 * sesión pueda cerrar sesiones ajenas conociendo el id.
 */
export async function revokeForUser(
  db: Db,
  userId: string,
  sessionId: string,
  reason: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE sessions
        SET revoked_at = now(), revoked_reason = $3
      WHERE id = $2 AND user_id = $1 AND revoked_at IS NULL`,
    [userId, sessionId, reason],
  );
  return (rowCount ?? 0) > 0;
}

export async function revoke(db: Db, sessionId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE sessions
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}
