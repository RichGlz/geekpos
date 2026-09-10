import type { TransactionalDb } from "../db/pool.js";
import type { TenantContext } from "../types/domain.js";
import type { CatalogChanges, Product, ProductAlias, BranchProduct } from "../lib/catalog.js";
import type { InventoryMovement } from "../lib/inventory.js";
import { badRequest } from "../lib/errors.js";
import * as repo from "../repositories/catalog.repository.js";
import { hasPermission } from "../http/context.js";
import { demandBranch } from "./catalog.service.js";
import { assertOperationAllowed } from "./license.service.js";

export async function pullChanges(db: TransactionalDb, context: TenantContext,
  input: { since: string; branchId?: string; version: number }) {
  assertOperationAllowed(context.licenseStatus ?? "SUSPENDED", "GET");
  if (input.version !== 1) throw badRequest("Versión de sincronización no soportada.");
  if (input.branchId) await demandBranch(db, context, input.branchId);
  const until = await repo.version(db, context.organizationId);
  if (BigInt(input.since) > BigInt(until)) throw badRequest("Cursor posterior al servidor. Se requiere revisar el caché local.");
  const rows = await repo.changes(db, context.organizationId, input.since, until, input.branchId ?? null, 501);
  const page = rows.slice(0, 500);
  const changes: CatalogChanges = { products: [], productAliases: [], branchProducts: [], inventoryMovements: [] };
  for (const row of page) {
    if (row.entity === "products") changes.products.push(row.data as Product);
    if (row.entity === "productAliases") changes.productAliases.push(row.data as ProductAlias);
    if (row.entity === "branchProducts") {
      const branch = row.data as BranchProduct;
      changes.branchProducts.push({ ...branch, cost: hasPermission(context, "cost.read") ? branch.cost : null });
    }
    if (row.entity === "inventoryMovements") changes.inventoryMovements!.push(row.data as InventoryMovement);
  }
  return {
    version: 1, serverTime: new Date().toISOString(), changes, hasMore: rows.length > 500,
    syncVersion: rows.length > 500 ? page[page.length - 1]!.version : until,
  };
}
