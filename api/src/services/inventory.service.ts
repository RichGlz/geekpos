import { createHash, randomUUID } from "node:crypto";
import type { TransactionalDb } from "../db/pool.js";
import { calculateInventoryStock, InventoryCalculationError, type InventoryCommand } from "../lib/inventory.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { TenantContext } from "../types/domain.js";
import * as catalog from "../repositories/catalog.repository.js";
import * as inventory from "../repositories/inventory.repository.js";
import * as audit from "../repositories/audit.repository.js";
import { demand, demandBranch } from "./catalog.service.js";
import { assertOperationAllowed } from "./license.service.js";

export async function executeInventoryCommand(
  db: TransactionalDb,
  context: TenantContext,
  command: InventoryCommand,
  meta: { ipAddress: string | null; userAgent: string | null },
) {
  assertOperationAllowed(context.licenseStatus ?? "SUSPENDED", "POST");
  demand(context, "inventory.manage");
  const org = context.organizationId;
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");

  return db.transaction(async (tx) => {
    await catalog.lockOrganization(tx, org);
    await demandBranch(tx, context, command.branchId);
    const receipt = await catalog.receipt(tx, org, command.idempotencyKey);
    if (receipt) {
      if (receipt.user_id !== context.userId || receipt.payload_hash !== hash) {
        throw conflict("La clave de operación ya se usó con otros datos.", "IDEMPOTENCY_CONFLICT");
      }
      return receipt.result;
    }

    const product = await catalog.product(tx, org, command.productId);
    if (!product || !product.active || product.itemType !== "product") throw notFound("Producto no disponible para inventario.");
    const branchProduct = await inventory.lockBranchProduct(tx, org, command.branchId, command.productId);
    if (!branchProduct?.active || !branchProduct.trackInventory) {
      throw conflict("El producto no lleva control de inventario en esta sucursal.", "INVENTORY_NOT_TRACKED");
    }
    if (command.warehouseId && !await inventory.warehouseBelongsToBranch(tx, org, command.branchId, command.warehouseId)) {
      throw badRequest("El almacén no pertenece a la sucursal.");
    }
    if (command.type === "INITIAL" && await inventory.hasMovements(tx, org, command.branchId, command.productId)) {
      throw conflict("El inventario inicial ya fue registrado.", "INITIAL_INVENTORY_EXISTS");
    }
    if (command.type === "INITIAL" && !/^0(?:\.0+)?$/.test(branchProduct.stock)) {
      throw conflict("La existencia previa requiere conciliación antes del inventario inicial.", "LEGACY_STOCK_REQUIRES_REVIEW");
    }

    const previousStock = branchProduct.stock;
    let calculated: { delta: string; nextStock: string };
    try { calculated = calculateInventoryStock(product, command, branchProduct.stock); }
    catch (error) {
      if (error instanceof InventoryCalculationError && error.code === "INSUFFICIENT") {
        throw conflict(error.message, "INSUFFICIENT_STOCK");
      }
      if (error instanceof InventoryCalculationError) throw badRequest(error.message);
      throw error;
    }

    const movement = await inventory.insertMovement(tx, {
      id: command.id, organizationId: org, branchId: command.branchId, productId: command.productId,
      warehouseId: command.warehouseId ?? null, type: command.type, quantity: command.quantity,
      unit: command.unit, baseQuantityDelta: calculated.delta, userId: context.userId,
      occurredAt: command.occurredAt, comment: command.comment?.trim() || null,
      reference: command.reference?.trim() || null, idempotencyKey: command.idempotencyKey,
    });
    const updatedBranchProduct = await inventory.addToStock(tx, org, command.branchId, command.productId, movement.baseQuantityDelta);
    await catalog.recordChange(tx, org, "inventoryMovements", movement, command.branchId);
    await catalog.recordChange(tx, org, "branchProducts", updatedBranchProduct, command.branchId);

    const action = ({ INITIAL: "INVENTORY_INITIAL", ENTRY: "INVENTORY_ENTRY", EXIT: "INVENTORY_EXIT", ADJUSTMENT: "INVENTORY_ADJUSTMENT" } as const)[command.type];
    await audit.insert(tx, {
      id: randomUUID(), organizationId: org, userId: context.userId, action,
      entity: "inventory_movement", entityId: movement.id, ...meta,
      branchId: command.branchId, deviceId: command.deviceId,
      metadata: { productId: command.productId, previousStock,
        newStock: updatedBranchProduct.stock, delta: movement.baseQuantityDelta,
        unit: product.baseUnit, reason: movement.comment, reference: movement.reference },
    });
    const result = { movement, branchProduct: updatedBranchProduct };
    await catalog.saveReceipt(tx, org, command.idempotencyKey, context.userId, hash, result);
    return result;
  });
}
