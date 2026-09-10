import type { CatalogChanges, CatalogCommand, Product, ProductAlias, BranchProduct } from "@/lib/catalog";
import { toRaw } from "vue";
import { atomic, getMeta, readScope, scopedRow, STORE_PRODUCTS, STORE_ALIASES,
  STORE_BRANCH_PRODUCTS, STORE_META, STORE_SYNC_QUEUE, STORE_IMAGES, STORE_ASSETS, type ScopedRow } from "./idb";
import { STORE_INVENTORY_MOVEMENTS } from "./idb";
import type { InventoryMovement } from "@/lib/inventory";
import type { SyncOperation } from "./syncQueue";

export interface SyncMetadata {
  lastSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  syncVersion: string;
  schemaVersion: number;
  currentVersion: string;
  updateChannel: string;
}
export const accountScope = (org: string, user: string) => JSON.stringify([org, user]);
export const catalogScope = (org: string, user: string, branch: string | null) => JSON.stringify([org, user, branch]);
export function scopeBelongsTo(scope: string | undefined, org: string, user: string): boolean {
  try { const parts: unknown = JSON.parse(scope ?? "null");
    return Array.isArray(parts) && parts.length === 3 && parts[0] === org && parts[1] === user;
  } catch { return false; }
}
/** Purge revoked branch reads, scrub costs, and replay the cursor on permission changes.
 * Unsent commands/images are deliberately preserved for their original actor's review. */
