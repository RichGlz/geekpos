/**
 * La cola offline se prueba contra una IndexedDB real (implementación
 * fake-indexeddb), no contra un mock de nuestro propio código: lo que
 * interesa verificar es que las operaciones sobreviven y se ordenan.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clear, countPending, enqueue, list, markFailed, remove } from "../syncQueue";

describe("cola de sincronización offline", () => {
  beforeEach(async () => {
    await clear();
  });

  it("encola operaciones con clave de idempotencia propia", async () => {
    const operation = await enqueue({ kind: "pos.sale", payload: { total: "125.00" } });
    expect(operation).not.toBeNull();
    expect(operation?.idempotencyKey).toBeTruthy();
    expect(operation?.status).toBe("PENDING");
    expect(await countPending()).toBe(1);
  });

  it("respeta el orden de creación", async () => {
    await enqueue({ kind: "pos.sale", payload: { n: 1 } });
    await enqueue({ kind: "pos.sale", payload: { n: 2 } });
    const rows = await list();
    expect(rows.map((row) => (row.payload as { n: number }).n)).toEqual([1, 2]);
  });

  it("registra fallos y permite eliminar la operación confirmada", async () => {
    const operation = await enqueue({ kind: "inventory.move", payload: { qty: "3" } });
    await markFailed(operation!.id, "sin conexión");
    const [failed] = await list();
    expect(failed?.status).toBe("FAILED");
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe("sin conexión");

    await remove(operation!.id);
    expect(await list()).toHaveLength(0);
  });

  it("no guarda tokens ni credenciales en el registro encolado", async () => {
    const operation = await enqueue({ kind: "pos.sale", payload: { total: "10.00" } });
    const serialized = JSON.stringify(operation);
    expect(serialized).not.toMatch(/accessToken|password|Bearer/i);
  });
});
