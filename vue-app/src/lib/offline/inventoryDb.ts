import { toRaw } from "vue";
import type { BranchProduct, Product } from "@/lib/catalog";
import { calculateInventoryStock, type InventoryCommand, type InventoryMovement } from "@/lib/inventory";
import { atomic, scopedRow, STORE_BRANCH_PRODUCTS, STORE_INVENTORY_MOVEMENTS,
  STORE_META, STORE_SYNC_QUEUE } from "./idb";
import type { SyncOperation } from "./syncQueue";

/** Persiste movimiento, stock optimista y cola en una sola transacción local. */
export async function queueInventoryMovement(input: {
  scope: string; organizationId: string; userId: string;
  product: Product; branchProduct: BranchProduct; command: InventoryCommand;
}): Promise<{ movement: InventoryMovement; branchProduct: BranchProduct }> {
  const { command, product, branchProduct } = input;
  if (command.type !== "ADJUSTMENT" && Number(command.quantity) < 0) throw new Error("Usa una cantidad positiva.");
  if (command.type === "ADJUSTMENT" && !command.comment?.trim()) throw new Error("El ajuste requiere un motivo.");
  const calculated = calculateInventoryStock(product, command, branchProduct.stock);

  const now = new Date().toISOString();
  const movement: InventoryMovement = {
    id: command.id, organizationId: input.organizationId, branchId: command.branchId,
    productId: command.productId, warehouseId: command.warehouseId ?? null, type: command.type,
    quantity: command.quantity, unit: command.unit, baseQuantityDelta: calculated.delta,
    userId: input.userId, occurredAt: command.occurredAt, comment: command.comment?.trim() || null,
    reference: command.reference?.trim() || null, idempotencyKey: command.idempotencyKey,
    syncState: "PENDING_SYNC", createdAt: now,
  };
  const updated = { ...branchProduct, stock: calculated.nextStock, updatedAt: now };

  await atomic([STORE_INVENTORY_MOVEMENTS, STORE_BRANCH_PRODUCTS, STORE_SYNC_QUEUE, STORE_META], (tx) => {
    tx.objectStore(STORE_INVENTORY_MOVEMENTS).add(scopedRow(input.scope, movement.id, toRaw(movement)));
    tx.objectStore(STORE_BRANCH_PRODUCTS).put(scopedRow(input.scope, updated.id, toRaw(updated)));
    const clock = tx.objectStore(STORE_META).get("queueClock");
    clock.onsuccess = () => {
      const createdAt = Math.max(Date.now(), Number(clock.result?.value ?? 0) + 1);
      const operation: SyncOperation = {
        id: command.idempotencyKey, idempotencyKey: command.idempotencyKey,
        kind: "inventory.move", payload: toRaw(command), status: "PENDING", attempts: 0,
        lastError: null, createdAt, scope: input.scope, organizationId: input.organizationId,
        userId: input.userId, branchId: command.branchId,
      };
      tx.objectStore(STORE_SYNC_QUEUE).add(operation);
      tx.objectStore(STORE_META).put({ key: "queueClock", value: createdAt });
    };
  });
  return { movement, branchProduct: updated };
}
