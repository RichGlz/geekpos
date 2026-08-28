import pg from "pg";

/**
 * Contrato mínimo de base de datos que consumen los repositorios.
 * Todo el SQL de la aplicación vive en `src/repositories` y `migrations/`.
 * Ni las rutas ni los servicios reciben acceso directo al driver.
 */
export interface QueryResultLike<T> {
  rows: T[];
  rowCount: number | null;
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<T>>;
}

export interface TransactionalDb extends Db {
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

// pg devuelve NUMERIC como string para no perder precisión. Lo mantenemos así
// a propósito: el dinero y las cantidades del POS nunca pasan por float.
pg.types.setTypeParser(1700, (value: string) => value);

export function createPool(databaseUrl: string, ssl: boolean): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool: pg.Pool): TransactionalDb {
  return {
    async query(text, params) {
      const result = await pool.query(text, params ? [...params] : undefined);
      return { rows: result.rows as never[], rowCount: result.rowCount };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Db = {
          async query(text, params) {
            const result = await client.query(text, params ? [...params] : undefined);
            return { rows: result.rows as never[], rowCount: result.rowCount };
          },
        };
        const value = await fn(tx);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
