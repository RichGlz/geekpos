import type { Db } from "../db/pool.js";
import { AppError } from "../lib/errors.js";
import * as licenseRepository from "../repositories/license.repository.js";
import type { License, LicenseStatus } from "../types/domain.js";

/**
 * La autoridad final de la licencia vive SIEMPRE en el servidor.
 * El cliente puede mostrar el estado, pero nunca decidirlo.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

/**
 * Estado efectivo: si la licencia venció pero sigue dentro de la gracia,
 * el estado efectivo es GRACE; pasada la gracia, READ_ONLY.
 */
export function effectiveStatus(license: License | null, now: Date = new Date()): LicenseStatus {
  if (!license) return "SUSPENDED";
  if (license.status === "SUSPENDED" || license.status === "CANCELLED" || license.status === "READ_ONLY") {
    return license.status;
  }
  if (license.expiresAt && license.expiresAt.getTime() <= now.getTime()) {
    if (license.graceUntil && license.graceUntil.getTime() > now.getTime()) return "GRACE";
    return "READ_ONLY";
  }
  return license.status;
}

export async function resolveStatus(
  db: Db,
  organizationId: string,
  now: Date = new Date(),
): Promise<LicenseStatus> {
  const license = await licenseRepository.findByOrganization(db, organizationId);
  return effectiveStatus(license, now);
}

/** Lanza si la operación solicitada no está permitida por el estado de licencia. */
export function assertOperationAllowed(status: LicenseStatus, method: string): void {
  if (status === "ACTIVE" || status === "GRACE") return;

  if (status === "READ_ONLY") {
    if (!isWriteMethod(method)) return;
    throw new AppError(
      403,
      "LICENSE_READ_ONLY",
      "La licencia está en modo solo lectura. Puedes consultar información, pero no registrar operaciones.",
    );
  }

  throw new AppError(
    403,
    status === "CANCELLED" ? "LICENSE_CANCELLED" : "LICENSE_SUSPENDED",
    "La licencia de esta organización no está activa. Contacta al administrador.",
  );
}

export async function getLicense(db: Db, organizationId: string): Promise<License | null> {
  return licenseRepository.findByOrganization(db, organizationId);
}
