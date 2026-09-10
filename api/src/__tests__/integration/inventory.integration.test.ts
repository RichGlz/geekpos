import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createDb, type TransactionalDb } from "../../db/pool.js";
import { loadEnv } from "../../config/env.js";
import { buildApp } from "../../http/app.js";
import * as organizations from "../../repositories/organization.repository.js";
import * as users from "../../repositories/user.repository.js";
import * as licenses from "../../repositories/license.repository.js";
import * as catalog from "../../repositories/catalog.repository.js";
import * as inventory from "../../repositories/inventory.repository.js";
import * as audit from "../../repositories/audit.repository.js";
import { createUser } from "../../services/auth.service.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const suite = databaseUrl ? describe : describe.skip;
const password = "Inventory-test-password-123";

suite("inventory V1 with real PostgreSQL", () => {
  let pool: pg.Pool, db: TransactionalDb, app: FastifyInstance;
  const organizationsToDelete: string[] = [];
  let org: string, branch: string, productId: string, owner: string, cashier: string;
  let foreignOrg: string, foreignBranch: string, foreignOwner: string;

  async function createTenant(): Promise<{ org: string; branch: string; owner: string; cashier: string }> {
    const tenantOrg = randomUUID(), tenantBranch = randomUUID();
    organizationsToDelete.push(tenantOrg);
    await organizations.insert(db, { id: tenantOrg, name: "Inventory test", slug: tenantOrg });
    await organizations.insertBranch(db, { id: tenantBranch, organizationId: tenantOrg, code: "MAIN", name: "Principal" });
    await organizations.insertWarehouse(db, { id: randomUUID(), organizationId: tenantOrg, branchId: tenantBranch, code: "MAIN", name: "Principal", isDefault: true });
    await licenses.insert(db, { id: randomUUID(), organizationId: tenantOrg, status: "ACTIVE", plan: "STANDARD" });
    const tokens: string[] = [];
    for (const [role, roleId] of [
      ["OWNER", "11111111-1111-4111-8111-000000000001"],
      ["CASHIER", "11111111-1111-4111-8111-000000000004"],
    ] as const) {
      const email = `${randomUUID()}@inventory.test`;
      const userId = await createUser(db, { organizationId: tenantOrg, email, fullName: role, password });
      await users.assignRole(db, tenantOrg, userId, roleId);
      await organizations.assignUserToBranch(db, tenantOrg, userId, tenantBranch);
      const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password } });
      expect(login.statusCode).toBe(200);
      tokens.push(login.json().accessToken as string);
    }
    return { org: tenantOrg, branch: tenantBranch, owner: tokens[0]!, cashier: tokens[1]! };
  }
  const send = (token: string, payload: Record<string, unknown>) => app.inject({
    method: "POST", url: "/api/v1/inventory/movements",
    headers: { authorization: `Bearer ${token}` }, payload,
  });
  const movement = (type: string, quantity: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(), idempotencyKey: randomUUID(), deviceId: randomUUID(), branchId: branch,
    productId, type, quantity, unit: "kg", occurredAt: new Date().toISOString(), ...extra,
  });

  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl,
      DATABASE_SSL: process.env["TEST_DATABASE_SSL"] ?? "false",
      JWT_SECRET: "inventory-integration-secret-at-least-32-chars", COOKIE_SECURE: "false" });
    pool = new pg.Pool({ connectionString: databaseUrl,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
    db = createDb(pool); app = await buildApp({ env, db });
    ({ org, branch, owner, cashier } = await createTenant());
    ({ org: foreignOrg, branch: foreignBranch, owner: foreignOwner } = await createTenant());
    productId = randomUUID();
    const created = await app.inject({ method: "POST", url: "/api/v1/sync/operations",
      headers: { authorization: `Bearer ${owner}` }, payload: {
        idempotencyKey: randomUUID(), deviceId: randomUUID(), kind: "product.create", productId, branchId: branch,
        product: { displayName: "Harina", barcode: null, description: "", category: "", sku: "HAR-1",
          itemType: "product", baseUnit: "kg", conversions: [{ name: "bulto", factor: "20" }], assetId: null, active: false },
        branch: { price: "20.00", cost: null, trackInventory: true, active: true },
      } });
    expect(created.statusCode).toBe(200);
  });
  afterAll(async () => {
    for (const id of organizationsToDelete) await organizations.deleteById(db, id);
    await app?.close(); await pool?.end();
  });

  it("creates an active product with unknown cost and idempotent initial inventory", async () => {
    expect((await catalog.product(db, org, productId))?.active).toBe(true);
    expect((await catalog.branchProduct(db, org, branch, productId))?.cost).toBeNull();
    const payload = movement("INITIAL", "10", { comment: "Conteo inicial" });
    const first = await send(owner, payload), retry = await send(owner, payload);
    expect(first.statusCode).toBe(200); expect(retry.json()).toEqual(first.json());
    expect(first.json().branchProduct.stock).toBe("10.000000");
    expect(await inventory.listForBranch(db, org, branch, productId)).toHaveLength(1);
    const duplicateInitial = await send(owner, movement("INITIAL", "2", { comment: "Otro" }));
    expect(duplicateInitial.statusCode).toBe(409);
    expect(duplicateInitial.json().error.code).toBe("INITIAL_INVENTORY_EXISTS");
  });

  it("applies entry, exit and required-reason adjustment with an auditable stock result", async () => {
    expect((await send(owner, movement("ENTRY", "1", { unit: "bulto", comment: "Compra" }))).statusCode).toBe(200);
    expect((await send(owner, movement("EXIT", "3", { comment: "Consumo" }))).statusCode).toBe(200);
    const missingReason = await send(owner, movement("ADJUSTMENT", "-2"));
    expect(missingReason.statusCode).toBe(400);
    expect((await send(owner, movement("ADJUSTMENT", "-2", { comment: "Conteo físico" }))).statusCode).toBe(200);
    expect((await catalog.branchProduct(db, org, branch, productId))?.stock).toBe("25.000000");
    const movements = await inventory.listForBranch(db, org, branch, productId);
    expect(movements).toHaveLength(4);
    expect(movements.reduce((sum, item) => sum + Number(item.baseQuantityDelta), 0)).toBe(25);
    const actions = (await audit.listForOrganization(db, org)).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["INVENTORY_INITIAL", "INVENTORY_ENTRY", "INVENTORY_EXIT", "INVENTORY_ADJUSTMENT"]));
  });

  it("enforces supervisor permissions and organization/branch isolation", async () => {
    expect((await send(cashier, movement("ENTRY", "1"))).statusCode).toBe(403);
    const crossTenant = { ...movement("ENTRY", "1"), branchId: foreignBranch };
    expect((await send(owner, crossTenant)).statusCode).toBe(403);
    const foreign = { ...movement("ENTRY", "1"), branchId: branch };
    expect((await send(foreignOwner, foreign)).statusCode).toBe(403);
    expect(await inventory.listForBranch(db, foreignOrg, foreignBranch)).toHaveLength(0);
  });
});
