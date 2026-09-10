import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { AppEnv } from "../config/env.js";
import type { TransactionalDb } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import { createTokenSigner } from "../lib/jwt.js";
import type { AuthServiceDeps } from "../services/auth.service.js";
import { makeAuthenticate } from "./authenticate.js";
import * as healthRepository from "../repositories/health.repository.js";
import { authRoutes } from "./routes/auth.routes.js";
import { placeholderRoutes } from "./routes/placeholder.routes.js";
import { organizationRoutes } from "./routes/organization.routes.js";
import { catalogRoutes } from "./routes/catalog.routes.js";
import { localFirstRoutes } from "./routes/local-first.routes.js";
import { inventoryRoutes } from "./routes/inventory.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void;
  }
}

/** Fuente única de nombre y versión expuestos por `GET /`. */
export const API_NAME = "geeksium-pos-api";
export const API_VERSION = "0.1.0";

export interface BuildAppOptions {
  env: AppEnv;
  db: TransactionalDb;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env, db } = options;

  const app = Fastify({
    // En pruebas el logger se apaga por completo: evita ruido y no usa la
    // opción `disableRequestLogging`, obsoleta desde Fastify 5.
    logger: env.isTest ? false : { level: env.LOG_LEVEL },
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    credentials: true,
  });
  // Cortafuegos general. El backoff fino de login vive en loginThrottle.service.
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  const signer = createTokenSigner(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const authenticate = makeAuthenticate({ db, signer });
  app.decorate("authenticate", authenticate);

  const authDeps: AuthServiceDeps = {
    db,
    signer,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    throttlePolicy: {
      maxAttempts: env.LOGIN_MAX_ATTEMPTS,
      windowSeconds: env.LOGIN_WINDOW_SECONDS,
      maxLockSeconds: env.LOGIN_LOCK_MAX_SECONDS,
    },
  };

  /**
   * Formato de error uniforme.
   * En producción los 5xx se degradan a un mensaje genérico: ni stack traces
   * ni mensajes internos salen jamás al cliente.
   */
  app.setErrorHandler((raw: unknown, request, reply) => {
    const requestId = request.id;
    const error = raw as Error & { statusCode?: number; code?: string };

    if (error instanceof AppError) {
      // El 501 de los placeholders es esperado: se registra como aviso, no como fallo.
      if (error.statusCode === 501) request.log.warn({ code: error.code }, "módulo no implementado");
      else if (error.statusCode >= 500) request.log.error({ err: error }, "error de aplicación");
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.expose ? error.message : "Ocurrió un error inesperado.",
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      });
    }

    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, "error no controlado");
      return reply.status(500).send({
        error: {
          code: "INTERNAL_ERROR",
          message: "Ocurrió un error inesperado. Intenta de nuevo.",
          requestId,
        },
      });
    }

    return reply.status(statusCode).send({
      error: {
        code: (error.code as string | undefined) ?? "REQUEST_ERROR",
        message: env.isProduction ? "La solicitud no pudo procesarse." : error.message,
        requestId,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: "Recurso no encontrado.", requestId: request.id },
    }),
  );

  app.get("/", async () => ({ name: API_NAME, version: API_VERSION, status: "ok" }));

  app.get("/health", async (request, reply) => {
    let database: "up" | "down" = "down";
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000),
      );
      database = (await Promise.race([healthRepository.ping(db), timeout])) ? "up" : "down";
    } catch (error) {
      request.log.error({ err: error }, "health check de base de datos fallido");
      database = "down";
    }

    if (database !== "up") {
      // Sin detalles del driver: solo el estado y el requestId para correlación.
      return reply
        .status(503)
        .send({ status: "degraded", database, requestId: request.id });
    }
    return {
      status: "ok",
      database,
      ...(env.isProduction ? {} : { uptime: Math.round(process.uptime()) }),
    };
  });

  await app.register(
    async (api) => {
      await api.register(async (scope) => authRoutes(scope, { env, deps: authDeps, authenticate }), {
        prefix: "/auth",
      });
      await api.register(
        async (scope) => {
          // La licencia se aplica DENTRO de organizationRoutes, justo después
          // de authenticate: antes de autenticar no existe contexto que evaluar.
          await organizationRoutes(scope, { db, authenticate });
        },
        { prefix: "/organization" },
      );
      await api.register(async (scope) => placeholderRoutes(scope, { authenticate }));
      await api.register(async (scope) => catalogRoutes(scope, { db, env, authenticate }));
      await api.register(async (scope) => localFirstRoutes(scope, { db, env, authenticate }));
      await api.register(async (scope) => inventoryRoutes(scope, { db, authenticate }), { prefix: "/inventory" });
    },
    { prefix: "/api/v1" },
  );

  return app;
}
