import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { clear, enqueue } from "@/lib/offline/syncQueue";
import { useUpdateStore, compareVersions } from "../update.store";
import { useCriticalStore } from "../critical.store";

const worker = vi.hoisted(() => ({
  callbacks: {} as { onNeedRefresh?: () => void; onNeedReload?: () => void },
  apply: vi.fn(),
}));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (callbacks: typeof worker.callbacks) => {
    worker.callbacks = callbacks;
    worker.apply.mockImplementation(async () => worker.callbacks.onNeedReload?.());
    return worker.apply;
  },
}));
beforeEach(async () => {
  setActivePinia(createPinia());
  await clear(); vi.clearAllMocks();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: vi.fn((_name: string, options: unknown, cb: (lock: unknown) => unknown) => cb({ name: "lock", options })),
  } });
});
describe("safe OTA", () => {
  it("detects available/required versions and UPDATE_READY without reloading", async () => {
    const updates = useUpdateStore(), reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    updates.release = { latestVersion: "0.3.0", minimumSupportedVersion: "0.3.0", updateChannel: "stable", deploymentChannel: "stable" };
    expect(updates.updateAvailable).toBe(true); expect(updates.updateRequired).toBe(true);
    await updates.start(); worker.callbacks.onNeedRefresh?.();
    expect(updates.state).toBe("UPDATE_READY"); expect(reload).not.toHaveBeenCalled();
    reload.mockRestore();
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
  it("blocks even mandatory updates during sale/payment/cash close and pending work", async () => {
    const updates = useUpdateStore(), critical = useCriticalStore();
    await updates.start(); updates.ready();
    for (const reason of ["Venta activa", "Cobro", "Cierre de caja", "Sync crítico"]) {
      const release = critical.enter(reason);
      expect(await updates.apply()).toBe(false);
      release();
    }
    await enqueue({ kind: "sale", payload: { total: "10.00" } });
    expect(await updates.apply()).toBe(false); expect(worker.apply).not.toHaveBeenCalled();
  });
  it("honors other tabs' lock and channel assignment", async () => {
    const updates = useUpdateStore();
    await updates.start(); updates.ready();
    vi.mocked(navigator.locks.request).mockImplementation((_name, _options, cb) => cb!(null as never) as Promise<unknown>);
    expect(await updates.apply()).toBe(false);
    updates.release = { latestVersion: "0.3.0", minimumSupportedVersion: "0.1.0", updateChannel: "pilot", deploymentChannel: "stable" };
    expect(updates.channelMismatch).toBe(true); expect(await updates.apply()).toBe(false);
  });
  it("does not reload a passive tab after another tab activates the worker", async () => {
    const updates = useUpdateStore(), reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    await updates.start();
    worker.callbacks.onNeedReload?.();
    expect(updates.updateReady).toBe(true); expect(reload).not.toHaveBeenCalled();
    expect(await updates.apply()).toBe(true); expect(reload).toHaveBeenCalledOnce();
    reload.mockRestore();
  });
  it("applies only on explicit request and waits for activation under the lock", async () => {
    const updates = useUpdateStore(), reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    await updates.start(); worker.callbacks.onNeedRefresh?.();
    expect(await updates.apply()).toBe(true);
    expect(worker.apply).toHaveBeenCalledOnce(); expect(reload).toHaveBeenCalledOnce();
    reload.mockRestore();
  });
});
