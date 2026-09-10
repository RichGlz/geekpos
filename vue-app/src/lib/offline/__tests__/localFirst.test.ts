import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { DB_NAME, DB_VERSION, openDb, resetDbHandle, getMeta, setMeta, STORE_META, STORE_SYNC_QUEUE, STORE_PRODUCTS, readScope } from "../idb";
import { commitPage, metadata, queueCommands, readCatalog, catalogScope, reconcileAccess } from "../catalogDb";
import { createSyncManager, SYNC_INTERVAL_MS, type ManagerState } from "../syncManager";
import { licenseState, DAY_MS, type OfflineLicense } from "../license";
import { clear, list } from "../syncQueue";
import { fitImage, hashBlob, processImage } from "@/lib/images";
import type { BranchProduct, CatalogCommand, Product } from "@/lib/catalog";

beforeEach(async () => { await clear(); });
describe("persistent local-first state", () => {
  it("removes revoked branch caches and scrubs cost permissions without deleting pending work", async () => {
    const scope = catalogScope("org", "user", "branch");
    const meta = { syncVersion: "7", schemaVersion: 2, currentVersion: "0.2.0", updateChannel: "stable" };
    await commitPage(scope, { products: [], productAliases: [], branchProducts: [{
      id: "branch-product", branchId: "branch", cost: "12", price: "20",
    } as BranchProduct] }, meta);
    await reconcileAccess("org", "user", ["branch"], false);
    expect((await readCatalog(scope)).branchProducts[0]?.cost).toBeNull();
    expect((await metadata(scope))?.syncVersion).toBe("0");
    await reconcileAccess("org", "user", [], false);
    expect((await readCatalog(scope)).branchProducts).toEqual([]);
  });
  it("preserves v1 queue and metadata when upgrading to v2", async () => {
    resetDbHandle();
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(DB_NAME); del.onsuccess = () => resolve(); del.onerror = () => reject(del.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const queue = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: "id" });
        queue.createIndex("byCreatedAt", "createdAt"); queue.createIndex("byStatus", "status");
        queue.put({ id: "legacy", kind: "pos.sale", createdAt: 1, status: "PENDING", payload: { total: "10" } });
        db.createObjectStore(STORE_META, { keyPath: "key" }).put({ key: "old", value: 123 });
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    const upgraded = await openDb();
    expect(upgraded.version).toBe(DB_VERSION);
    expect(await getMeta("old")).toBe(123);
    expect((await list())[0]?.id).toBe("legacy");
  });
  it("commits page and cursor together; scope isolates different users and branches", async () => {
    const product = { id: "p1", displayName: "Café" } as Product;
    await commitPage("account-a", { products: [product], productAliases: [], branchProducts: [] },
      { syncVersion: "5", schemaVersion: 2, currentVersion: "0.2.0", updateChannel: "pilot", lastSuccessfulSyncAt: "2026-09-08T12:00:00Z" });
    expect((await metadata("account-a"))?.lastSuccessfulSyncAt).toBe("2026-09-08T12:00:00Z");
    expect((await readCatalog("account-a")).products[0]?.id).toBe("p1");
    expect(await readScope(STORE_PRODUCTS, "account-b")).toEqual([]);
    resetDbHandle();
    expect((await metadata("account-a"))?.syncVersion).toBe("5");
    await setMeta("test", { lastSyncAt: "persisted" });
    expect(await getMeta("test")).toEqual({ lastSyncAt: "persisted" });
  });
  it("persists an offline image with its operation and rejects quota overflow atomically", async () => {
    const command = { kind: "product.create", idempotencyKey: crypto.randomUUID(), productId: crypto.randomUUID() } as CatalogCommand;
    const image = { id: "hash", blob: new Blob(["webp"], { type: "image/webp" }), sizeBytes: 4, contentHash: "hash", width: 2, height: 2, status: "pending_upload" as const };
    await queueCommands({ scope: "a", organizationId: "org", userId: "user", commands: [command], image: reactive(image) });
    expect((await list())[0]?.scope).toBe("a");
    await expect(queueCommands({ scope: "a", organizationId: "org", userId: "user", commands: [{ ...command, idempotencyKey: crypto.randomUUID() }],
      image: { ...image, sizeBytes: 26 * 1024 * 1024, blob: new Blob([new Uint8Array(26 * 1024 * 1024)]) } })).rejects.toThrow();
    expect(await list()).toHaveLength(1);
  });
  it("retains data and cursor if a page write fails", async () => {
    const before = await metadata("account-a");
    await expect(commitPage("account-a", { products: [{ id: "bad", unsupported: () => 1 } as unknown as Product], productAliases: [], branchProducts: [] },
      { syncVersion: "99", schemaVersion: 2, currentVersion: "0.2.0", updateChannel: "stable" })).rejects.toThrow();
    expect(await metadata("account-a")).toEqual(before);
    expect((await readCatalog("account-a")).products.some((p) => p.id === "bad")).toBe(false);
  });
});
describe("sync scheduling", () => {
  it("shares one concurrent run and recovers after offline, with a five minute interval", async () => {
    let online = true, resolve!: () => void;
    const run = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    let state: ManagerState | undefined;
    const manager = createSyncManager({ online: () => online, active: () => true, run, changed: (s) => { state = s; } });
    const a = manager.sync(), b = manager.sync();
    expect(a).toBe(b); await Promise.resolve(); expect(run).toHaveBeenCalledTimes(1);
    resolve(); await a; expect(state?.syncState).toBe("idle");
    online = false; await manager.sync(); expect(state?.syncState).toBe("offline"); expect(run).toHaveBeenCalledTimes(1);
    online = true; const recovery = manager.sync(true); await Promise.resolve(); resolve(); await recovery;
    expect(run).toHaveBeenCalledTimes(2); expect(SYNC_INTERVAL_MS).toBe(300_000);
  });
  it("backs off server failures and does not poll while inactive", async () => {
    let now = 1000, active = true;
    const run = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValue(undefined);
    const manager = createSyncManager({ online: () => true, active: () => active, run, now: () => now, changed: () => {} });
    await manager.sync(); await manager.sync(); expect(run).toHaveBeenCalledTimes(1);
    now += 300_000; active = false; await manager.sync(); expect(run).toHaveBeenCalledTimes(1);
    active = true; await manager.sync(); expect(run).toHaveBeenCalledTimes(2);
  });
});
describe("offline license windows", () => {
  const receivedAt = Date.parse("2026-09-01T00:00:00Z");
  const license: OfflineLicense = { status: "ACTIVE", lastLicenseValidationAt: "2026-09-01T00:00:00Z",
    licenseOfflineValidUntil: "2026-09-11T00:00:00Z", receivedAt, observedAt: receivedAt };
  it.each([[0,"normal"],[2.99,"normal"],[3,"warning"],[6.99,"warning"],[7,"grace"],[9.99,"grace"],[10,"requires_validation"],[11,"requires_validation"]] as const)(
    "%s days => %s", (days, state) => expect(licenseState(license, receivedAt + days * DAY_MS)).toBe(state));
  it("does not grant time for rollback, missing validation or expired license", () => {
    expect(licenseState(license, receivedAt - DAY_MS)).toBe("requires_validation");
    expect(licenseState({ ...license, observedAt: receivedAt + 4 * DAY_MS }, receivedAt + DAY_MS)).toBe("requires_validation");
    expect(licenseState(undefined)).toBe("requires_validation");
    expect(licenseState({ ...license, status: "READ_ONLY" }, receivedAt)).toBe("requires_validation");
  });
});
describe("client image processing", () => {
  it("fits without upscaling and hashes the processed blob consistently", async () => {
    expect(fitImage(4000, 2000)).toEqual({ width: 640, height: 320 });
    expect(fitImage(100, 100)).toEqual({ width: 100, height: 100 });
    expect(await hashBlob(new Blob(["same bytes"]))).toBe(await hashBlob(new Blob(["same bytes"])));
  });
  it("uses oriented Canvas WebP, closes bitmap and fails if WebP is unavailable", async () => {
    const close = vi.fn(), drawImage = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 2000, height: 1000, close }));
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const blob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["encoded"], { type: "image/webp" })));
    const processed = await processImage(new Blob(["source"], { type: "image/jpeg" }));
    expect(processed.width).toBe(640); expect(processed.height).toBe(320);
    expect(processed.blob.type).toBe("image/webp"); expect(close).toHaveBeenCalledOnce();
    expect(blob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.7);
    blob.mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    await expect(processImage(new Blob(["source"], { type: "image/jpeg" }))).rejects.toThrow("WebP");
    context.mockRestore(); blob.mockRestore(); vi.unstubAllGlobals();
  });
});
