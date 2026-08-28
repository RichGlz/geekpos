import type { Db } from "../db/pool.js";

/**
 * Registro de intentos de login para el backoff temporal.
 * Se cuentan por separado por correo y por IP para que un tercero no pueda
 * dejar fuera indefinidamente al titular de una cuenta.
 */
export async function insert(
  db: Db,
  input: { id: string; emailNormalized: string; ipAddress: string | null; succeeded: boolean },
): Promise<void> {
  await db.query(
    `INSERT INTO login_attempts (id, email_normalized, ip_address, succeeded)
     VALUES ($1, $2, $3, $4)`,
    [input.id, input.emailNormalized, input.ipAddress, input.succeeded],
  );
}

export async function countRecentFailures(
  db: Db,
  input: { emailNormalized: string; ipAddress: string | null; since: Date },
): Promise<{ byEmail: number; byIp: number; lastFailureAt: Date | null }> {
  const { rows } = await db.query<{ by_email: string; by_ip: string; last_failure_at: Date | null }>(
    `SELECT
       COUNT(*) FILTER (WHERE email_normalized = $1) AS by_email,
       COUNT(*) FILTER (WHERE $2::text IS NOT NULL AND ip_address = $2) AS by_ip,
       MAX(created_at) FILTER (WHERE email_normalized = $1 OR ($2::text IS NOT NULL AND ip_address = $2)) AS last_failure_at
     FROM login_attempts
     WHERE succeeded = false AND created_at >= $3`,
    [input.emailNormalized, input.ipAddress, input.since],
  );
  const row = rows[0];
  return {
    byEmail: Number(row?.by_email ?? 0),
    byIp: Number(row?.by_ip ?? 0),
    lastFailureAt: row?.last_failure_at ? new Date(row.last_failure_at) : null,
  };
}

/** Tras un login correcto se limpian los fallos previos de esa cuenta. */
export async function clearFailuresForEmail(db: Db, emailNormalized: string): Promise<void> {
  await db.query(`DELETE FROM login_attempts WHERE email_normalized = $1 AND succeeded = false`, [
    emailNormalized,
  ]);
}

export async function deleteOlderThan(db: Db, before: Date): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM login_attempts WHERE created_at < $1`, [before]);
  return rowCount ?? 0;
}
