import { defineStore } from "pinia";
import { computed, ref, watch, type WatchStopHandle } from "vue";
import { useAuthStore } from "@/modules/auth/auth.store";
import { ApiError, http } from "@/lib/http";
import { createSyncManager, type SyncState } from "@/lib/offline/syncManager";
import { accountScope, catalogScope, commitPage, metadata, readCatalog, reconcileAccess, scopeBelongsTo,
  putCachedAsset, type PendingImage, type SyncMetadata } from "@/lib/offline/catalogDb";
import { atomic, DB_VERSION, getMeta, readScope, rowKey, setMeta, STORE_ASSETS,
  STORE_IMAGES, STORE_INVENTORY_MOVEMENTS, STORE_SYNC_QUEUE, withStore, type ScopedRow } from "@/lib/offline/idb";
import { list, markFailed, type SyncOperation } from "@/lib/offline/syncQueue";
import { DAY_MS, licenseState, type OfflineLicense } from "@/lib/offline/license";
import type { Asset, CatalogChanges, CatalogCommand, Product, ProductAlias, BranchProduct } from "@/lib/catalog";
import type { InventoryCommand, InventoryMovement } from "@/lib/inventory";
import { CURRENT_VERSION, UPDATE_CHANNEL, useUpdateStore, type ReleaseInfo } from "./update.store";
import { useCriticalStore } from "./critical.store";