export async function reconcileAccess(org: string, user: string, allowedBranches: string[], costRead: boolean) {
  const key = "access:" + accountScope(org, user);
  const signature = JSON.stringify({ branches: [...allowedBranches].sort(), costRead });
  if (await getMeta<string>(key) === signature) return;
  await atomic([STORE_BRANCH_PRODUCTS, STORE_META], (tx) => {
    const store = tx.objectStore(STORE_BRANCH_PRODUCTS);
    const rows = store.getAll();
    rows.onsuccess = () => {
      for (const row of rows.result as ScopedRow<BranchProduct>[]) {
        if (!scopeBelongsTo(row.scope, org, user)) continue;
        if (!allowedBranches.includes(row.value.branchId)) store.delete(row.key);
        else if (!costRead) store.put({ ...row, value: { ...row.value, cost: null } });
      }
    };
    const metas = tx.objectStore(STORE_META).getAll();
    metas.onsuccess = () => {
      for (const row of metas.result as Array<{ key: string; value: SyncMetadata }>) {
        if (row.key.startsWith("sync:") && scopeBelongsTo(row.key.slice(5), org, user)) {
          tx.objectStore(STORE_META).put({ ...row, value: { ...row.value, syncVersion: "0" } });
        }
      }
      tx.objectStore(STORE_META).put({ key, value: signature });
    };
  });
}
export interface CachedAsset { id: string; blob: Blob; sizeBytes: number; cachedAt: number }
export const MAX_CACHED_ASSET_BYTES = 25 * 1024 * 1024;
/** Evict only confirmed, downloadable assets. Never inspect/delete pending_images here. */
export function putCachedAsset(tx: IDBTransaction, scope: string, id: string, blob: Blob) {
  const store = tx.objectStore(STORE_ASSETS);
  const value: CachedAsset = { id, blob, sizeBytes: blob.size, cachedAt: Date.now() };
  const target = scopedRow(scope, id, value);
  const request = store.getAll();
  request.onsuccess = () => {
    const rows = (request.result as ScopedRow<CachedAsset>[]).filter((r) => r.key !== target.key)
      .sort((a, b) => (a.value.cachedAt ?? 0) - (b.value.cachedAt ?? 0));
    let bytes = rows.reduce((sum, r) => sum + (r.value.sizeBytes ?? r.value.blob.size), blob.size);
    for (const row of rows) {
      if (bytes <= MAX_CACHED_ASSET_BYTES) break;
      store.delete(row.key); bytes -= row.value.sizeBytes ?? row.value.blob.size;
    }
    store.put(target);
  };
}
export async function readCatalog(scope: string) {
  const [products, aliases, branchProducts, inventoryMovements] = await Promise.all([
    readScope<Product>(STORE_PRODUCTS, scope), readScope<ProductAlias>(STORE_ALIASES, scope),
    readScope<BranchProduct>(STORE_BRANCH_PRODUCTS, scope),
    readScope<InventoryMovement>(STORE_INVENTORY_MOVEMENTS, scope),
  ]);
  return { products, aliases, branchProducts, inventoryMovements };
}
export async function commitPage(scope: string, changes: CatalogChanges, meta: SyncMetadata,
  operationId?: string): Promise<void> {
  await atomic([STORE_PRODUCTS, STORE_ALIASES, STORE_BRANCH_PRODUCTS, STORE_INVENTORY_MOVEMENTS, STORE_META, STORE_SYNC_QUEUE], (tx) => {
    for (const [store, records] of [
      [STORE_PRODUCTS, changes.products], [STORE_ALIASES, changes.productAliases],
      [STORE_BRANCH_PRODUCTS, changes.branchProducts],
    ] as const) {
      for (const record of records) tx.objectStore(store).put(scopedRow(scope, record.id, record));
    }
    for (const movement of changes.inventoryMovements ?? []) {
      tx.objectStore(STORE_INVENTORY_MOVEMENTS).put(scopedRow(scope, movement.id, movement));
    }
    tx.objectStore(STORE_META).put({ key: "sync:" + scope, value: meta });
    if (operationId) tx.objectStore(STORE_SYNC_QUEUE).delete(operationId);
  });
}
export async function metadata(scope: string): Promise<SyncMetadata | undefined> {
  return getMeta<SyncMetadata>("sync:" + scope);
}
export interface PendingImage {
  id: string; blob: Blob; contentHash: string; width: number; height: number;
  sizeBytes: number;
  status: "pending_upload"; assetId?: string;
}
export const MAX_PENDING_IMAGE_BYTES = 25 * 1024 * 1024;
export async function queueCommands(input: {
  scope: string; organizationId: string; userId: string; branchId?: string;
  commands: CatalogCommand[]; image?: PendingImage;
  replaceOperationId?: string;
}): Promise<void> {
  const { scope } = input;
  await atomic([STORE_SYNC_QUEUE, STORE_IMAGES, STORE_META], (tx) => {
    const images = tx.objectStore(STORE_IMAGES);
    const request = images.getAll();
    request.onsuccess = () => {
      const size = request.result.reduce((sum: number, r: { value: PendingImage }) => sum + r.value.sizeBytes, 0);
      if (input.image && size + input.image.sizeBytes > MAX_PENDING_IMAGE_BYTES) { tx.abort(); return; }
      if (input.image) images.put(scopedRow(scope, input.image.id, { ...toRaw(input.image), blob: toRaw(input.image.blob) }));
      const clock = tx.objectStore(STORE_META).get("queueClock");
      clock.onsuccess = () => {
      const createdAt = Math.max(Date.now(), Number(clock.result?.value ?? 0) + 1);
      for (const [index, command] of input.commands.entries()) {
        const operation: SyncOperation = {
          id: command.idempotencyKey, idempotencyKey: command.idempotencyKey, kind: "catalog.command",
          payload: command, status: "PENDING", attempts: 0, lastError: null, createdAt: createdAt + index,
          scope, organizationId: input.organizationId, userId: input.userId,
          ...(input.branchId ? { branchId: input.branchId } : {}),
        };
        tx.objectStore(STORE_SYNC_QUEUE).add(operation);
      }
      tx.objectStore(STORE_META).put({ key: "queueClock", value: createdAt + input.commands.length });
      if (input.replaceOperationId) tx.objectStore(STORE_SYNC_QUEUE).delete(input.replaceOperationId);
      };
    };
  });
}
