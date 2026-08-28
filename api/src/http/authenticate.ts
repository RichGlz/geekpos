import type { FastifyReply, FastifyRequest } from "fastify";
import type { TransactionalDb } from "../db/pool.js";
import { unauthorized } from "../lib/errors.js";
import type { TokenSigner } from "../lib/jwt.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { assertOperationAllowed, resolveStatus } from "../services/license.service.js";

export interface AuthenticateDeps {
  db: TransactionalDb;
  signer: TokenSigner;
}

/**
 * preHandler que construye el contexto autenticado.
 *
 * Un guard de ruta en el frontend no protege nada: cada endpoint privado pasa
 * por aquí, valida el token, comprueba que la sesión siga viva y resuelve el
 * organization_id y la licencia en servidor.
 */
export function makeAuthenticate(deps: AuthenticateDeps) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw unauthorized("Necesitas iniciar sesión.", "AUTH_REQUIRED");
    }

    const claims = await deps.signer.verify(header.slice(7).trim());

    const session = await sessionRepository.findActiveById(deps.db, claims.sid);
    if (!session || session.userId !== claims.sub) {
      throw unauthorized("Sesión revocada. Inicia sesión de nuevo.", "SESSION_REVOKED");
    }

    const user = await userRepository.findById(deps.db, claims.sub);
    if (!user || !user.isActive) {
      throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "SESSION_REVOKED");
    }

    /**
     * Coincidencia COMPLETA de tenant: usuario, sesión y claim `org` del token
     * deben apuntar a la misma organización. Cualquier discrepancia invalida la
     * sesión con un 401 genérico; el detalle queda solo en el log del servidor.
     */
    const orgClaim = claims.org ?? null;
    if (user.organizationId !== session.organizationId || user.organizationId !== orgClaim) {
      request.log.warn(
        {
          sessionId: claims.sid,
          userId: claims.sub,
          userOrg: user.organizationId,
          sessionOrg: session.organizationId,
          tokenOrg: orgClaim,
        },
        "discrepancia de tenant en el contexto autenticado",
      );
      throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "SESSION_REVOKED");
    }

    const licenseStatus = claims.org ? await resolveStatus(deps.db, claims.org) : null;

    request.ctx = {
      userId: claims.sub,
      sessionId: claims.sid,
      organizationId: user.organizationId,
      isPlatformAdmin: user.isPlatformAdmin,
      roles: claims.roles,
      permissions: claims.perms,
      licenseStatus,
    };
  };
}

/**
 * preHandler que aplica el estado de licencia según el método HTTP.
 *
 * Es `async` a propósito: Fastify solo trata un hook como basado en promesas
 * si devuelve un thenable. Un hook síncrono de aridad 2 deja la petición
 * esperando un `done` que nunca llega.
 */
export async function enforceLicense(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const status = request.ctx?.licenseStatus;
  if (!status) return;
  if (request.ctx?.isPlatformAdmin) return;
  assertOperationAllowed(status, request.method);
}