interface Branch { id: string; name: string; code: string }
export interface CachedContext {
  organization: { name: string; currency: string; timezone: string } | null;
  license: { plan: string; status: string; expiresAt: string | null } | null;
  branches: Branch[];
  access?: { roles: string[]; permissions: string[] };
  release: ReleaseInfo;
}
interface SyncPage { changes: CatalogChanges; serverTime: string; syncVersion: string; hasMore: boolean; version: number }
export const useSyncStore = defineStore("sync", () => {
  const auth = useAuthStore(), updates = useUpdateStore(), critical = useCriticalStore();
  const isOnline = ref(navigator.onLine);
  const apiReachable = ref<boolean | null>(null);
  const lastOnlineAt = ref<string | null>(null);
  const lastSuccessfulSyncAt = ref<string | null>(null);
  const syncState = ref<SyncState>("idle");
  const error = ref<string | null>(null);
  const imageWarning = ref<string | null>(null);
  const context = ref<CachedContext | null>(null);
  const branchId = ref<string | null>(null);
  const scope = ref("");
  const products = ref<Product[]>([]), aliases = ref<ProductAlias[]>([]), branchProducts = ref<BranchProduct[]>([]);
  const inventoryMovements = ref<InventoryMovement[]>([]);
  const operations = ref<SyncOperation[]>([]);
  const pendingImages = ref<PendingImage[]>([]);
  const license = ref<OfflineLicense>();
  const clockNow = ref(Date.now());
  const offlineLicenseState = computed(() => licenseState(license.value, clockNow.value));
  const pendingOperations = ref(0);
  const pendingUploads = ref(0);
  const branches = computed(() => context.value?.branches ?? []);
  let generation = 0;
  let initialized = false;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let stopAccountWatch: WatchStopHandle | undefined;
  let ready: Promise<void> = Promise.resolve();
  const account = () => auth.user?.organizationId ? accountScope(auth.user.organizationId, auth.user.id) : "";

  async function reloadLocal(captured = scope.value) {
    if (!captured) return;
    const [catalog, queue, images, meta] = await Promise.all([
      readCatalog(captured), list(), withStore<ScopedRow<PendingImage>[]>(STORE_IMAGES, "readonly", (s) => s.getAll()), metadata(captured),
    ]);
    if (scope.value !== captured) return;
    products.value = catalog.products; aliases.value = catalog.aliases; branchProducts.value = catalog.branchProducts;
    inventoryMovements.value = catalog.inventoryMovements;
    operations.value = queue.filter((op) => op.scope === captured);
    pendingImages.value = images.filter((row) => row.scope === captured).map((row) => row.value);
    const user = auth.user;
    pendingOperations.value = user?.organizationId ? queue.filter((op) => scopeBelongsTo(op.scope, user.organizationId!, user.id)).length : 0;
    pendingUploads.value = user?.organizationId ? images.filter((row) => scopeBelongsTo(row.scope, user.organizationId!, user.id)).length : 0;
    lastSuccessfulSyncAt.value = meta?.lastSuccessfulSyncAt ?? null;
  }
  async function setBranch(id: string | null) {
    if (id !== null && !branches.value.some((b) => b.id === id)) return;
    generation++;
    branchId.value = id;
    scope.value = auth.user?.organizationId ? catalogScope(auth.user.organizationId, auth.user.id, id) : "";
    products.value = []; aliases.value = []; branchProducts.value = []; inventoryMovements.value = [];
    operations.value = []; pendingImages.value = [];
    if (account()) await setMeta("branch:" + account(), id);
    await reloadLocal();
  }
  function baseMeta(): SyncMetadata {
    return { syncVersion: "0", schemaVersion: DB_VERSION, currentVersion: CURRENT_VERSION, updateChannel: UPDATE_CHANNEL };
  }
  async function processPending(captured: string) {
    const [organizationId, userId] = JSON.parse(captured) as [string, string];
    const binding = { headers: { "X-Expected-Organization": organizationId, "X-Expected-User": userId } };
    const images = await readScope<PendingImage>(STORE_IMAGES, captured);
    const failedImages = new Map<string, string>();
    for (const image of images) {
      if (auth.user?.id !== userId || auth.user.organizationId !== organizationId) return;
      try {
      const found = await http.get<{ asset: Asset | null }>("/assets/by-hash/" + image.contentHash, binding);
      const asset = found.data.asset ?? (await http.post<{ asset: Asset }>("/assets", image.blob, {
        headers: { ...binding.headers, "Content-Type": "image/webp" },
      })).data.asset;
      // Rewrite all dependent commands and persist the mapping atomically before sending them.
      await atomic([STORE_IMAGES, STORE_SYNC_QUEUE, STORE_ASSETS], (tx) => {
        const queue = tx.objectStore(STORE_SYNC_QUEUE);
        const req = queue.getAll();
        req.onsuccess = () => {
          for (const operation of req.result as SyncOperation[]) {
            const command = operation.payload as CatalogCommand;
            if (operation.scope === captured && command.product?.assetId === image.id) {
              queue.put({ ...operation, payload: { ...command, product: { ...command.product, assetId: asset.id } } });
            }
          }
          putCachedAsset(tx, captured, asset.id, image.blob);
          tx.objectStore(STORE_IMAGES).delete(rowKey(captured, image.id));
        };
      });
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Imagen pendiente de subir.";
        failedImages.set(image.id, message);
        imageWarning.value = message;
      }
    }
    for (const operation of (await list()).filter((op) => op.scope === captured)) {
      if (operation.organizationId !== auth.user?.organizationId || operation.userId !== auth.user?.id) break;
      if (operation.status === "REQUIRES_REVIEW") continue;
      if (operation.kind !== "catalog.command" && operation.kind !== "inventory.move") continue;
      const imageId = operation.kind === "catalog.command" ? (operation.payload as CatalogCommand).product?.assetId : undefined;
      if (imageId && failedImages.has(imageId)) { await markFailed(operation.id, failedImages.get(imageId)!); continue; }
      try {
        if (operation.kind === "inventory.move") {
          const response = await http.post<{ movement: InventoryMovement; branchProduct: BranchProduct }>(
            "/inventory/movements", operation.payload as InventoryCommand, binding,
          );
          const meta = await metadata(captured) ?? baseMeta();
          await commitPage(captured, {
            products: [], productAliases: [], branchProducts: [response.data.branchProduct],
            inventoryMovements: [response.data.movement],
          }, meta, operation.id);
          continue;
        }
        const response = await http.post<{ product: Product; branchProduct: BranchProduct | null }>("/sync/operations", operation.payload, binding);
        const meta = await metadata(captured) ?? baseMeta();
        await commitPage(captured, {
          products: [response.data.product], productAliases: [],
          branchProducts: response.data.branchProduct ? [response.data.branchProduct] : [],
        }, meta, operation.id);
      } catch (caught) {
        const needsReview = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 429 && caught.status !== 401;
        await markFailed(operation.id, caught instanceof Error ? caught.message : "No se pudo enviar.", needsReview);
        if (needsReview && operation.kind === "inventory.move") {
          const command = operation.payload as InventoryCommand;
          await withStore(STORE_INVENTORY_MOVEMENTS, "readwrite", (store) => store.delete(rowKey(captured, command.id)));
        }
        if (!needsReview) throw caught;
      }
    }
  }
  async function cacheImages(captured: string) {
    const catalog = await readCatalog(captured);
    const cached = await readScope<{ id: string; blob: Blob }>(STORE_ASSETS, captured);
    for (const id of new Set(catalog.products.filter((p) => p.active && p.assetId).map((p) => p.assetId!))) {
      if (cached.some((a) => a.id === id)) continue;
      try {
        const { data } = await http.get<Blob>("/assets/" + id + "/content", { responseType: "blob" });
        if (data.size > 150 * 1024 || data.type !== "image/webp") throw new Error("Imagen no válida.");
        await atomic([STORE_ASSETS], (tx) => putCachedAsset(tx, captured, id, data));
      } catch { imageWarning.value = "Algunas imágenes no están disponibles sin conexión."; }
    }
  }
  async function run() {
    await ready;
    if (!account()) return;
    if (!await auth.ensureFreshSession()) {
      if (auth.sessionExpired) throw new ApiError(401, "SESSION_EXPIRED", "La sesión expiró. Inicia sesión de nuevo.");
      throw new ApiError(0, "NETWORK_ERROR", "No se pudo validar la sesión porque la API no está disponible.");
    }
    const releaseCritical = critical.enter("Sincronización");
    try {
      const execute = async () => {
        const capturedAccount = account(), originalGeneration = generation;
        imageWarning.value = null;
        const { data } = await http.get<CachedContext>("/sync/context");
        if (account() !== capturedAccount || generation !== originalGeneration) return;
        context.value = data; updates.release = data.release;
        if (data.access) await auth.updateAuthorization(data.access.roles, data.access.permissions);
        if (account() !== capturedAccount || generation !== originalGeneration) return;
        await reconcileAccess(auth.user!.organizationId!, auth.user!.id, data.branches.map((b) => b.id), auth.can("cost.read"));
        if (account() !== capturedAccount || generation !== originalGeneration) return;
        await setMeta("context:" + capturedAccount, data);
        if (!branchId.value || !data.branches.some((b) => b.id === branchId.value)) {
          await setBranch(data.branches[0]?.id ?? null);
        }
        const captured = scope.value, runGeneration = generation;
        if (!captured) return;
        const current = await metadata(captured) ?? baseMeta();
        await setMeta("sync:" + captured, { ...current, lastSyncAt: new Date().toISOString() });
        // Server validation at most daily in steady state; reconnect forces it below.
        if (!license.value || Date.now() - license.value.receivedAt >= DAY_MS || apiReachable.value !== true ||
          offlineLicenseState.value === "requires_validation") {
          const validation = await http.get<Omit<OfflineLicense, "receivedAt" | "observedAt">>("/license");
          if (account() !== capturedAccount || generation !== runGeneration) return;
          license.value = { ...validation.data, receivedAt: Date.now(), observedAt: Date.now() };
          await setMeta("license:" + capturedAccount, license.value);
        }
        const queued = await list();
        const actor = auth.user!;
        const scopes = new Set([captured, ...queued.filter((op) =>
          scopeBelongsTo(op.scope, actor.organizationId!, actor.id) &&
          (!op.branchId || data.branches.some((b) => b.id === op.branchId))).map((op) => op.scope!)]);
        for (const queuedScope of scopes) {
          if (generation !== runGeneration || account() !== capturedAccount) return;
          await processPending(queuedScope);
        }
        let hasMore = true;
        while (hasMore) {
          if (generation !== runGeneration || account() !== capturedAccount) return;
          const meta = await metadata(captured) ?? baseMeta();
          const response = await http.get<SyncPage>("/sync", {
            params: { since: meta.syncVersion, version: 1, ...(branchId.value ? { branchId: branchId.value } : {}) },
          });
          if (generation !== runGeneration || account() !== capturedAccount) return;
          if (response.data.version !== 1) throw new Error("Contrato de sincronización no soportado.");
          hasMore = response.data.hasMore;
          if (hasMore && response.data.syncVersion === meta.syncVersion) throw new Error("El cursor no avanzó.");
          await commitPage(captured, response.data.changes, {
            ...meta, syncVersion: response.data.syncVersion,
            ...(!hasMore ? { lastSuccessfulSyncAt: response.data.serverTime } : {}),
          });
        }
        apiReachable.value = true; lastOnlineAt.value = new Date().toISOString();
        await setMeta("lastOnlineAt:" + capturedAccount, lastOnlineAt.value);
        await reloadLocal(captured);
        await cacheImages(captured);
        await updates.check();
      };
      if (navigator.locks) await navigator.locks.request("geeksium-pos-sync", execute);
      else await execute(); // Server idempotency still protects duplicate delivery.
    } catch (caught) {
      apiReachable.value = caught instanceof ApiError
        ? caught.status !== 0 && caught.status < 500
        : navigator.onLine ? apiReachable.value : false;
      await reloadLocal().catch(() => undefined);
      throw caught;
    } finally { releaseCritical(); }
  }
  const manager = createSyncManager({
    online: () => isOnline.value, active: () => document.visibilityState !== "hidden" && !!account(),
    run, changed(state) { syncState.value = state.syncState; error.value = state.error; },
  });
  async function initializeAccount() {
    const accountGeneration = ++generation;
    context.value = null; scope.value = ""; license.value = undefined;
    products.value = []; aliases.value = []; branchProducts.value = []; inventoryMovements.value = [];
    operations.value = []; pendingImages.value = [];
    lastSuccessfulSyncAt.value = null; apiReachable.value = null;
    pendingOperations.value = 0; pendingUploads.value = 0;
    const capturedAccount = account();
    if (!capturedAccount) return;
    const [cachedContext, cachedLicense, cachedOnline, saved] = await Promise.all([
      getMeta<CachedContext>("context:" + capturedAccount), getMeta<OfflineLicense>("license:" + capturedAccount),
      getMeta<string>("lastOnlineAt:" + capturedAccount), getMeta<string>("branch:" + capturedAccount),
    ]);
    if (account() !== capturedAccount || generation !== accountGeneration) return;
    context.value = cachedContext ?? null; license.value = cachedLicense; lastOnlineAt.value = cachedOnline ?? null;
    await setBranch(saved && branches.value.some((b) => b.id === saved) ? saved : branches.value[0]?.id ?? null);
  }
  function online() { isOnline.value = true; void manager.sync(true); }
  function offline() { isOnline.value = false; apiReachable.value = false; manager.offline(); }
  function visible() {
    if (document.visibilityState === "visible") {
      void auth.ensureFreshSession().finally(() => manager.sync(true));
    }
  }
  function start() {
    if (initialized) return;
    initialized = true;
    stopAccountWatch = watch(account, () => {
      ready = initializeAccount().catch((caught) => { error.value = caught instanceof Error ? caught.message : "Almacenamiento local no disponible."; });
      void ready.then(() => manager.sync());
    }, { immediate: true });
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    clockTimer = setInterval(() => {
      clockNow.value = Date.now();
      if (license.value && account()) {
        license.value.observedAt = Math.max(license.value.observedAt, Date.now());
        void setMeta("license:" + account(), { ...license.value }).catch(() => undefined);
      }
    }, 60_000);
    manager.start();
  }
  function stop() {
    manager.stop(); if (clockTimer) clearInterval(clockTimer);
    stopAccountWatch?.(); initialized = false;
    window.removeEventListener("online", online); window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", visible);
  }
  async function selectBranch(id: string) { await setBranch(id); await manager.sync(true); }
  return { isOnline, apiReachable, lastOnlineAt, lastSuccessfulSyncAt, syncState, pendingOperations, pendingUploads,
    operations, pendingImages, offlineLicenseState, license, error, imageWarning, context, branchId, branches,
    scope, products, aliases, branchProducts, inventoryMovements,
    start, stop, sync: manager.sync, reloadLocal, selectBranch };
});
