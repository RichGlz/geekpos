import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import InventoryView from "../InventoryView.vue";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(),
  sync: {
    branchId: "branch", scope: "scope", branches: [{ id: "branch", name: "Principal" }],
    syncState: "idle", license: { status: "ACTIVE" },
    products: [{ id: "product", organizationId: "org", displayName: "Harina", normalizedName: "harina",
      compactKey: "harina", barcode: "001", description: "", category: "", sku: "HAR-1",
      itemType: "product", baseUnit: "kg", conversions: [], assetId: null, active: true,
      revision: 1, updatedAt: "2026-09-10T12:00:00Z" }],
    branchProducts: [{ id: "local", organizationId: "org", branchId: "branch", productId: "product",
      price: "20", cost: null, stock: "0", trackInventory: true, active: true,
      revision: 1, updatedAt: "2026-09-10T12:00:00Z" }],
    inventoryMovements: [] as unknown[], reloadLocal: vi.fn(), sync: vi.fn(), selectBranch: vi.fn(),
  },
}));
vi.mock("@/modules/system/sync.store", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/modules/auth/auth.store", () => ({ useAuthStore: () => ({
  user: { id: "user", organizationId: "org" }, can: () => true, isReadOnly: false,
}) }));
vi.mock("@/modules/system/critical.store", () => ({ useCriticalStore: () => ({ enter: () => () => {} }) }));
vi.mock("@/lib/offline/idb", () => ({ getMeta: async () => "device", setMeta: vi.fn() }));
vi.mock("@/lib/offline/inventoryDb", () => ({ queueInventoryMovement: mocks.queue }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.sync.inventoryMovements = [];
  mocks.queue.mockResolvedValue({ movement: {}, branchProduct: {} });
});

describe("inventory V1 view", () => {
  it("registers initial inventory as a queued movement", async () => {
    const wrapper = mount(InventoryView);
    const initial = wrapper.findAll("button").find((button) => button.text() === "Registrar inventario inicial")!;
    await initial.trigger("click");
    await wrapper.get('input[inputmode="decimal"]').setValue("10");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(mocks.queue).toHaveBeenCalledOnce();
    expect(mocks.queue.mock.calls[0]?.[0].command).toMatchObject({ type: "INITIAL", quantity: "10", unit: "kg" });
    wrapper.unmount();
  });

  it("shows movement actions and pending sync history after initialization", () => {
    mocks.sync.inventoryMovements = [{ id: "movement", productId: "product", userId: "user",
      type: "ENTRY", baseQuantityDelta: "5", occurredAt: "2026-09-10T12:00:00Z",
      comment: "Compra", reference: null, syncState: "PENDING_SYNC" }];
    const wrapper = mount(InventoryView);
    expect(wrapper.text()).toContain("Registrar entrada");
    expect(wrapper.text()).toContain("Registrar salida");
    expect(wrapper.text()).toContain("Registrar ajuste");
    expect(wrapper.text()).toContain("Compra");
    expect(wrapper.text()).toContain("Pendiente");
    wrapper.unmount();
  });
});
