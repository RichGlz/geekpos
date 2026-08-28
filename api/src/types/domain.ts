/**
 * Tipos base del dominio compartidos por toda la API.
 *
 * CONVENCIÓN OBLIGATORIA (ver docs/DECISIONS.md):
 * toda entidad de negocio lleva `organizationId`, y `branchId` cuando el dato
 * pertenece a una sucursal concreta.
 */

export type LicenseStatus = "ACTIVE" | "GRACE" | "READ_ONLY" | "SUSPENDED" | "CANCELLED";
export const LICENSE_STATUSES: readonly LicenseStatus[] = [
  "ACTIVE",
  "GRACE",
  "READ_ONLY",
  "SUSPENDED",
  "CANCELLED",
];

export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type GeolocationPolicy = "OFF" | "RECORD" | "WARN" | "BLOCK";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  timezone: string;
  currency: string;
  status: OrganizationStatus;
  branding: Record<string, unknown>;
}

export interface Branch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  geolocationPolicy: GeolocationPolicy;
  isActive: boolean;
}

export interface Warehouse {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface User {
  id: string;
  organizationId: string | null;
  email: string;
  fullName: string;
  isActive: boolean;
  isPlatformAdmin: boolean;
}

export interface UserWithSecret extends User {
  passwordHash: string;
}

export interface License {
  id: string;
  organizationId: string;
  status: LicenseStatus;
  plan: string;
  startsAt: Date;
  expiresAt: Date | null;
  graceUntil: Date | null;
  maxBranches: number | null;
  maxUsers: number | null;
}

export interface Session {
  id: string;
  organizationId: string | null;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export type RefreshTokenRevokedReason =
  | "ROTATED"
  | "LOGOUT"
  | "SESSION_REVOKED"
  | "REUSE_DETECTED"
  | "EXPIRED";

export interface RefreshTokenRecord {
  id: string;
  sessionId: string;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  replacedBy: string | null;
  revokedAt: Date | null;
  revokedReason: RefreshTokenRevokedReason | null;
}

/**
 * Contexto de la petición autenticada.
 * `organizationId` SIEMPRE se resuelve aquí, desde la sesión — nunca desde el
 * body, la query o un header enviado por el cliente.
 */
export interface RequestContext {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  isPlatformAdmin: boolean;
  roles: string[];
  permissions: string[];
  licenseStatus: LicenseStatus | null;
}

/** Contexto ya garantizado como perteneciente a una organización. */
export interface TenantContext extends RequestContext {
  organizationId: string;
}
