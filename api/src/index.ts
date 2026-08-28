import { loadEnv } from "./config/env.js";
import { createDb, createPool } from "./db/pool.js";
import { buildApp } from "./http/app.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL, env.DATABASE_SSL);
  const db = createDb(pool);
  const app = await buildApp({ env, db });

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "cerrando la API");
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("SIGTERM", () => void close("SIGTERM"));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  process.stderr.write(`✖ la API no pudo arrancar: ${(error as Error).message}\n`);
  process.exit(1);
});
