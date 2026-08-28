import type { Db } from "../db/pool.js";

/** Comprobación de vida de PostgreSQL. Nunca expone detalles del driver. */
export async function ping(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ ok: number }>(`SELECT 1 AS ok`);
  return rows.length === 1;
}
