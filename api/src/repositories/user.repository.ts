import type { Db } from "../db/pool.js";
import type { User, UserWithSecret } from "../types/domain.js";

interface UserRow {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string;
  is_active: boolean;
  is_platform_admin: boolean;
  password_hash: string;
}

function toUser(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    fullName: row.full_name,
    isActive: row.is_active,
    isPlatformAdmin: row.is_platform_admin,
    passwordHash: row.password_hash,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findByEmail(db: Db, email: string): Promise<UserWithSecret | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, organization_id, email, full_name, is_active, is_platform_admin, password_hash
       FROM users
      WHERE email_normalized = $1
      LIMIT 1`,
    [normalizeEmail(email)],
  );
  const row = rows[0];
  return row ? toUser(row) : null;
}

export async function findById(db: Db, userId: string): Promise<UserWithSecret | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, organization_id, email, full_name, is_active, is_platform_admin, password_hash
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return row ? toUser(row) : null;
}

/**
 * Lectura aislada por tenant: exige el organization_id del contexto de sesión.
 * No existe ninguna variante de esta función sin filtro de organización.
 */
export async function findByIdForOrganization(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<User | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, organization_id, email, full_name, is_active, is_platform_admin, password_hash
       FROM users
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [userId, organizationId],
  );
  const row = rows[0];
  if (!row) return null;
  const { passwordHash: _ignored, ...user } = toUser(row);
  return user;
}

export async function listForOrganization(db: Db, organizationId: string): Promise<User[]> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, organization_id, email, full_name, is_active, is_platform_admin, password_hash
       FROM users
      WHERE organization_id = $1
      ORDER BY full_name ASC`,
    [organizationId],
  );
  return rows.map((row) => {
    const { passwordHash: _ignored, ...user } = toUser(row);
    return user;
  });
}

export async function insert(
  db: Db,
  input: {
    id: string;
    organizationId: string | null;
    email: string;
    fullName: string;
    passwordHash: string;
    isPlatformAdmin?: boolean;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO users (id, organization_id, email, email_normalized, full_name, password_hash, is_active, is_platform_admin)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
    [
      input.id,
      input.organizationId,
      input.email.trim(),
      normalizeEmail(input.email),
      input.fullName,
      input.passwordHash,
      input.isPlatformAdmin ?? false,
    ],
  );
}

export async function touchLastLogin(db: Db, userId: string): Promise<void> {
  await db.query(`UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, [userId]);
}

export async function findRolesAndPermissions(
  db: Db,
  userId: string,
): Promise<{ roles: string[]; permissions: string[] }> {
  const { rows: roleRows } = await db.query<{ code: string }>(
    `SELECT r.code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  const { rows: permissionRows } = await db.query<{ permission_code: string }>(
    `SELECT DISTINCT rp.permission_code
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId],
  );
  return {
    roles: roleRows.map((row) => row.code),
    permissions: permissionRows.map((row) => row.permission_code),
  };
}

/**
 * Alta de rol. `organizationId` es obligatorio en la fila: la base valida que
 * el rol sea global (roles.organization_id IS NULL) o del mismo tenant.
 */
export async function assignRole(
  db: Db,
  organizationId: string | null,
  userId: string,
  roleId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO user_roles (organization_id, user_id, role_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [organizationId, userId, roleId],
  );
}

/** Reemplaza el hash de contraseña. Solo lo usan flujos administrativos y el seed de desarrollo. */
export async function updatePasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db.query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
    [userId, passwordHash],
  );
}
