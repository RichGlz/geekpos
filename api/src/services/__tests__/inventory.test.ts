import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inventoryCommandSchema } from "../inventory.schema.js";
import { calculateInventoryStock } from "../../lib/inventory.js";

const product = { baseUnit: "kg", conversions: [{ name: "bulto", factor: "20" }] };
const base = {
  id: randomUUID(), idempotencyKey: randomUUID(), deviceId: randomUUID(), branchId: randomUUID(),
  productId: randomUUID(), type: "ENTRY" as const, quantity: "1", unit: "kg",
  occurredAt: new Date().toISOString(),
};

describe("inventory movement rules", () => {
  it("calculates initial, entry, exit, adjustment and presentation conversion", () => {
    expect(calculateInventoryStock(product, { type: "INITIAL", quantity: "10", unit: "kg" }, "0")).toEqual({ delta: "10", nextStock: "10" });
    expect(calculateInventoryStock(product, { type: "ENTRY", quantity: "2", unit: "bulto" }, "10")).toEqual({ delta: "40", nextStock: "50" });
    expect(calculateInventoryStock(product, { type: "EXIT", quantity: "3", unit: "kg" }, "50")).toEqual({ delta: "-3", nextStock: "47" });
    expect(calculateInventoryStock(product, { type: "ADJUSTMENT", quantity: "-2", unit: "kg" }, "47")).toEqual({ delta: "-2", nextStock: "45" });
  });

  it("requires a reason for adjustments and positive quantities elsewhere", () => {
    expect(inventoryCommandSchema.safeParse({ ...base, type: "ADJUSTMENT", quantity: "-1" }).success).toBe(false);
    expect(inventoryCommandSchema.safeParse({ ...base, type: "ADJUSTMENT", quantity: "-1", comment: "Conteo" }).success).toBe(true);
    expect(inventoryCommandSchema.safeParse({ ...base, quantity: "-1" }).success).toBe(false);
    expect(() => calculateInventoryStock(product, { type: "EXIT", quantity: "2", unit: "kg" }, "1")).toThrow(/negativas/i);
  });
});
