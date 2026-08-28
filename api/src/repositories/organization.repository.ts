import type { Db } from "../db/pool.js";
import type { Branch, Organization, Warehouse } from "../types/domain.js";

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  timezone: string;
  currency: string;
  status: Organization["status"];
  branding: Record<string, unknown> | null;
}

interface BranchRow {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  geolocation_policy: Branch["geolocationPolicy"];
  is_active: boolean;
}

interface WarehouseRow {
  id: string;
  organization_id: string;
  branch_id: string;
  code: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
}

export async function findById(db: Db, organizationId: string): Promise<Organization | null> {
  const { rows } = await db.query<OrganizationRow>(
    `SELECT id, name, slug, legal_name, timezone, currency, status, branding
       FROM organizations
      WHERE id = $1
      LIMIT 1`,
    [organizationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    branding: row.branding ?? {},
  };
}

export async function findBySlug(db: Db, slug: string): Promise<Organization | null> {
  const { rows } = await db.query<OrganizationRow>(
    `SELECT id, name, slug, legal_name, timezone, currency, status, branding
       FROM organizations
      WHERE slug = $1
      LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legalName: row.legal_name,
    timezone: row.timezone,
    currency: row.currency,
    status: row.status,
    branding: row.branding ?? {},
  };
}

export async function insert(
  db: Db,
  input: {
    id: string;
    name: string;
    slug: string;
    legalName?: string | null;
    timezone?: string;
    currency?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO organizations (id, name, slug, legal_name, timezone, currency, status, branding)
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', '{}')`,
    [
      input.id,
      input.name,
      input.slug,
      input.legalName ?? null,
      input.timezone ?? "America/Merida",
      input.currency ?? "MXN",
    ],
  );
}

/** Siempre filtrado por organización: no existe un listado global de sucursales. */
export async function listBranches(db: Db, organizationId: string): Promise<Branch[]> {
  const { rows } = await db.query<BranchRow>(
    `SELECT id, organization_id, code, name, geolocation_policy, is_active
       FROM branches
      WHERE organization_id = $1
      ORDER BY name ASC`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    geolocationPolicy: row.geolocation_policy,
    isActive: row.is_active,
  }));
}

export async function findBranchById(
  db: Db,
  organizationId: string,
  branchId: string,
): Promise<Branch | null> {
  const { rows } = await db.query<BranchRow>(
    `SELECT id, organization_id, code, name, geolocation_policy, is_active
       FROM branches
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [branchId, organizationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    geolocationPolicy: row.geolocation_policy,
    isActive: row.is_active,
  };
}

export async function insertBranch(
  db: Db,
  input: { id: string; organizationId: string; code: string; name: string },
): Promise<void> {
  await db.query(
    `INSERT INTO branches (id, organization_id, code, name, geolocation_policy, is_active)
     VALUES ($1, $2, $3, $4, 'OFF', true)`,
    [input.id, input.organizationId, input.code, input.name],
  );
}

export async function listWarehouses(db: Db, organizationId: string): Promise<Warehouse[]> {
  const { rows } = await db.query<WarehouseRow>(
    `SELECT id, organization_id, branch_id, code, name, is_default, is_active
       FROM warehouses
      WHERE organization_id = $1
      ORDER BY name ASC`,
    [organizationId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default,
    isActive: row.is_active,
  }));
}

export async function insertWarehouse(
  db: Db,
  input: {
    id: string;
    organizationId: string;
    branchId: string;
    code: string;
    name: string;
    isDefault?: boolean;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO warehouses (id, organization_id, branch_id, code, name, is_default, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [input.id, input.organizationId, input.branchId, input.code, input.name, input.isDefault ?? false],
  );
}

/** Alta de la relación usuario-sucursal, siempre dentro de la organización. */
export async function assignUserToBranch(
  db: Db,
  organizationId: string,
  userId: string,
  branchId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO user_branches (organization_id, user_id, branch_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, branch_id) DO NOTHING`,
    [organizationId, userId, branchId],
  );
}

export async function listUserBranchIds(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const { rows } = await db.query<{ branch_id: string }>(
    `SELECT branch_id FROM user_branches WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId],
  );
  return rows.map((row) => row.branch_id);
}

/**
 * Sucursales visibles para un usuario concreto.
 *
 * El aislamiento por sucursal se resuelve en SQL con `user_branches`: el
 * cliente nunca envía la lista de sucursales permitidas.
 */
export async function listBranchesForUser(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<Branch[]> {
  const { rows } = await db.query<BranchRow>(
    `SELECT b.id, b.organization_id, b.code, b.name, b.geolocation_policy, b.is_active
       FROM branches b
       JOIN user_branches ub
         ON ub.branch_id = b.id
        AND ub.organization_id = b.organization_id
      WHERE b.organization_id = $1 AND ub.user_id = $2
      ORDER BY b.name ASC`,
    [organizationId, userId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    code: row.code,
    name: row.name,
    geolocationPolicy: row.geolocation_policy,
    isActive: row.is_active,
  }));
}

/** Almacenes de las sucursales asignadas al usuario. */
export async function listWarehousesForUser(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<Warehouse[]> {
  const { rows } = await db.query<WarehouseRow>(
    `SELECT w.id, w.organization_id, w.branch_id, w.code, w.name, w.is_default, w.is_active
       FROM warehouses w
       JOIN user_branches ub
         ON ub.branch_id = w.branch_id
        AND ub.organization_id = w.organization_id
      WHERE w.organization_id = $1 AND ub.user_id = $2
      ORDER BY w.name ASC`,
    [organizationId, userId],
  );
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default,
    isActive: row.is_active,
  }));
}

/** ¿El usuario tiene asignada esta sucursal dentro de su organización? */
export async function userHasBranch(
  db: Db,
  organizationId: string,
  userId: string,
  branchId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ ok: number }>(
    `SELECT 1 AS ok
       FROM user_branches
      WHERE organization_id = $1 AND user_id = $2 AND branch_id = $3
      LIMIT 1`,
    [organizationId, userId, branchId],
  );
  return rows.length > 0;
}

/**
 * Borrado en cascada de una organización completa.
 * Uso restringido: utilidades de mantenimiento y limpieza de pruebas de
 * integración. No se expone en ninguna ruta HTTP.
 */
export async function deleteById(db: Db, organizationId: string): Promise<void> {
  await db.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]);
}
