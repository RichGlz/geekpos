import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { BranchProduct, Product } from "@/lib/catalog";
import type { InventoryCommand } from "@/lib/inventory";
import { atomic, scopedRow, STORE_BRANCH_PRODUCTS, STORE_INVENTORY_MOVEMENTS, STORE_PRODUCTS } from "../idb";
import { commitPage, readCatalog } from "../catalogDb";
import { queueInventoryMovement } from "../inventoryDb";
import { clear, list } from "../syncQueue";

const scope = "inventory-test-scope", organizationId = "org", userId = "user", branchId = "branch";
const product: Product = {
  id: "product", organizationId, displayName: "Harina", normalizedName: "harina", compactKey: "harina",
  barcode: "001", description: "", category: "", sku: "HAR-1", itemType: "product",
  baseUnit: "kg", conversions: [{ name: "bulto", factor: "20" }], assetId: null,
  active: true, revision: 1, updatedAt: new Date().toISOString(),
};
let branchProduct: BranchProduct;

function command(type: InventoryCommand["type"], quantity: string, comment: string | null = null): InventoryCommand {
  return {
    id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), deviceId: crypto.randomUUID(),
    branchId, productId: product.id, type, quantity, unit: "kg",
    occurredAt: new Date().toISOString(), comment,
  };
}
async function queue(value: InventoryCommand) {
  const result = await queueInventoryMovement({ scope, organizationId, userId, product, branchProduct, command: value });
  branchProduct = result.branchProduct;
  return result;
}

beforeEach(async () => {
  await clear();
  branchProduct = {
    id: "branch-product", organizationId, branchId, productId: product.id,
    price: "10.00", cost: null, stock: "0", trackInventory: true, active: true,
    revision: 1, updatedAt: new Date().toISOString(),
  };
  await atomic([STORE_PRODUCTS, STORE_BRANCH_PRODUCTS, STORE_INVENTORY_MOVEMENTS], (tx) => {
    tx.objectStore(STORE_PRODUCTS).clear();
    tx.objectStore(STORE_BRANCH_PRODUCTS).clear();
    tx.objectStore(STORE_INVENTORY_MOVEMENTS).clear();
    tx.objectStore(STORE_PRODUCTS).put(scopedRow(scope, product.id, product));
    tx.objectStore(STORE_BRANCH_PRODUCTS).put(scopedRow(scope, branchProduct.id, branchProduct));
  });
});

describe("local-first inventory", () => {
  it("derives stock from initial, entry, exit and adjustment movements", async () => {
    await queue(command("INITIAL", "10", "Conteo inicial"));
    await queue(command("ENTRY", "5", "Compra"));
    await queue(command("EXIT", "3", "Consumo"));
    await queue(command("ADJUSTMENT", "-2", "Diferencia de conteo"));

    const local = await readCatalog(scope);
    expect(local.branchProducts[0]?.stock).toBe("10");
    expect(local.inventoryMovements.map((movement) => movement.baseQuantityDelta)).toEqual(
      expect.arrayContaining(["10", "5", "-3", "-2"]),
    );
    expect(local.inventoryMovements.every((movement) => movement.syncState === "PENDING_SYNC")).toBe(true);
    expect(await list()).toHaveLength(4);
  });

  it("converts presentations, rejects invalid adjustments and prevents duplicate local delivery", async () => {
    const byPackage = { ...command("INITIAL", "2", "Inicio"), unit: "bulto" };
    await queue(byPackage);
    expect((await readCatalog(scope)).branchProducts[0]?.stock).toBe("40");
    await expect(queue(command("ADJUSTMENT", "-1"))).rejects.toThrow(/motivo/i);
    await expect(queueInventoryMovement({ scope, organizationId, userId, product, branchProduct, command: byPackage })).rejects.toThrow();
  });

  it("replaces pending data with the server confirmation and removes the queue item", async () => {
    const pending = await queue(command("INITIAL", "8", "Inicio"));
    await commitPage(scope, {
      products: [], productAliases: [], branchProducts: [{ ...pending.branchProduct, stock: "8.000000" }],
      inventoryMovements: [{ ...pending.movement, syncState: "SYNCED", createdAt: "2026-09-10T12:00:00.000Z" }],
    }, { syncVersion: "1", schemaVersion: 3, currentVersion: "0.2.0", updateChannel: "stable" }, pending.movement.idempotencyKey);

    const local = await readCatalog(scope);
    expect(local.inventoryMovements[0]?.syncState).toBe("SYNCED");
    expect(await list()).toHaveLength(0);
  });
});
