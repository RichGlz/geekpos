import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import CatalogView from "../CatalogView.vue";

const mocks = vi.hoisted(() => ({
  queue: vi.fn(), sync: {
    products: [] as unknown[], aliases: [], branchProducts: [] as unknown[], operations: [] as unknown[],
    scope: "local-test", branchId: "branch", branches: [{ id: "branch", name: "Norte" }],
    license: { status: "ACTIVE" }, syncState: "idle", reloadLocal: vi.fn(), sync: vi.fn(),
  },
}));
vi.mock("@/modules/system/sync.store", () => ({ useSyncStore: () => mocks.sync }));
vi.mock("@/modules/auth/auth.store", () => ({ useAuthStore: () => ({
  user: { id: "user", organizationId: "org" }, can: () => true, roles: ["OWNER"], isReadOnly: false,
}) }));
vi.mock("@/modules/system/critical.store", () => ({ useCriticalStore: () => ({ enter: () => () => {} }) }));
vi.mock("vue-router", () => ({ onBeforeRouteLeave: vi.fn() }));
vi.mock("@/lib/offline/catalogDb", () => ({ queueCommands: mocks.queue }));
vi.mock("@/lib/offline/idb", () => ({
  getMeta: async () => "device", setMeta: vi.fn(), withStore: vi.fn(), STORE_ASSETS: "assets", STORE_SYNC_QUEUE: "queue",
}));
const product = { id: "product", organizationId: "org", displayName: "Coca-Cola 600 ml",
  normalizedName: "coca cola 600 ml", compactKey: "cocacola600ml", barcode: null,
  description: "", category: "", sku: "", baseUnit: "pieza", itemType: "product",
  conversions: [], assetId: null, active: true, revision: 3 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.sync.products = [{ ...product }]; mocks.sync.operations = [];
  mocks.sync.branchProducts = []; mocks.queue.mockResolvedValue(undefined);
});
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((item) => item.text() === text)!;
}
describe("catalog form ownership and conflict review", () => {
  it("requires sale price and keeps purchase cost optional", async () => {
    const wrapper = mount(CatalogView);
    await button(wrapper, "Agregar").trigger("click");
    const money = wrapper.findAll('input[inputmode="decimal"]');
    expect(money).toHaveLength(2);
    expect((money[0]!.element as HTMLInputElement).value).toBe("");
    expect(money[0]!.attributes("required")).not.toBeUndefined();
    expect((money[1]!.element as HTMLInputElement).value).toBe("");
    expect(money[1]!.attributes("required")).toBeUndefined();
    expect(wrapper.text()).toContain("Estado: Activo");
    expect(wrapper.text()).toContain("Llevar control de inventario");
    wrapper.unmount();
  });
  it("edits global fields without creating a branch assignment", async () => {
    const wrapper = mount(CatalogView);
    await button(wrapper, "Editar catálogo").trigger("click");
    expect(wrapper.findAll('input[inputmode="decimal"]')).toHaveLength(0);
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(mocks.queue.mock.calls[0]?.[0].commands.map((c: { kind: string }) => c.kind)).toEqual(["product.edit"]);
    wrapper.unmount();
  });
  it("replaces the rejected operation when resolving it by selecting an existing product", async () => {
    mocks.sync.operations = [{ id: "rejected", kind: "catalog.command", status: "REQUIRES_REVIEW",
      payload: { kind: "product.create", productId: "different", product: { ...product, displayName: "Cocacola 600ml" } } }];
    const wrapper = mount(CatalogView);
    await button(wrapper, "Revisar").trigger("click");
    const match = wrapper.findAll("button").find((item) => item.text().includes("Nombre o alias coincidente"))!;
    await match.trigger("click");
    const money = wrapper.findAll('input[inputmode="decimal"]');
    await money[0]!.setValue("23"); await money[1]!.setValue("13");
    await wrapper.get("form").trigger("submit"); await flushPromises();
    expect(mocks.queue.mock.calls[0]?.[0].replaceOperationId).toBe("rejected");
    expect(mocks.queue.mock.calls[0]?.[0].commands[0].kind).toBe("branch.set");
    wrapper.unmount();
  });
});
