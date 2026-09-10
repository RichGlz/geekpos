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
import * as audit from "../../repositories/audit.repository.js";
import { createUser } from "../../services/auth.service.js";
import { uploadAsset } from "../../services/assets.service.js";
import { normalizeName, type ProductInput } from "../../lib/catalog.js";
import type { TenantContext } from "../../types/domain.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const suite = databaseUrl ? describe : describe.skip;
const input: ProductInput = { displayName: "Coca-Cola 600 ml", barcode: "000123", description: "",
  category: "Bebidas", sku: "", baseUnit: "pieza", itemType: "product", conversions: [], assetId: null, active: true };
interface Tenant { org: string; branch: string; otherBranch: string; owner: string; cashier: string; ownerId: string }
suite("catalog with real PostgreSQL", () => {
  let pool: pg.Pool, db: TransactionalDb, app: FastifyInstance, a: Tenant, b: Tenant;
  const created: string[] = [];
  const productId = randomUUID();
  async function tenant(): Promise<Tenant> {
    const org = randomUUID(), branch = randomUUID(), otherBranch = randomUUID();
    await organizations.insert(db, { id: org, name: "Catalog test", slug: org, legalName: null });
    created.push(org);
    await organizations.insertBranch(db, { id: branch, organizationId: org, code: "A", name: "A" });
    await organizations.insertBranch(db, { id: otherBranch, organizationId: org, code: "B", name: "B" });
    await licenses.insert(db, { id: randomUUID(), organizationId: org, status: "ACTIVE", plan: "STANDARD" });
    const tokens: string[] = [], ids: string[] = [];
    for (const role of ["OWNER", "CASHIER"]) {
      const email = randomUUID() + "@catalog.test";
      const id = await createUser(db, { organizationId: org, email, fullName: role, password: "Catalog-test-password-123" });
      ids.push(id);
      await users.assignRole(db, org, id, role === "OWNER" ? "11111111-1111-4111-8111-000000000001" : "11111111-1111-4111-8111-000000000004");
      await organizations.assignUserToBranch(db, org, id, branch);
      if (role === "OWNER") await organizations.assignUserToBranch(db, org, id, otherBranch);
      const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "Catalog-test-password-123" } });
      expect(response.statusCode).toBe(200);
      tokens.push(response.json().accessToken as string);
    }
    return { org, branch, otherBranch, owner: tokens[0]!, cashier: tokens[1]!, ownerId: ids[0]! };
  }
  const send = (token: string, payload: Record<string, unknown>) => app.inject({
    method: "POST", url: "/api/v1/sync/operations", headers: { authorization: "Bearer " + token }, payload,
  });
  const command = (extra: Record<string, unknown> = {}) => ({
    kind: "product.create", idempotencyKey: randomUUID(), deviceId: randomUUID(), productId, product: input, ...extra,
  });
  beforeAll(async () => {
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: databaseUrl, DATABASE_SSL: process.env["TEST_DATABASE_SSL"] ?? "false",
      JWT_SECRET: "catalog-integration-secret-at-least-32-characters", COOKIE_SECURE: "false" });
    pool = new pg.Pool({ connectionString: databaseUrl, ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined });
    db = createDb(pool); app = await buildApp({ env, db });
    a = await tenant(); b = await tenant();
  });
  afterAll(async () => {
    for (const org of created) await organizations.deleteById(db, org);
    await app?.close(); await pool?.end();
  });
  it("creates one product and one compact audit trail under concurrent retries", async () => {
    const payload = command({ branchId: a.branch, branch: { price: "21.00", cost: "12.00", active: true, trackInventory: true } });
    const [one, two] = await Promise.all([send(a.owner, payload), send(a.owner, payload)]);
    expect(one.statusCode).toBe(200); expect(two.statusCode).toBe(200);
    expect(one.json()).toEqual(two.json());
    expect(await catalog.products(db, a.org)).toHaveLength(1);
    const logs = await audit.listForOrganization(db, a.org);
    expect(logs.filter((l) => l.action === "PRODUCT_CREATED")).toHaveLength(1);
    expect(logs.some((l) => l.action === "PRODUCT_PRICE_CHANGED")).toBe(true);
    expect(logs.some((l) => l.action === "PRODUCT_COST_CHANGED")).toBe(true);
    const events = logs.filter((l) => l.entity === "product");
    expect(JSON.stringify(events)).not.toMatch(/password|Bearer|accessToken/);
    expect(events.every((l) => JSON.stringify(l.metadata).length < 2000)).toBe(true);
    const conflict = await send(a.owner, { ...payload, product: { ...input, displayName: "Changed payload" } });
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("reuses identical barcode within an organization and permits it in a different organization", async () => {
    const same = await send(a.owner, command({ productId: randomUUID(), product: { ...input, displayName: "Cocacola 600ml" } }));
    expect(same.statusCode).toBe(200); expect(same.json().productId).toBe(productId); expect(same.json().reused).toBe(true);
    expect(await catalog.aliases(db, a.org)).toHaveLength(1);
    const other = await send(b.owner, command({ productId: randomUUID() }));
    expect(other.statusCode).toBe(200); expect(await catalog.products(db, b.org)).toHaveLength(1);
    await expect(db.query(`INSERT INTO products (id,organization_id,display_name,normalized_name,compact_key,barcode,base_unit)
      VALUES ($1,$2,'Duplicate','duplicate','duplicate','000123','pieza')`, [randomUUID(), a.org])).rejects.toMatchObject({ code: "23505" });
  });
  it("requires explicit override for similar names, never merges Zero, and denies cashiers", async () => {
    const payload = command({ productId: randomUUID(), product: { ...input, displayName: "Coca-Cola Zero 600ml", barcode: null } });
    const warning = await send(a.owner, payload);
    expect(warning.statusCode).toBe(409); expect(warning.json().error.code).toBe("POSSIBLE_DUPLICATE");
    const cashier = await send(a.cashier, { ...payload, allowDuplicate: true });
    expect(cashier.statusCode).toBe(403);
    const override = await send(a.owner, { ...payload, allowDuplicate: true });
    expect(override.statusCode).toBe(200); expect(override.json().productId).not.toBe(productId);
    expect((await audit.listForOrganization(db, a.org)).some((l) => l.action === "PRODUCT_DUPLICATE_OVERRIDE")).toBe(true);
  });
  it("keeps each branch price/cost independent and excludes another branch and costs from cashier sync", async () => {
    const link = await send(a.owner, command({ kind: "branch.set", product: undefined, expectedRevision: 0,
      branchId: a.otherBranch, branch: { price: "99.00", cost: "55.00", active: true, trackInventory: true } }));
    expect(link.statusCode).toBe(200);
    const response = await app.inject({ url: "/api/v1/sync?branchId=" + a.branch, headers: { authorization: "Bearer " + a.cashier } });
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.changes.branchProducts.every((p: { branchId: string; cost: null }) => p.branchId === a.branch && p.cost === null)).toBe(true);
    expect(JSON.stringify(data)).not.toContain("55.00");
    const forbidden = await app.inject({ url: "/api/v1/sync?branchId=" + a.otherBranch, headers: { authorization: "Bearer " + a.cashier } });
    expect(forbidden.statusCode).toBe(403);
    const crossTenant = await app.inject({ url: "/api/v1/sync?branchId=" + a.branch, headers: { authorization: "Bearer " + b.owner } });
    expect(crossTenant.statusCode).toBe(403);
    const delta = await app.inject({ url: "/api/v1/sync?branchId=" + a.branch + "&since=" + data.syncVersion, headers: { authorization: "Bearer " + a.owner } });
    expect(delta.json().changes).toEqual({ products: [], productAliases: [], branchProducts: [] });
  });
  it("rejects stale edits and archives without deleting product history", async () => {
    const edit = command({ kind: "product.edit", expectedRevision: 1, product: { ...input, active: false } });
    const archived = await send(a.owner, edit); expect(archived.statusCode).toBe(200);
    expect((await catalog.product(db, a.org, productId))?.active).toBe(false);
    const stale = await send(a.owner, { ...edit, idempotencyKey: randomUUID() }); expect(stale.json().error.code).toBe("REVISION_CONFLICT");
    const active = await send(a.owner, command({ kind: "product.edit", expectedRevision: 2, product: input }));
    expect(active.statusCode).toBe(200);
    expect((await audit.listForOrganization(db, a.org)).some((l) => l.action === "PRODUCT_REACTIVATED")).toBe(true);
    expect((await app.inject({ method: "DELETE", url: "/api/v1/products/" + productId, headers: { authorization: "Bearer " + a.owner } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/v1/audit", headers: { authorization: "Bearer " + a.owner } })).statusCode).toBe(404);
  });
  it("deduplicates assets by organization and hash and prevents cross-tenant asset references", async () => {
    const bytes = Buffer.alloc(30); bytes.write("RIFF"); bytes.writeUInt32LE(22, 4); bytes.write("WEBP", 8);
    bytes.write("VP8 ", 12); bytes.writeUInt32LE(10, 16); bytes.write("9d012a", 23, "hex"); bytes.writeUInt16LE(16, 26); bytes.writeUInt16LE(16, 28);
    let uploads = 0;
    const storage = { async upload() { uploads++; }, async download() { return bytes; } };
    const context = (t: Tenant): TenantContext => ({
      organizationId: t.org, userId: t.ownerId, sessionId: randomUUID(), isPlatformAdmin: false,
      roles: ["OWNER"], permissions: ["*"], licenseStatus: "ACTIVE",
    });
    const [one, same] = await Promise.all([uploadAsset(db, context(a), bytes, storage), uploadAsset(db, context(a), bytes, storage)]);
    expect(one.id).toBe(same.id); expect(uploads).toBe(1);
    const other = await uploadAsset(db, context(b), bytes, storage);
    expect(other.id).not.toBe(one.id); expect(uploads).toBe(2);
    const wrong = await send(a.owner, command({ kind: "product.edit", expectedRevision: 3, product: { ...input, assetId: other.id } }));
    expect(wrong.statusCode).toBe(400);
  });
  it("does not advance a cursor past an uncommitted catalog change", async () => {
    let release!: () => void, locked!: () => void;
    const wait = new Promise<void>((r) => { release = r; });
    const entered = new Promise<void>((r) => { locked = r; });
    const previous = await catalog.version(db, a.org);
    const tx = db.transaction(async (connection) => {
      await catalog.lockOrganization(connection, a.org);
      const value = { ...input, displayName: "Harina integral", barcode: "987" };
      const product = await catalog.saveProduct(connection, a.org, randomUUID(), value, normalizeName(value.displayName), 1);
      await catalog.recordChange(connection, a.org, "products", product);
      locked(); await wait;
    });
    await entered;
    expect(await catalog.version(db, a.org)).toBe(previous);
    release(); await tx;
    const response = await app.inject({ url: "/api/v1/sync?since=" + previous, headers: { authorization: "Bearer " + a.owner } });
    expect(response.json().changes.products).toHaveLength(1);
  });
  it("rejects context changes and returns server-dated license and OTA metadata", async () => {
    const mismatch = await app.inject({ method: "POST", url: "/api/v1/products", payload: command({ productId: randomUUID() }),
      headers: { authorization: "Bearer " + a.owner, "x-expected-organization": b.org } });
    expect(mismatch.json().error.code).toBe("CONTEXT_CHANGED");
    const license = await app.inject({ url: "/api/v1/license", headers: { authorization: "Bearer " + a.owner } });
    expect(license.statusCode).toBe(200);
    expect(Date.parse(license.json().licenseOfflineValidUntil) - Date.parse(license.json().lastLicenseValidationAt)).toBe(10 * 86_400_000);
    const context = await app.inject({ url: "/api/v1/sync/context", headers: { authorization: "Bearer " + a.owner } });
    expect(context.json().release.updateChannel).toBe("stable");
  });
  it("honors revoked permissions even before an existing access token expires", async () => {
    await db.query("DELETE FROM user_roles WHERE user_id=$1", [a.ownerId]);
    const denied = await send(a.owner, command({ productId: randomUUID(), product: { ...input, barcode: "new-unique" } }));
    expect(denied.statusCode).toBe(403);
    await users.assignRole(db, a.org, a.ownerId, "11111111-1111-4111-8111-000000000001");
  });
  it("rejects stale branch prices and mixed commands that could bypass revision checks", async () => {
    const payload = command({ kind: "branch.set", product: undefined, expectedRevision: 1,
      branchId: a.branch, branch: { price: "25.00", cost: "13.00", active: true, trackInventory: true } });
    expect((await send(a.owner, payload)).statusCode).toBe(200);
    const second = await send(a.owner, { ...payload, idempotencyKey: randomUUID() });
    expect(second.json().error.code).toBe("REVISION_CONFLICT");
    const mixed = await send(a.owner, { ...payload, kind: "product.edit", product: input, expectedRevision: 3 });
    expect(mixed.statusCode).toBe(400);
    expect((await catalog.branchProduct(db, a.org, a.branch, productId))?.price).toBe("25.00");
  });
  it("paginates more than 500 changes in numeric version order without losing the tail", async () => {
    const since = await catalog.version(db, a.org);
    const product = (await catalog.product(db, a.org, productId))!;
    await db.transaction(async (connection) => {
      await catalog.lockOrganization(connection, a.org);
      for (let index = 0; index < 505; index++) await catalog.recordChange(connection, a.org, "products", { ...product, displayName: "Cursor " + index });
    });
    const page = await app.inject({ url: "/api/v1/sync?since=" + since, headers: { authorization: "Bearer " + a.owner } });
    expect(page.json().changes.products).toHaveLength(500);
    expect(page.json().changes.products[499].displayName).toBe("Cursor 499");
    expect(page.json().hasMore).toBe(true);
    const tail = await app.inject({ url: "/api/v1/sync?since=" + page.json().syncVersion, headers: { authorization: "Bearer " + a.owner } });
    expect(tail.json().changes.products).toHaveLength(5);
    expect(tail.json().changes.products[4].displayName).toBe("Cursor 504");
    expect(tail.json().hasMore).toBe(false);
  });
  it("enforces system catalog roles at the API, including Supervisor and Warehouse", async () => {
    for (const [role, suffix, allowed] of [["OWNER","1",true],["ADMIN","2",true],["SUPERVISOR","3",true],["CASHIER","4",false],["WAREHOUSE","5",false]] as const) {
      await db.query("DELETE FROM user_roles WHERE user_id=$1", [a.ownerId]);
      await users.assignRole(db, a.org, a.ownerId, "11111111-1111-4111-8111-00000000000" + suffix);
      const id = randomUUID();
      const response = await send(a.owner, command({ productId: id, product: { ...input, displayName: id, barcode: id }, allowDuplicate: true }));
      expect(response.statusCode, role).toBe(allowed ? 200 : 403);
    }
    await db.query("DELETE FROM user_roles WHERE user_id=$1", [a.ownerId]);
    await users.assignRole(db, a.org, a.ownerId, "11111111-1111-4111-8111-000000000001");
  });
});
