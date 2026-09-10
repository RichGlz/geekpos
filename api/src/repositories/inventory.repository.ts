import type { Db } from "../db/pool.js";
import type { BranchProduct } from "../lib/catalog.js";
import type { InventoryMovement, InventoryMovementType } from "../lib/inventory.js";

const movementColumns = `id, organization_id AS "organizationId", branch_id AS "branchId",
 product_id AS "productId", warehouse_id AS "warehouseId", movement_type AS type,
 quantity::text, unit, base_quantity_delta::text AS "baseQuantityDelta", user_id AS "userId",
 occurred_at AS "occurredAt", comment, reference, idempotency_key AS "idempotencyKey",
 sync_state AS "syncState", created_at AS "createdAt"`;
const branchColumns = `id, organization_id AS "organizationId", branch_id AS "branchId",
 product_id AS "productId", price::text, cost::text, stock::text,
 track_inventory AS "trackInventory", active, revision, updated_at AS "updatedAt"`;

function datedMovement(row: InventoryMovement): InventoryMovement {
  return { ...row, occurredAt: new Date(row.occurredAt).toISOString(), createdAt: new Date(row.createdAt).toISOString() };
}
function datedBranch(row: BranchProduct): BranchProduct {
  return { ...row, updatedAt: new Date(row.updatedAt).toISOString() };
}

export async function lockBranchProduct(
  db: Db, organizationId: string, branchId: string, productId: string,
): Promise<BranchProduct | null> {
  const { rows } = await db.query<BranchProduct>(
    `SELECT ${branchColumns} FROM branch_products
      WHERE organization_id=$1 AND branch_id=$2 AND product_id=$3 FOR UPDATE`,
    [organizationId, branchId, productId],
  );
  return rows[0] ? datedBranch(rows[0]) : null;
}

export async function warehouseBelongsToBranch(
  db: Db, organizationId: string, branchId: string, warehouseId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM warehouses
      WHERE organization_id=$1 AND branch_id=$2 AND id=$3 AND is_active=true`,
    [organizationId, branchId, warehouseId],
  );
  return rows.length > 0;
}

export async function hasMovements(
  db: Db, organizationId: string, branchId: string, productId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM inventory_movements
      WHERE organization_id=$1 AND branch_id=$2 AND product_id=$3 LIMIT 1`,
    [organizationId, branchId, productId],
  );
  return rows.length > 0;
}

export async function insertMovement(db: Db, value: {
  id: string; organizationId: string; branchId: string; productId: string;
  warehouseId: string | null; type: InventoryMovementType; quantity: string; unit: string;
  baseQuantityDelta: string; userId: string; occurredAt: string; comment: string | null;
  reference: string | null; idempotencyKey: string;
}): Promise<InventoryMovement> {
  const { rows } = await db.query<InventoryMovement>(
    `INSERT INTO inventory_movements
      (id,organization_id,branch_id,product_id,warehouse_id,movement_type,quantity,unit,
       base_quantity_delta,user_id,occurred_at,comment,reference,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${movementColumns}`,
    [value.id, value.organizationId, value.branchId, value.productId, value.warehouseId,
      value.type, value.quantity, value.unit, value.baseQuantityDelta, value.userId,
      value.occurredAt, value.comment, value.reference, value.idempotencyKey],
  );
  return datedMovement(rows[0]!);
}

/** `branch_products.stock` is a transactional cache; movements remain reconstructable truth. */
export async function addToStock(
  db: Db, organizationId: string, branchId: string, productId: string, delta: string,
): Promise<BranchProduct> {
  const { rows } = await db.query<BranchProduct>(
    `UPDATE branch_products SET stock=stock+$4::numeric, updated_at=clock_timestamp()
      WHERE organization_id=$1 AND branch_id=$2 AND product_id=$3
      RETURNING ${branchColumns}`,
    [organizationId, branchId, productId, delta],
  );
  return datedBranch(rows[0]!);
}

export async function listForBranch(
  db: Db, organizationId: string, branchId: string, productId?: string,
): Promise<InventoryMovement[]> {
  const params: unknown[] = [organizationId, branchId];
  const productFilter = productId ? ` AND product_id=$${params.push(productId)}` : "";
  const { rows } = await db.query<InventoryMovement>(
    `SELECT ${movementColumns} FROM inventory_movements
      WHERE organization_id=$1 AND branch_id=$2${productFilter}
      ORDER BY occurred_at DESC, id DESC LIMIT 500`, params,
  );
  return rows.map(datedMovement);
}
