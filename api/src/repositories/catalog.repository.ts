import type { Db } from "../db/pool.js";
import type { Product, ProductAlias, ProductInput, BranchProduct, Asset } from "../lib/catalog.js";

const productColumns = `id, organization_id AS "organizationId", display_name AS "displayName",
 normalized_name AS "normalizedName", compact_key AS "compactKey", barcode, description, category, sku,
 item_type AS "itemType", base_unit AS "baseUnit", conversions, asset_id AS "assetId", active, revision,
 updated_at AS "updatedAt"`;
const branchColumns = `id, organization_id AS "organizationId", branch_id AS "branchId",
 product_id AS "productId", price::text, cost::text, stock::text,
 track_inventory AS "trackInventory", active, revision, updated_at AS "updatedAt"`;
const aliasColumns = `id, organization_id AS "organizationId", product_id AS "productId",
 display_name AS "displayName", normalized_name AS "normalizedName", compact_key AS "compactKey"`;
const assetColumns = `id, organization_id AS "organizationId", content_hash AS "contentHash",
 mime_type AS "mimeType", width, height, size_bytes AS "sizeBytes", storage_key AS "storageKey"`;
function dated<T extends { updatedAt: string }>(row: T): T {
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString() };
}
export async function lockOrganization(db: Db, org: string): Promise<void> {
  await db.query("INSERT INTO catalog_sync_state (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [org]);
  await db.query("SELECT version FROM catalog_sync_state WHERE organization_id = $1 FOR UPDATE", [org]);
}
export async function version(db: Db, org: string): Promise<string> {
  const { rows } = await db.query<{ version: string }>(
    "SELECT version::text FROM catalog_sync_state WHERE organization_id = $1", [org]);
  return rows[0]?.version ?? "0";
}
export async function recordChange(db: Db, org: string, entity: string,
  data: Product | ProductAlias | BranchProduct, branchId: string | null = null): Promise<void> {
  const { rows } = await db.query<{ version: string }>(
    "UPDATE catalog_sync_state SET version = version + 1 WHERE organization_id = $1 RETURNING version::text", [org]);
  await db.query(`INSERT INTO catalog_changes (organization_id, version, entity, entity_id, branch_id, data)
    VALUES ($1,$2,$3,$4,$5,$6)`, [org, rows[0]!.version, entity, data.id, branchId, JSON.stringify(data)]);
}
export async function changes(db: Db, org: string, since: string, until: string, branchId: string | null, limit: number) {
  const { rows } = await db.query<{ version: string; entity: "products" | "productAliases" | "branchProducts"; data: Product | ProductAlias | BranchProduct }>(
    `SELECT version::text, entity, data FROM catalog_changes
      WHERE organization_id = $1 AND version > $2::bigint AND version <= $3::bigint
        AND (branch_id IS NULL OR branch_id = $4::uuid)
      ORDER BY catalog_changes.version ASC LIMIT $5`, [org, since, until, branchId, limit]);
  return rows;
}
export async function receipt(db: Db, org: string, key: string) {
  const { rows } = await db.query<{ user_id: string; payload_hash: string; result: unknown }>(
    "SELECT user_id, payload_hash, result FROM sync_receipts WHERE organization_id=$1 AND idempotency_key=$2", [org, key]);
  return rows[0];
}
export async function saveReceipt(db: Db, org: string, key: string, user: string, hash: string, result: unknown) {
  await db.query(`INSERT INTO sync_receipts (organization_id,idempotency_key,user_id,payload_hash,result)
    VALUES ($1,$2,$3,$4,$5)`, [org, key, user, hash, JSON.stringify(result)]);
}
export async function products(db: Db, org: string): Promise<Product[]> {
  const { rows } = await db.query<Product>("SELECT " + productColumns + " FROM products WHERE organization_id=$1", [org]);
  return rows.map(dated);
}
export async function product(db: Db, org: string, id: string): Promise<Product | null> {
  const { rows } = await db.query<Product>("SELECT " + productColumns + " FROM products WHERE organization_id=$1 AND id=$2", [org, id]);
  return rows[0] ? dated(rows[0]) : null;
}
export async function saveProduct(db: Db, org: string, id: string, value: ProductInput,
  normalized: { normalizedName: string; compactKey: string }, revision: number): Promise<Product> {
  const { rows } = await db.query<Product>(`INSERT INTO products
    (id,organization_id,display_name,normalized_name,compact_key,barcode,description,category,sku,item_type,base_unit,conversions,asset_id,active,revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, normalized_name=EXCLUDED.normalized_name,
    compact_key=EXCLUDED.compact_key, barcode=EXCLUDED.barcode, description=EXCLUDED.description,
    category=EXCLUDED.category, sku=EXCLUDED.sku, item_type=EXCLUDED.item_type, base_unit=EXCLUDED.base_unit,
    conversions=EXCLUDED.conversions, asset_id=EXCLUDED.asset_id, active=EXCLUDED.active,
    revision=EXCLUDED.revision, updated_at=clock_timestamp()
    WHERE products.organization_id=EXCLUDED.organization_id
    RETURNING ` + productColumns, [id,org,value.displayName,normalized.normalizedName,normalized.compactKey,
      value.barcode,value.description,value.category,value.sku,value.itemType,value.baseUnit,JSON.stringify(value.conversions),
      value.itemType === "service" ? null : value.assetId,value.active,revision]);
  if (!rows[0]) throw new Error("Product identity collision.");
  return dated(rows[0]);
}
export async function aliases(db: Db, org: string): Promise<ProductAlias[]> {
  return (await db.query<ProductAlias>("SELECT " + aliasColumns + " FROM product_aliases WHERE organization_id=$1", [org])).rows;
}
export async function addAlias(db: Db, org: string, id: string, productId: string, name: string,
  normalized: { normalizedName: string; compactKey: string }): Promise<ProductAlias | null> {
  const { rows } = await db.query<ProductAlias>(`INSERT INTO product_aliases
    (id,organization_id,product_id,display_name,normalized_name,compact_key) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (organization_id,product_id,compact_key) DO NOTHING RETURNING ` + aliasColumns,
    [id,org,productId,name,normalized.normalizedName,normalized.compactKey]);
  return rows[0] ?? null;
}
export async function branchProduct(db: Db, org: string, branch: string, productId: string): Promise<BranchProduct | null> {
  const { rows } = await db.query<BranchProduct>("SELECT " + branchColumns +
    " FROM branch_products WHERE organization_id=$1 AND branch_id=$2 AND product_id=$3", [org,branch,productId]);
  return rows[0] ? dated(rows[0]) : null;
}
export async function saveBranchProduct(db: Db, org: string, id: string, branch: string, productId: string,
  value: { price: string; cost: string; trackInventory: boolean; active: boolean }, revision: number): Promise<BranchProduct> {
  const { rows } = await db.query<BranchProduct>(`INSERT INTO branch_products
    (id,organization_id,branch_id,product_id,price,cost,track_inventory,active,revision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (organization_id,branch_id,product_id) DO UPDATE SET
    price=EXCLUDED.price,cost=EXCLUDED.cost,track_inventory=EXCLUDED.track_inventory,
    active=EXCLUDED.active,revision=EXCLUDED.revision,updated_at=clock_timestamp()
    RETURNING ` + branchColumns, [id,org,branch,productId,value.price,value.cost,value.trackInventory,value.active,revision]);
  return dated(rows[0]!);
}
export type StoredAsset = Asset & { storageKey: string };
export async function asset(db: Db, org: string, id: string): Promise<StoredAsset | null> {
  const { rows } = await db.query<StoredAsset>("SELECT " + assetColumns + " FROM product_assets WHERE organization_id=$1 AND id=$2", [org,id]);
  return rows[0] ?? null;
}
export async function assetByHash(db: Db, org: string, hash: string): Promise<StoredAsset | null> {
  const { rows } = await db.query<StoredAsset>("SELECT " + assetColumns + " FROM product_assets WHERE organization_id=$1 AND content_hash=$2", [org,hash]);
  return rows[0] ?? null;
}
export async function saveAsset(db: Db, value: StoredAsset): Promise<void> {
  await db.query(`INSERT INTO product_assets (id,organization_id,content_hash,storage_key,mime_type,width,height,size_bytes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [value.id,value.organizationId,value.contentHash,value.storageKey,value.mimeType,value.width,value.height,value.sizeBytes]);
}
export async function updateChannel(db: Db, org: string): Promise<"development" | "pilot" | "stable"> {
  const { rows } = await db.query<{ update_channel: "development" | "pilot" | "stable" }>(
    "SELECT update_channel FROM organizations WHERE id=$1", [org]);
  return rows[0]?.update_channel ?? "stable";
}
