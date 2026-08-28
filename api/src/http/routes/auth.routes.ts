import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppEnv } from "../../config/env.js";
import { badRequest, unauthorized } from "../../lib/errors.js";
import * as authService from "../../services/auth.service.js";
import type { AuthServiceDeps } from "../../services/auth.service.js";
import { getContext, requestMeta } from "../context.js";

export const REFRESH_COOKIE = "gks_rt";

const loginSchema = z.object({
  email: z.string().trim().min(3).max(180).email("Escribe un correo válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
});

const sessionIdSchema = z.object({ id: z.string().uuid() });

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest("Los datos enviados no son válidos.", {
      fields: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

interface AuthRouteOptions {
  env: AppEnv;
  deps: AuthServiceDeps;
  authenticate: FastifyInstance["authenticate"];
}

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions): Promise<void> {
  const { env, deps, authenticate } = options;

  /**
   * El refresh token viaja SOLO en cookie HttpOnly con Path acotado al
   * endpoint de refresco. Nunca se expone al JavaScript de la aplicación.
   */
  const cookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: "/api/v1/auth",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  } as const;

  app.post("/login", async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const result = await authService.login(deps, body, requestMeta(request));

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions,
      expires: result.refreshExpiresAt,
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      licenseStatus: result.licenseStatus,
    };
  });

  app.post("/refresh", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (!presented) throw unauthorized("No hay sesión que renovar.", "NO_REFRESH_TOKEN");

    const result = await authService.refresh(deps, presented, requestMeta(request));

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions,
      expires: result.refreshExpiresAt,
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      licenseStatus: result.licenseStatus,
    };
  });

  app.post("/logout", async (request, reply) => {
    await authService.logout(
      deps,
      { sessionId: null, refreshToken: request.cookies[REFRESH_COOKIE] ?? null },
      requestMeta(request),
    );
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get("/me", { preHandler: authenticate }, async (request) => {
    const context = getContext(request);
    return {
      userId: context.userId,
      organizationId: context.organizationId,
      isPlatformAdmin: context.isPlatformAdmin,
      roles: context.roles,
      permissions: context.permissions,
      licenseStatus: context.licenseStatus,
    };
  });

  app.get("/sessions", { preHandler: authenticate }, async (request) => {
    const sessions = await authService.listSessions(deps, getContext(request));
    return { sessions };
  });

  app.delete("/sessions/:id", { preHandler: authenticate }, async (request) => {
    const params = parse(sessionIdSchema, request.params);
    await authService.revokeSession(deps, getContext(request), params.id, requestMeta(request));
    return { ok: true };
  });
}
