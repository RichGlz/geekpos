import type { Db } from "../db/pool.js";
import type { RefreshTokenRecord, RefreshTokenRevokedReason } from "../types/domain.js";

interface RefreshTokenRow {
  id: string;
  session_id: string;
  family_id: string;
  expires_at: Date;
  used_at: Date | null;
  replaced_by: string | null;
  revoked_at: Date | null;
  revoked_reason: RefreshTokenRevokedReason | null;
}

function toRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    familyId: row.family_id,
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at ? new Date(row.used_at) : null,
    replacedBy: row.replaced_by,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedReason: row.revoked_reason,
  };
}

/**
 * IMPORTANTE: `tokenHash` es un SHA-256 del secreto opaco.
 * El secreto en claro NUNCA se persiste; solo viaja en la cookie HttpOnly.
 *
 * `parentTokenId` apunta al token que se está rotando. El índice único parcial
 * sobre esa columna (migración 0003) es la barrera SQL real contra dos
 * sucesores de un mismo predecesor.
 */
export async function insert(
  db: Db,
  input: {
    id: string;
    sessionId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    parentTokenId?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, expires_at, parent_token_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.sessionId,
      input.familyId,
      input.tokenHash,
      input.expiresAt,
      input.parentTokenId ?? null,
    ],
  );
}


export async function findByHash(db: Db, tokenHash: string): Promise<RefreshTokenRecord | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    `SELECT id, session_id, family_id, expires_at, used_at, replaced_by, revoked_at, revoked_reason
       FROM refresh_tokens
      WHERE token_hash = $1
      LIMIT 1`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/**
 * Bloquea la fila del token dentro de la transacción en curso.
 * Dos refresh concurrentes se serializan aquí: el segundo espera y al
 * despertar ve el token ya rotado.
 */
export async function lockByHashForUpdate(
  db: Db,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const { rows } = await db.query<RefreshTokenRow>(
    `SELECT id, session_id, family_id, expires_at, used_at, replaced_by, revoked_at, revoked_reason
       FROM refresh_tokens
      WHERE token_hash = $1
      FOR UPDATE`,
    [tokenHash],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/**
 * Rotación condicional: solo gana quien encuentra el token sin sucesor y sin
 * revocar. Devuelve false si otra petición ya rotó ese token.
 */
export async function claimRotation(
  db: Db,
  tokenId: string,
  replacedById: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE refresh_tokens
        SET used_at = now(), replaced_by = $2, revoked_at = now(), revoked_reason = 'ROTATED'
      WHERE id = $1 AND replaced_by IS NULL AND revoked_at IS NULL`,
    [tokenId, replacedById],
  );
  return (rowCount ?? 0) === 1;
}

export async function markRotated(
  db: Db,
  tokenId: string,
  replacedById: string,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET used_at = now(), replaced_by = $2, revoked_at = now(), revoked_reason = 'ROTATED'
      WHERE id = $1`,
    [tokenId, replacedById],
  );
}

/** Revoca la familia completa: se usa en logout y ante reutilización detectada. */
export async function revokeFamily(
  db: Db,
  familyId: string,
  reason: RefreshTokenRevokedReason,
): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
  return rowCount ?? 0;
}

export async function revokeForSession(
  db: Db,
  sessionId: string,
  reason: RefreshTokenRevokedReason,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
  );
}

export async function deleteExpired(db: Db, before: Date): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM refresh_tokens WHERE expires_at < $1`, [before]);
  return rowCount ?? 0;
}
