/**
 * Migrador propio de SQL plano.
 *
 * Se evita a propósito cualquier herramienta atada a un proveedor: las
 * migraciones son ficheros .sql estándar que se pueden aplicar igual en
 * Supabase hoy y en AWS RDS/Aurora mañana.
 *
 * Uso:  npm run migrate
 *       npm run migrate -- --dir migrations
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../src/config/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const env = loadEnv();
  const dirArgIndex = process.argv.indexOf("--dir");
  const dir = path.resolve(
    here,
    "..",
    dirArgIndex === -1 ? "migrations" : (process.argv[dirArgIndex + 1] ?? "migrations"),
  );

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM schema_migrations`);
    const applied = new Set(rows.map((row) => row.name));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      process.stdout.write(`▶ aplicando ${file}\n`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        count += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Fallo en ${file}: ${(error as Error).message}`, { cause: error });
      }
    }
    process.stdout.write(
      count === 0 ? "✔ base de datos ya actualizada\n" : `✔ ${count} migración(es) aplicada(s)\n`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`✖ ${(error as Error).message}\n`);
  process.exit(1);
});
