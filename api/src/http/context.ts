import type { FastifyRequest } from "fastify";
import type { RequestContext, TenantContext } from "../types/domain.js";
import { forbidden, unauthorized } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Contexto autenticado. `organizationId` viene SIEMPRE de la sesión. */
    ctx?: RequestContext;
  }
}

export function getContext(request: FastifyRequest): RequestContext {
  if (!request.ctx) throw unauthorized("Necesitas iniciar sesión.", "AUTH_REQUIRED");
  return request.ctx;
}

/**
 * Devuelve un contexto garantizado de organización.
 *
 * Regla de oro del modelo multiempresa: cualquier `organization_id` que llegue
 * en body/query/headers se ignora. La única fuente válida es la sesión.
 */
export function getTenantContext(request: FastifyRequest): TenantContext {
  const context = getContext(request);
  if (!context.organizationId) {
    throw forbidden(
      "Tu usuario no pertenece a ninguna organización.",
      "ORGANIZATION_CONTEXT_REQUIRED",
    );
  }
  return context as TenantContext;
}

/**
 * Única fuente de verdad de autorización.
 *
 * Reglas: administrador de plataforma -> permitido; comodín `*` -> permitido;
 * permiso exacto -> permitido; cualquier otra cosa -> denegado.
 * `users.*` NO es un comodín: solo el literal `*` lo es.
 */
export function hasPermission(
  context: Pick<RequestContext, "isPlatformAdmin" | "permissions">,
  permission: string,
): boolean {
  if (context.isPlatformAdmin) return true;
  if (context.permissions.includes("*")) return true;
  return context.permissions.includes(permission);
}

export function requirePermission(request: FastifyRequest, permission: string): RequestContext {
  const context = getContext(request);
  if (!hasPermission(context, permission)) {
    throw forbidden("No tienes permiso para realizar esta acción.", "PERMISSION_DENIED");
  }
  return context;
}

export function requestMeta(request: FastifyRequest): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
