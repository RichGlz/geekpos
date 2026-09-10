/**
 * Envoltorio mínimo de IndexedDB (sin dependencias externas).
 *
 * Es la base del modo sin conexión: la cola de operaciones pendientes vive
 * aquí, nunca en localStorage. Reglas:
 *  - Solo se guardan operaciones propias del dispositivo pendientes de enviar.
 *  - Nunca se guardan tokens ni credenciales.
 *  - Si el navegador no expone IndexedDB (SSR, modo privado restringido), las
 *    funciones degradan sin romper la aplicación.
 */
export const DB_NAME = "geeksium-pos";
export const DB_VERSION = 3;

export const STORE_SYNC_QUEUE = "sync_queue";
export const STORE_META = "meta";
export const STORE_PRODUCTS = "products";
export const STORE_ALIASES = "product_aliases";
export const STORE_BRANCH_PRODUCTS = "branch_products";
export const STORE_IMAGES = "pending_images";
export const STORE_ASSETS = "assets";
export const STORE_INVENTORY_MOVEMENTS = "inventory_movements";
export const SCOPED_STORES = [STORE_PRODUCTS, STORE_ALIASES, STORE_BRANCH_PRODUCTS, STORE_IMAGES, STORE_ASSETS, STORE_INVENTORY_MOVEMENTS];

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB no está disponible en este navegador."));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
        const store = db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: "id" });
        store.createIndex("byCreatedAt", "createdAt");
        store.createIndex("byStatus", "status");
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      for (const name of SCOPED_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: "key" });
          store.createIndex("byScope", "scope");
        }
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("Cierra las otras pestañas para actualizar el almacenamiento local."));
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
    };
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Operación de IndexedDB fallida."));
  });
}

export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transacción de IndexedDB abortada."));
    tx.onerror = () => reject(tx.error ?? new Error("Transacción de IndexedDB fallida."));
  });
  const [result] = await Promise.all([promisify(fn(tx.objectStore(storeName))), completion]);
  return result;
}

/** All writes and the cursor commit together. Callback must schedule only IDB requests. */
export async function atomic(stores: string[], schedule: (tx: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("No se guardaron los datos locales."));
    try { schedule(tx); } catch (error) { tx.abort(); reject(error); }
  });
}
export interface ScopedRow<T> { key: string; scope: string; id: string; value: T }
export function rowKey(scope: string, id: string): string { return JSON.stringify([scope, id]); }
export function scopedRow<T>(scope: string, id: string, value: T): ScopedRow<T> {
  return { key: rowKey(scope, id), scope, id, value };
}
export async function readScope<T>(store: string, scope: string): Promise<T[]> {
  const rows = await withStore<ScopedRow<T>[]>(store, "readonly",
    (s) => s.index("byScope").getAll(scope));
  return rows.map((r) => r.value);
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await withStore<{ key: string; value: T } | undefined>(STORE_META, "readonly", (s) => s.get(key));
  return row?.value;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  const plain: unknown = JSON.parse(JSON.stringify(value));
  await withStore(STORE_META, "readwrite", (s) => s.put({ key, value: plain }));
}
export async function deleteMeta(key: string): Promise<void> {
  await withStore(STORE_META, "readwrite", (s) => s.delete(key));
}

/** Solo para pruebas: descarta la conexión memorizada. */
export function resetDbHandle(): void {
  void dbPromise?.then((db) => db.close());
  dbPromise = null;
}
