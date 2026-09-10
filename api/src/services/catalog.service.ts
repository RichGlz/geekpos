import { createHash, randomUUID } from "node:crypto";
import type { TransactionalDb, Db } from "../db/pool.js";
import { findMatches, normalizeBarcode, normalizeName, type CatalogCommand, type Product } from "../lib/catalog.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { TenantContext } from "../types/domain.js";
import { hasPermission } from "../http/context.js";
import * as repo from "../repositories/catalog.repository.js";
import * as branches from "../repositories/organization.repository.js";
import * as audit from "../repositories/audit.repository.js";
import { assertOperationAllowed } from "./license.service.js";

export function demand(context: TenantContext, permission: string): void {
  if (!hasPermission(context, permission)) throw forbidden("No tienes permiso para esta operación.", "PERMISSION_DENIED");
}
export async function demandBranch(db: Db, context: TenantContext, branchId: string): Promise<void> {
  if (!await branches.userHasBranch(db, context.organizationId, context.userId, branchId)) {
    throw forbidden("La sucursal no está asignada a tu usuario.", "BRANCH_FORBIDDEN");
  }
  const branch = await branches.findBranchById(db, context.organizationId, branchId);
  if (!branch?.isActive) throw forbidden("La sucursal está inactiva.", "BRANCH_INACTIVE");
}
export async function executeCatalogCommand(db: TransactionalDb, context: TenantContext,
  command: CatalogCommand, meta: { ipAddress: string | null; userAgent: string | null }) {
  assertOperationAllowed(context.licenseStatus ?? "SUSPENDED", "POST");
  demand(context, "catalog.manage");
  if (command.branch) {
    demand(context, "price.change");
    demand(context, "cost.change");
  }
  const org = context.organizationId;
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  return db.transaction(async (tx) => {
    await repo.lockOrganization(tx, org);
    if (command.branchId) await demandBranch(tx, context, command.branchId);
    const receipt = await repo.receipt(tx, org, command.idempotencyKey);
    if (receipt) {
      if (receipt.user_id !== context.userId || receipt.payload_hash !== hash) {
        throw conflict("La clave de operación ya se usó con otros datos.", "IDEMPOTENCY_CONFLICT");
      }
      return receipt.result;
    }
    const log = async (action: string, entityId: string, metadata: Record<string, unknown> = {}, branchId: string | null = null) =>
      audit.insert(tx, {
        id: randomUUID(), organizationId: org, userId: context.userId, action, entity: "product",
        entityId, ...meta, metadata, branchId, deviceId: command.deviceId,
      });
    let product = await repo.product(tx, org, command.productId);
    let reused = false;
    if (command.kind === "product.create" || command.kind === "product.edit") {
      const value = command.product!;
      if (command.kind === "product.create" && product) throw conflict("El identificador ya existe.", "PRODUCT_EXISTS");
      if (command.kind === "product.edit") {
        if (!product) throw notFound();
        if (product.revision !== command.expectedRevision) throw conflict("El producto cambió. Sincroniza y revisa tu edición.", "REVISION_CONFLICT");
      }
      const input = { ...value, barcode: normalizeBarcode(value.barcode) };
      const matches = findMatches(input, await repo.products(tx, org), await repo.aliases(tx, org),
        command.kind === "product.edit" ? command.productId : undefined);
      const barcodeMatch = matches.find((m) => m.reason === "barcode");
      if (barcodeMatch && command.kind === "product.edit") {
        throw conflict("El código de barras pertenece a otro producto.", "BARCODE_EXISTS");
      }
      if (barcodeMatch) {
        product = barcodeMatch.product;
        reused = true;
        const alias = await repo.addAlias(tx, org, randomUUID(), product.id, input.displayName, normalizeName(input.displayName));
        if (alias) await repo.recordChange(tx, org, "productAliases", alias);
      } else {
        if (matches.length && (command.kind === "product.create" ||
          product?.compactKey !== normalizeName(input.displayName).compactKey || product?.barcode !== input.barcode)) {
          if (!command.allowDuplicate) throw new AppError(409, "POSSIBLE_DUPLICATE",
            "Posible producto existente. Selecciónalo o confirma crear de todos modos.",
            { details: { matches: matches.slice(0, 8).map((m) => ({ id: m.product.id, displayName: m.product.displayName, reason: m.reason })) } });
          demand(context, "catalog.duplicate");
          if (!context.roles.some((r) => ["OWNER", "ADMIN", "SUPERVISOR"].includes(r))) {
            throw forbidden("Crear duplicados requiere Supervisor o superior.");
          }
          await log("PRODUCT_DUPLICATE_OVERRIDE", command.productId, { matches: matches.slice(0, 8).map((m) => m.product.id) });
        }
        if (input.assetId && !await repo.asset(tx, org, input.assetId)) throw badRequest("Imagen no disponible en esta organización.");
        const previous = product;
        product = await repo.saveProduct(tx, org, command.productId, input, normalizeName(input.displayName), (previous?.revision ?? 0) + 1);
        await repo.recordChange(tx, org, "products", product);
        if (!previous) await log("PRODUCT_CREATED", product.id, { name: product.displayName });
        else {
          const changed: Record<string, unknown> = {};
          for (const key of ["displayName", "barcode", "description", "category", "sku", "baseUnit", "itemType", "assetId", "active", "conversions"] as const) {
            if (JSON.stringify(previous[key]) !== JSON.stringify(product[key])) {
              changed[key] = key === "description" || key === "conversions" ? { changed: true } : { old: previous[key], new: product[key] };
            }
          }
          await log(previous.active !== product.active ? product.active ? "PRODUCT_REACTIVATED" : "PRODUCT_ARCHIVED" : "PRODUCT_EDITED", product.id, changed);
        }
      }
    }
    if (!product) throw notFound("Producto no encontrado.");
    if (command.kind === "alias.add") {
      const normalized = normalizeName(command.alias!);
      if (!normalized.compactKey) throw badRequest("Alias vacío.");
      const alias = await repo.addAlias(tx, org, randomUUID(), product.id, command.alias!, normalized);
      if (alias) {
        await repo.recordChange(tx, org, "productAliases", alias);
        await log("PRODUCT_ALIAS_ADDED", product.id, { alias: alias.displayName });
      }
    }
    let branchProduct = null;
    if (command.branch && command.branchId) {
      if (!product.active) throw conflict("Reactiva el producto antes de agregarlo a la sucursal.", "PRODUCT_ARCHIVED");
      const previous = await repo.branchProduct(tx, org, command.branchId, product.id);
      if (command.kind === "product.create" && previous) throw conflict("El producto ya está agregado a esta sucursal.", "BRANCH_PRODUCT_EXISTS");
      if (command.kind === "branch.set" && (previous?.revision ?? 0) !== command.expectedRevision) {
        throw conflict("El precio o costo cambió. Sincroniza y revisa tu edición.", "REVISION_CONFLICT");
      }
      branchProduct = await repo.saveBranchProduct(tx, org, previous?.id ?? randomUUID(), command.branchId,
        product.id, command.branch, (previous?.revision ?? 0) + 1);
      await repo.recordChange(tx, org, "branchProducts", branchProduct, command.branchId);
      for (const [field, action] of [["price", "PRODUCT_PRICE_CHANGED"], ["cost", "PRODUCT_COST_CHANGED"]] as const) {
        if (previous?.[field] !== branchProduct[field]) await log(action, product.id,
          { old: previous?.[field] ?? null, new: branchProduct[field] }, command.branchId);
      }
      if (!previous || previous.active !== branchProduct.active || previous.trackInventory !== branchProduct.trackInventory) {
        await log("BRANCH_PRODUCT_CONFIGURED", product.id, {
          active: { old: previous?.active ?? null, new: branchProduct.active },
          trackInventory: { old: previous?.trackInventory ?? null, new: branchProduct.trackInventory },
        }, command.branchId);
      }
    }
    const result = { productId: (product as Product).id, reused, product, branchProduct };
    await repo.saveReceipt(tx, org, command.idempotencyKey, context.userId, hash, result);
    return result;
  });
}
