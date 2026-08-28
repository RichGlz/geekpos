import type { Db } from "../db/pool.js";
import type { License, LicenseStatus } from "../types/domain.js";

interface LicenseRow {
  id: string;
  organization_id: string;
  status: LicenseStatus;
  plan: string;
  starts_at: Date;
  expires_at: Date | null;
  grace_until: Date | null;
  max_branches: number | null;
  max_users: number | null;
}

function toLicense(row: LicenseRow): License {
  return {
    id: row.id,
    organizationId: row.organization_id,
    status: row.status,
    plan: row.plan,
    startsAt: new Date(row.starts_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    graceUntil: row.grace_until ? new Date(row.grace_until) : null,
    maxBranches: row.max_branches,
    maxUsers: row.max_users,
  };
}

export async function findByOrganization(db: Db, organizationId: string): Promise<License | null> {
  const { rows } = await db.query<LicenseRow>(
    `SELECT id, organization_id, status, plan, starts_at, expires_at, grace_until, max_branches, max_users
       FROM licenses
      WHERE organization_id = $1
      LIMIT 1`,
    [organizationId],
  );
  const row = rows[0];
  return row ? toLicense(row) : null;
}

export async function insert(
  db: Db,
  input: {
    id: string;
    organizationId: string;
    status: LicenseStatus;
    plan: string;
    expiresAt?: Date | null;
    graceUntil?: Date | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO licenses (id, organization_id, status, plan, starts_at, expires_at, grace_until)
     VALUES ($1, $2, $3, $4, now(), $5, $6)`,
    [input.id, input.organizationId, input.status, input.plan, input.expiresAt ?? null, input.graceUntil ?? null],
  );
}

export async function updateStatus(
  db: Db,
  organizationId: string,
  status: LicenseStatus,
): Promise<void> {
  await db.query(
    `UPDATE licenses SET status = $2, updated_at = now() WHERE organization_id = $1`,
    [organizationId, status],
  );
}
