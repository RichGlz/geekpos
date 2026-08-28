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
const DB_NAME = "geeksium-pos";
const DB_VERSION = 1;

export const STORE_SYNC_QUEUE = "sync_queue";
export const STORE_META = "meta";

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
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
  const result = await promisify(fn(tx.objectStore(storeName)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transacción de IndexedDB abortada."));
    tx.onerror = () => reject(tx.error ?? new Error("Transacción de IndexedDB fallida."));
  });
  return result;
}

/** Solo para pruebas: descarta la conexión memorizada. */
export function resetDbHandle(): void {
  dbPromise = null;
}
