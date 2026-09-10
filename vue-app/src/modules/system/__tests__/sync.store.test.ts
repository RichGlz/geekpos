import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useSyncStore } from "../sync.store";
import { useAuthStore } from "@/modules/auth/auth.store";
import { clear } from "@/lib/offline/syncQueue";
import { queueCommands } from "@/lib/offline/catalogDb";
import { normalizeName, type ProductInput } from "@/lib/catalog";
import Dashboard from "@/views/DashboardView.vue";

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/http", () => ({
  http: mock, ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
  setAccessToken: vi.fn(), getAccessToken: () => "test-access-token", configureAuthHandlers: vi.fn(),
}));
const { ApiError } = await import("@/lib/http");
const org = "00000000-0000-4000-8000-000000000001", user = "00000000-0000-4000-8000-000000000002", branch = "00000000-0000-4000-8000-000000000003";
const input: ProductInput = { displayName: "Producto local", barcode: null, description: "", category: "", sku: "",
  itemType: "product", baseUnit: "pieza", conversions: [], assetId: null, active: true };
beforeEach(async () => {
  setActivePinia(createPinia()); await clear(); vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  const auth = useAuthStore();
  auth.user = { id: user, organizationId: org, fullName: "Owner", email: "owner@example.test", isActive: true, isPlatformAdmin: false };
  auth.roles = ["OWNER"]; auth.permissions = ["*"]; auth.licenseStatus = "ACTIVE"; auth.ready = true;
  auth.accessExpiresAt = Date.now() + 10 * 60_000;
  mock.get.mockImplementation(async (url: string) => {
    if (url === "/sync/context") return { data: { organization: { name: "Local", currency: "MXN", timezone: "America/Mexico_City" },
      license: { plan: "STANDARD", status: "ACTIVE", expiresAt: null }, branches: [{ id: branch, name: "A" }],
      release: { latestVersion: "0.2.0", minimumSupportedVersion: "0.1.0", updateChannel: "stable", deploymentChannel: "stable" } } };
    if (url === "/license") return { data: { status: "ACTIVE", lastLicenseValidationAt: new Date().toISOString(), licenseOfflineValidUntil: new Date(Date.now() + 864_000_000).toISOString() } };
    if (url === "/sync") return { data: { version: 1, syncVersion: "1", serverTime: "2026-09-09T01:00:00Z",
      hasMore: false, changes: { products: [], productAliases: [], branchProducts: [] } } };
    throw new Error("Unexpected request: " + url);
  });
});
afterEach(() => useSyncStore().stop());
describe("local-first app lifecycle", () => {
  it("persists successful sync and 100 dashboard mounts do not request data", async () => {
    const sync = useSyncStore(); sync.start(); await sync.sync(true);
    expect(sync.lastSuccessfulSyncAt).toBe("2026-09-09T01:00:00Z");
    mock.get.mockClear();
    for (let i = 0; i < 100; i++) { const wrapper = mount(Dashboard); wrapper.unmount(); }
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.post).not.toHaveBeenCalled();
  });
  it("sends the durable queue only for its owner and keeps other accounts' operations", async () => {
    const sync = useSyncStore(); sync.start(); await sync.sync(true);
    const id = crypto.randomUUID();
    const command = { kind: "product.create" as const, idempotencyKey: crypto.randomUUID(), deviceId: crypto.randomUUID(), productId: id, product: input };
    await queueCommands({ scope: sync.scope, organizationId: org, userId: user, commands: [command] });
    await queueCommands({ scope: "another-account", organizationId: "other", userId: "other", commands: [{ ...command, idempotencyKey: crypto.randomUUID() }] });
    mock.post.mockResolvedValue({ data: { product: { ...input, id, organizationId: org, ...normalizeName(input.displayName), revision: 1, updatedAt: new Date().toISOString() }, branchProduct: null } });
    await sync.sync(true);
    expect(mock.post).toHaveBeenCalledTimes(1);
    expect(mock.post.mock.calls[0]?.[2].headers["X-Expected-Organization"]).toBe(org);
    expect(sync.pendingOperations).toBe(0);
    const { list } = await import("@/lib/offline/syncQueue");
    expect((await list()).map((op) => op.scope)).toEqual(["another-account"]);
  });
  it("tracks offline and reconnect events without relying on navigator alone", async () => {
    const sync = useSyncStore(); sync.start(); await sync.sync(true);
    window.dispatchEvent(new Event("offline"));
    expect(sync.isOnline).toBe(false); expect(sync.syncState).toBe("offline");
    const calls = mock.get.mock.calls.length;
    await sync.sync(true); expect(mock.get.mock.calls.length).toBe(calls);
    window.dispatchEvent(new Event("online")); await sync.sync(true);
    expect(sync.apiReachable).toBe(true); expect(sync.syncState).toBe("idle");
  });
  it("does not label an authentication rejection as an unavailable API", async () => {
    mock.get.mockRejectedValue(new ApiError(401, "SESSION_EXPIRED", "Sesión expirada"));
    const sync = useSyncStore(); sync.start(); await sync.sync(true);
    expect(sync.apiReachable).toBe(true);
    expect(sync.syncState).toBe("error");
  });
});
