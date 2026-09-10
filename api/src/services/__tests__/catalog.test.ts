import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { normalizeName, normalizeBarcode, findMatches, classifyImportRow, type Product, type ProductInput } from "../../lib/catalog.js";
import { commandSchema } from "../catalog.schema.js";
import { inspectWebP } from "../assets.service.js";

const input: ProductInput = { displayName: "Coca-Cola 600 ml", barcode: "000123", description: "", category: "",
  sku: "", itemType: "product", baseUnit: "pieza", conversions: [], assetId: null, active: true };
const product: Product = { ...input, id: randomUUID(), organizationId: randomUUID(), ...normalizeName(input.displayName),
  revision: 1, updatedAt: new Date().toISOString() };
describe("catalog rules shared with CSV and Vue", () => {
  it("normalizes accents, hyphens, spaces and units deterministically", () => {
    expect(normalizeName("  CAFÉ — 600 mililitros ")).toEqual({ normalizedName: "cafe 600 ml", compactKey: "cafe600ml" });
    expect(normalizeName("Cocacola 600ml").compactKey).toBe(product.compactKey);
    expect(normalizeName("Coca Cola 600 ml").compactKey).toBe(product.compactKey);
    expect(normalizeName("Agua 1.5 litros").compactKey).not.toBe(normalizeName("Agua 15 l").compactKey);
    expect(normalizeBarcode(" 000123 ")).toBe("000123");
  });
  it("prioritizes barcode and learns aliases without merging similar products", () => {
    expect(findMatches({ displayName: "Otra cosa", barcode: "000123" }, [product], [])[0]?.reason).toBe("barcode");
    const alias = { id: randomUUID(), organizationId: product.organizationId, productId: product.id,
      displayName: "Refresco chico", ...normalizeName("Refresco chico") };
    expect(findMatches({ displayName: "Refresco chico" }, [product], [alias])[0]?.reason).toBe("exact");
    const matches = findMatches({ displayName: "Coca-Cola Zero 600ml" }, [product], []);
    expect(matches[0]?.reason).toBe("similar");
    expect(classifyImportRow({ ...input, barcode: null, displayName: "Coca-Cola Zero 600ml" }, [product], []).status).toBe("review");
    expect(classifyImportRow({ ...input, displayName: "" }, [product], []).status).toBe("error");
  });
  it("validates money as decimal strings, revisions and bounded payloads", () => {
    const command = { kind: "branch.set", idempotencyKey: randomUUID(), deviceId: randomUUID(),
      productId: product.id, branchId: randomUUID(), expectedRevision: 0,
      branch: { price: "12.30", cost: "1.25", trackInventory: true, active: true } };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(commandSchema.safeParse({ ...command, branch: { ...command.branch, cost: null } }).success).toBe(true);
    expect(commandSchema.safeParse({ ...command, branch: { ...command.branch, cost: 1.25 } }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, expectedRevision: undefined }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, organizationId: randomUUID() }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, kind: "product.edit", product: input, expectedRevision: 1 }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, product: input }).success).toBe(false);
  });
});

export function webpFixture(width = 32, height = 24): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF"); bytes.writeUInt32LE(22, 4); bytes.write("WEBP", 8);
  bytes.write("VP8 ", 12); bytes.writeUInt32LE(10, 16);
  bytes.write("9d012a", 23, "hex"); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28);
  return bytes;
}
describe("encoded asset validation", () => {
  it("hashes processed bytes consistently and reads real header dimensions", () => {
    const a = inspectWebP(webpFixture());
    expect(a.width).toBe(32); expect(a.height).toBe(24);
    expect(inspectWebP(Buffer.from(webpFixture())).contentHash).toBe(a.contentHash);
    expect(inspectWebP(webpFixture(16)).contentHash).not.toBe(a.contentHash);
  });
  it("rejects originals, oversized assets, malformed headers and dimensions", () => {
    expect(() => inspectWebP(Buffer.from("jpeg"))).toThrow();
    expect(() => inspectWebP(webpFixture(641))).toThrow();
    expect(() => inspectWebP(Buffer.alloc(150 * 1024 + 1))).toThrow();
    const corrupted = webpFixture(); corrupted.writeUInt32LE(99, 4);
    expect(() => inspectWebP(corrupted)).toThrow();
  });
});
