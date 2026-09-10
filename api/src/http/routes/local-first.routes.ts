import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import type { TransactionalDb } from "../../db/pool.js";
import { getTenantContext } from "../context.js";
import * as catalog from "../../repositories/catalog.repository.js";
import * as organizations from "../../repositories/organization.repository.js";
import * as users from "../../repositories/user.repository.js";
import { getLicense, effectiveStatus } from "../../services/license.service.js";

export async function localFirstRoutes(app: FastifyInstance, options: {
  db: TransactionalDb; env: AppEnv; authenticate: FastifyInstance["authenticate"];
}) {
  const { db, env } = options;
  app.addHook("preHandler", options.authenticate);
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  app.get("/license", async (request) => {
    const context = getTenantContext(request);
    const license = await getLicense(db, context.organizationId);
    const now = new Date(), status = effectiveStatus(license, now);
    const max = now.getTime() + 10 * 86_400_000;
    const limit = license?.graceUntil?.getTime() ?? license?.expiresAt?.getTime() ?? max;
    return {
      status, lastLicenseValidationAt: now.toISOString(),
      licenseOfflineValidUntil: new Date(status === "ACTIVE" || status === "GRACE" ? Math.min(max, limit) : now.getTime()).toISOString(),
    };
  });
  app.get("/sync/context", async (request) => {
    const context = getTenantContext(request);
    const [organization, branches, updateChannel, license, access] = await Promise.all([
      organizations.findById(db, context.organizationId),
      organizations.listBranchesForUser(db, context.organizationId, context.userId),
      catalog.updateChannel(db, context.organizationId),
      getLicense(db, context.organizationId),
      users.findRolesAndPermissions(db, context.userId),
    ]);
    return {
      organization, branches: branches.filter((b) => b.isActive), access,
      license: license ? { status: effectiveStatus(license), plan: license.plan, expiresAt: license.expiresAt } : null,
      release: {
        updateChannel, latestVersion: env.APP_VERSION, minimumSupportedVersion: env.APP_MINIMUM_VERSION,
        // Deploy each channel on a separate origin; a SW cannot choose a release by itself.
        deploymentChannel: env.APP_UPDATE_CHANNEL,
      },
    };
  });
}
