import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TransactionalDb } from "../../db/pool.js";
import { enforceLicense } from "../authenticate.js";
import { getTenantContext, requestMeta } from "../context.js";
import { demandBranch, demand } from "../../services/catalog.service.js";
import { inventoryCommandSchema, parseInventory } from "../../services/inventory.schema.js";
import { executeInventoryCommand } from "../../services/inventory.service.js";
import * as inventory from "../../repositories/inventory.repository.js";

export async function inventoryRoutes(app: FastifyInstance, options: {
  db: TransactionalDb; authenticate: FastifyInstance["authenticate"];
}) {
  app.addHook("preHandler", options.authenticate);
  app.addHook("preHandler", enforceLicense);
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });

  app.post("/movements", async (request) => executeInventoryCommand(
    options.db, getTenantContext(request), parseInventory(inventoryCommandSchema, request.body), requestMeta(request),
  ));
  app.get("/movements", async (request) => {
    const input = parseInventory(z.object({
      branchId: z.string().uuid(), productId: z.string().uuid().optional(),
    }).strict(), request.query);
    const context = getTenantContext(request);
    demand(context, "inventory.manage");
    await demandBranch(options.db, context, input.branchId);
    return { movements: await inventory.listForBranch(options.db, context.organizationId, input.branchId, input.productId) };
  });
}
