import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TransactionalDb } from "../../db/pool.js";
import type { AppEnv } from "../../config/env.js";
import { enforceLicense } from "../authenticate.js";
import { getTenantContext, requestMeta } from "../context.js";
import { commandSchema, parse } from "../../services/catalog.schema.js";
import { executeCatalogCommand, demand } from "../../services/catalog.service.js";
import { pullChanges } from "../../services/sync.service.js";
import { storageClient, uploadAsset, downloadAsset, MAX_IMAGE_BYTES } from "../../services/assets.service.js";
import * as repo from "../../repositories/catalog.repository.js";
import * as users from "../../repositories/user.repository.js";
import { conflict, notFound } from "../../lib/errors.js";

export async function catalogRoutes(app: FastifyInstance, options: {
  db: TransactionalDb; env: AppEnv; authenticate: FastifyInstance["authenticate"];
}) {
  const { db, env } = options;
  const storage = storageClient(env);
  app.addHook("preHandler", options.authenticate);
  app.addHook("preHandler", enforceLicense);
  app.addHook("preHandler", async (request) => {
    const context = getTenantContext(request);
    const access = await users.findRolesAndPermissions(db, context.userId);
    context.roles = access.roles;
    context.permissions = access.permissions;
    if (request.headers["x-expected-organization"] && request.headers["x-expected-organization"] !== context.organizationId ||
      request.headers["x-expected-user"] && request.headers["x-expected-user"] !== context.userId) {
      throw conflict("La sesión cambió. Vuelve a abrir el catálogo.", "CONTEXT_CHANGED");
    }
  });
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  app.get("/sync", async (request) => {
    const input = parse(z.object({
      since: z.string().regex(/^\d{1,19}$/).default("0"),
      version: z.coerce.number().int().default(1),
      branchId: z.string().uuid().optional(),
    }).strict(), request.query);
    return pullChanges(db, getTenantContext(request), input);
  });
  app.post("/sync/operations", async (request) =>
    executeCatalogCommand(db, getTenantContext(request), parse(commandSchema, request.body), requestMeta(request)));
  // All mutations use the same command contract/idempotency path, including future CSV imports.
  app.post("/products", async (request) =>
    executeCatalogCommand(db, getTenantContext(request), parse(commandSchema, request.body), requestMeta(request)));
  app.get("/assets/by-hash/:hash", async (request) => {
    const context = getTenantContext(request);
    demand(context, "catalog.manage");
    const { hash } = parse(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }), request.params);
    return { asset: await repo.assetByHash(db, context.organizationId, hash) };
  });
  app.addContentTypeParser("image/webp", { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
    (_request, body, done) => done(null, body));
  app.post("/assets", { bodyLimit: MAX_IMAGE_BYTES }, async (request) => {
    if (!Buffer.isBuffer(request.body)) throw notFound("Se requiere una imagen WebP.");
    return { asset: await uploadAsset(db, getTenantContext(request), request.body, storage) };
  });
  app.get("/assets/:id/content", async (request, reply) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), request.params);
    const bytes = await downloadAsset(db, getTenantContext(request), id, storage);
    return reply.type("image/webp").send(bytes);
  });
}
