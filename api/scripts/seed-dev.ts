/**
 * SEED DE DESARROLLO — NO EJECUTAR EN PRODUCCIÓN.
 *
 * Reglas de seguridad de este script (se conservan tal cual):
 *  - Aborta si NODE_ENV === 'production'.
 *  - Exige la bandera explícita ALLOW_DEV_SEED=true.
 *  - No contiene contraseñas fijas reutilizables: genera contraseñas
 *    aleatorias y las imprime UNA sola vez en la consola del desarrollador.
 *    Si prefieres fijarlas, usa SEED_OWNER_PASSWORD / SEED_CASHIER_PASSWORD
 *    en tu .env local (nunca versionado).
 *  - No es una migración: vive fuera de `migrations/` para que el migrador
 *    de producción jamás lo aplique.
 *
 * Es idempotente y REPARADOR: si el entorno demo quedó a medias, completa lo
 * que falte (organización, sucursal, almacén, licencia, usuarios, sucursales
 * asignadas y roles) sin tocar las contraseñas existentes. Para restablecer
 * las contraseñas demo hay que pedirlo de forma explícita con
 * SEED_RESET_PASSWORDS=true.
 *
 * Uso (POSIX):
 *   ALLOW_DEV_SEED=true npm run seed:dev
 * Uso (PowerShell):
 *   $env:ALLOW_DEV_SEED="true"; npm run seed:dev
 */
import pg from "pg";
import { loadEnv } from "../src/config/env.js";
import { createDb, type Db } from "../src/db/pool.js";
import { generateRandomPassword, hashPassword, newId } from "../src/lib/crypto.js";
import * as licenseRepository from "../src/repositories/license.repository.js";
import * as organizationRepository from "../src/repositories/organization.repository.js";
import * as userRepository from "../src/repositories/user.repository.js";
import { createUser } from "../src/services/auth.service.js";

const SYSTEM_ROLE_OWNER = "11111111-1111-4111-8111-000000000001";
const SYSTEM_ROLE_CASHIER = "11111111-1111-4111-8111-000000000004";

const OWNER_EMAIL = "owner@demo.local";
const CASHIER_EMAIL = "caja@demo.local";

interface EnsuredUser {
  id: string;
  password: string | null;
  created: boolean;
}

async function ensureUser(
  db: Db,
  input: {
    organizationId: string;
    branchId: string;
    email: string;
    fullName: string;
    roleId: string;
    password: string;
    resetPassword: boolean;
  },
): Promise<EnsuredUser> {
  const existing = await userRepository.findByEmail(db, input.email);
  let userId: string;
  let created = false;
  let password: string | null = null;

  if (existing) {
    userId = existing.id;
    if (input.resetPassword) {
      await userRepository.updatePasswordHash(db, userId, await hashPassword(input.password));
      password = input.password;
    }
  } else {
    userId = await createUser(db, {
      organizationId: input.organizationId,
      email: input.email,
      fullName: input.fullName,
      password: input.password,
    });
    created = true;
    password = input.password;
  }

  // Sin acceso total implícito: incluso el OWNER necesita sucursal asignada.
  await organizationRepository.assignUserToBranch(db, input.organizationId, userId, input.branchId);
  await userRepository.assignRole(db, input.organizationId, userId, input.roleId);

  return { id: userId, password, created };
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (env.isProduction) {
    throw new Error("El seed de desarrollo no puede ejecutarse con NODE_ENV=production.");
  }
  if (process.env["ALLOW_DEV_SEED"] !== "true") {
    throw new Error("Define ALLOW_DEV_SEED=true para confirmar la carga de datos de desarrollo.");
  }

  const resetPasswords = process.env["SEED_RESET_PASSWORDS"] === "true";

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const db = createDb(pool);

  try {
    // --- Organización -------------------------------------------------------
    let organization = await organizationRepository.findBySlug(db, "demo");
    if (!organization) {
      const organizationId = newId();
      await organizationRepository.insert(db, {
        id: organizationId,
        name: "Comercial Demo",
        slug: "demo",
        legalName: "Comercial Demo S.A. de C.V.",
      });
      organization = await organizationRepository.findBySlug(db, "demo");
    }
    if (!organization) throw new Error("No se pudo crear la organización demo.");
    const organizationId = organization.id;

    // --- Sucursal -----------------------------------------------------------
    const branches = await organizationRepository.listBranches(db, organizationId);
    let branch = branches.find((item) => item.code === "MTZ");
    if (!branch) {
      const branchId = newId();
      await organizationRepository.insertBranch(db, {
        id: branchId,
        organizationId,
        code: "MTZ",
        name: "Matriz",
      });
      branch = (await organizationRepository.listBranches(db, organizationId)).find(
        (item) => item.code === "MTZ",
      );
    }
    if (!branch) throw new Error("No se pudo crear la sucursal demo.");

    // --- Almacén ------------------------------------------------------------
    const warehouses = await organizationRepository.listWarehouses(db, organizationId);
    if (!warehouses.some((item) => item.code === "ALM-MTZ")) {
      await organizationRepository.insertWarehouse(db, {
        id: newId(),
        organizationId,
        branchId: branch.id,
        code: "ALM-MTZ",
        name: "Almacén Matriz",
        isDefault: true,
      });
    }

    // --- Licencia -----------------------------------------------------------
    if (!(await licenseRepository.findByOrganization(db, organizationId))) {
      await licenseRepository.insert(db, {
        id: newId(),
        organizationId,
        status: "ACTIVE",
        plan: "STANDARD",
      });
    }

    // --- Usuarios -----------------------------------------------------------
    const owner = await ensureUser(db, {
      organizationId,
      branchId: branch.id,
      email: OWNER_EMAIL,
      fullName: "Propietario Demo",
      roleId: SYSTEM_ROLE_OWNER,
      password: process.env["SEED_OWNER_PASSWORD"] ?? generateRandomPassword(),
      resetPassword: resetPasswords,
    });
    const cashier = await ensureUser(db, {
      organizationId,
      branchId: branch.id,
      email: CASHIER_EMAIL,
      fullName: "Cajero Demo",
      roleId: SYSTEM_ROLE_CASHIER,
      password: process.env["SEED_CASHIER_PASSWORD"] ?? generateRandomPassword(),
      resetPassword: resetPasswords,
    });

    const lines = ["", "✔ Entorno demo verificado y completado.", ""];
    for (const [email, user] of [
      [OWNER_EMAIL, owner],
      [CASHIER_EMAIL, cashier],
    ] as const) {
      if (user.password) {
        lines.push(`  ${email.padEnd(18)} ${user.password}   ${user.created ? "(nuevo)" : "(contraseña restablecida)"}`);
      } else {
        lines.push(`  ${email.padEnd(18)} (contraseña existente sin cambios)`);
      }
    }
    lines.push(
      "",
      "  Credenciales SOLO para este entorno local. Se muestran una única vez",
      "  y no quedan escritas en ningún archivo del repositorio.",
      "  Para regenerarlas: SEED_RESET_PASSWORDS=true npm run seed:dev",
      "",
    );
    process.stdout.write(lines.join("\n"));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`✖ ${(error as Error).message}\n`);
  process.exit(1);
});
