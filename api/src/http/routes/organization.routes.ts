import type { FastifyInstance } from "fastify";
import type { TransactionalDb } from "../../db/pool.js";
import * as organizationRepository from "../../repositories/organization.repository.js";
import * as userRepository from "../../repositories/user.repository.js";
import { getLicense } from "../../services/license.service.js";
import { getTenantContext, requirePermission } from "../context.js";
import { enforceLicense } from "../authenticate.js";

interface OrganizationRouteOptions {
  db: TransactionalDb;
  authenticate: FastifyInstance["authenticate"];
}

/**
 * Todas las lecturas usan el organization_id del contexto de sesión.
 * Ningún endpoint acepta organization_id por parámetro.
 */
export async function organizationRoutes(
  app: FastifyInstance,
  options: OrganizationRouteOptions,
): Promise<void> {
  const { db, authenticate } = options;

  app.addHook("preHandler", authenticate);
  // Orden obligatorio: primero se resuelve el contexto, después se evalúa la
  // licencia sobre ese contexto (las escrituras se bloquean en READ_ONLY).
  app.addHook("preHandler", enforceLicense);

  app.get("/me", async (request) => {
    const context = getTenantContext(request);
    const [organization, license] = await Promise.all([
      organizationRepository.findById(db, context.organizationId),
      getLicense(db, context.organizationId),
    ]);
    return {
      organization,
      license: license
        ? {
            status: context.licenseStatus,
            plan: license.plan,
            expiresAt: license.expiresAt,
            graceUntil: license.graceUntil,
          }
        : null,
    };
  });

  app.get("/branches", async (request) => {
    const context = getTenantContext(request);
    // Aislamiento por sucursal: solo las asignadas en user_branches.
    return {
      branches: await organizationRepository.listBranchesForUser(
        db,
        context.organizationId,
        context.userId,
      ),
    };
  });

  app.get("/warehouses", async (request) => {
    const context = getTenantContext(request);
    return {
      warehouses: await organizationRepository.listWarehousesForUser(
        db,
        context.organizationId,
        context.userId,
      ),
    };
  });

  app.get("/users", async (request) => {
    const context = getTenantContext(request);
    requirePermission(request, "users.manage");
    return { users: await userRepository.listForOrganization(db, context.organizationId) };
  });
}
