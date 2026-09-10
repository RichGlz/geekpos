import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { getMeta, setMeta, deleteMeta } from "@/lib/offline/idb";
import { accountScope } from "@/lib/offline/catalogDb";
import { clear, enqueue, list } from "@/lib/offline/syncQueue";
const api = vi.hoisted(() => ({ login: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
const mock = vi.hoisted(() => ({ get: vi.fn(), token: null as string | null }));
vi.mock("../auth.api", () => api);
vi.mock("@/lib/http", () => ({
  http: mock, configureAuthHandlers: vi.fn(),
  setAccessToken: (token: string | null) => { mock.token = token; },
  getAccessToken: () => mock.token,
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
const { ApiError } = await import("@/lib/http");
const { useAuthStore } = await import("../auth.store");
const user = { id: "offline-user", organizationId: "offline-org", email: "offline@example.test",
  fullName: "Offline test", isActive: true, isPlatformAdmin: false };
const profile = { user, roles: ["OWNER"], permissions: ["*"], licenseStatus: "ACTIVE" };
beforeEach(async () => {
  setActivePinia(createPinia()); vi.clearAllMocks(); mock.token = null;
  await clear(); await deleteMeta("explicit-signout"); await deleteMeta("offline-profile");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  await setMeta("offline-profile", profile);
  await setMeta("license:" + accountScope(user.organizationId, user.id), {
    status: "ACTIVE", lastLicenseValidationAt: new Date().toISOString(),
    licenseOfflineValidUntil: new Date(Date.now() + 864_000_000).toISOString(),
    receivedAt: Date.now(), observedAt: Date.now(),
  });
});
describe("offline session recovery", () => {
  it("restores the last authorized local profile during network failure without persisting tokens", async () => {
    api.refresh.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    const auth = useAuthStore(); await auth.bootstrap();
    expect(auth.isAuthenticated).toBe(true); expect(auth.offlineSession).toBe(true);
    expect(mock.token).toBeNull();
    expect(JSON.stringify(await getMeta("offline-profile"))).not.toMatch(/password|token|Bearer/i);
  });
  it("does not request refresh when the browser already reports offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const auth = useAuthStore(); await auth.bootstrap();
    expect(auth.isAuthenticated).toBe(true); expect(api.refresh).not.toHaveBeenCalled();
  });
  it("does not restore a revoked server session or an expired offline validation", async () => {
    api.refresh.mockRejectedValue(new ApiError(401, "SESSION_REVOKED", "revoked"));
    await useAuthStore().bootstrap();
    expect(useAuthStore().isAuthenticated).toBe(false); expect(await getMeta("offline-profile")).toBeUndefined();
    setActivePinia(createPinia()); await setMeta("offline-profile", profile);
    await setMeta("license:" + accountScope(user.organizationId, user.id), {
      status: "ACTIVE", lastLicenseValidationAt: "2026-01-01T00:00:00Z", licenseOfflineValidUntil: "2026-01-11T00:00:00Z",
      receivedAt: Date.parse("2026-01-01T00:00:00Z"), observedAt: Date.now(),
    });
    api.refresh.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    await useAuthStore().bootstrap(); expect(useAuthStore().isAuthenticated).toBe(false);
  });
  it("signs out locally while retaining unsent work and does not silently log back in", async () => {
    await enqueue({ kind: "catalog.command", payload: { name: "Pending" } });
    api.logout.mockRejectedValue(new Error("offline"));
    await useAuthStore().signOut();
    expect(await list()).toHaveLength(1);
    setActivePinia(createPinia()); await useAuthStore().bootstrap();
    expect(useAuthStore().isAuthenticated).toBe(false); expect(api.refresh).not.toHaveBeenCalled();
  });
});
