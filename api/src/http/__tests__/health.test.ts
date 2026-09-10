import { describe, expect, it } from "vitest";
import { loadEnv } from "../../config/env.js";
import type { TransactionalDb } from "../../db/pool.js";
import { buildApp } from "../app.js";

const db: TransactionalDb = {
  async query<T>() { return { rows: [{ ok: 1 }] as T[], rowCount: 1 }; },
  async transaction<T>(fn: (tx: TransactionalDb) => Promise<T>) { return fn(db); },
};
function env(nodeEnv: "development" | "production") {
  return loadEnv({
    NODE_ENV: nodeEnv, DATABASE_URL: "postgres://unused", DATABASE_SSL: "false",
    JWT_SECRET: "health-test-secret-at-least-32-characters",
    LOG_LEVEL: "fatal",
    COOKIE_SECURE: nodeEnv === "production" ? "true" : "false",
  });
}

describe("GET /health exposure", () => {
  it("omits uptime in production", async () => {
    const app = await buildApp({ env: env("production"), db });
    try {
      const response = await app.inject({ url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", database: "up" });
    } finally { await app.close(); }
  });

  it("keeps uptime in development", async () => {
    const app = await buildApp({ env: env("development"), db });
    try {
      const response = await app.inject({ url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "ok", database: "up" });
      expect(response.json().uptime).toEqual(expect.any(Number));
    } finally { await app.close(); }
  });
});
