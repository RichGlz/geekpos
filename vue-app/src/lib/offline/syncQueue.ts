/**
 * Cola de sincronización sin conexión.
 *
 * Fase 0: infraestructura y contrato. Todavía no hay operaciones de negocio
 * que encolar (POS, inventario y traspasos llegan después), pero la cola ya
 * define las reglas que esos módulos deberán respetar:
 *
 *  - Cada operación lleva un `idempotencyKey` generado en el dispositivo. El
 *    servidor lo usará para no duplicar una venta reenviada tras una caída.
 *  - Nunca se encolan credenciales ni tokens: solo la operación de negocio.
 *  - La cola es local al dispositivo y se procesa en orden de creación.
 */
import { STORE_SYNC_QUEUE, isIndexedDbAvailable, withStore } from "./idb";

export type SyncStatus = "PENDING" | "IN_FLIGHT" | "FAILED";

export interface SyncOperation {
  id: string;
  /** Módulo de negocio propietario de la operación, p. ej. "pos.sale". */
  kind: string;
  /** Clave de idempotencia que viajará al servidor. */
  idempotencyKey: string;
  /** Cuerpo de la operación. Jamás incluye tokens ni contraseñas. */
  payload: unknown;
  status: SyncStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueue(input: {
  kind: string;
  payload: unknown;
  idempotencyKey?: string;
}): Promise<SyncOperation | null> {
  if (!isIndexedDbAvailable()) return null;
  const operation: SyncOperation = {
    id: newKey(),
    kind: input.kind,
    idempotencyKey: input.idempotencyKey ?? newKey(),
    payload: input.payload,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
  };
  await withStore(STORE_SYNC_QUEUE, "readwrite", (store) => store.add(operation));
  return operation;
}

export async function list(): Promise<SyncOperation[]> {
  if (!isIndexedDbAvailable()) return [];
  const rows = await withStore<SyncOperation[]>(STORE_SYNC_QUEUE, "readonly", (store) =>
    store.getAll() as IDBRequest<SyncOperation[]>,
  );
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function countPending(): Promise<number> {
  return (await list()).filter((item) => item.status !== "IN_FLIGHT").length;
}

export async function markFailed(id: string, message: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const current = await withStore<SyncOperation | undefined>(
    STORE_SYNC_QUEUE,
    "readonly",
    (store) => store.get(id) as IDBRequest<SyncOperation | undefined>,
  );
  if (!current) return;
  const next: SyncOperation = {
    ...current,
    status: "FAILED",
    attempts: current.attempts + 1,
    lastError: message,
  };
  await withStore(STORE_SYNC_QUEUE, "readwrite", (store) => store.put(next));
}

export async function remove(id: string): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  await withStore(STORE_SYNC_QUEUE, "readwrite", (store) => store.delete(id));
}

/** Vacía la cola. Se usa al cerrar sesión en un equipo compartido. */
export async function clear(): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  await withStore(STORE_SYNC_QUEUE, "readwrite", (store) => store.clear());
}
