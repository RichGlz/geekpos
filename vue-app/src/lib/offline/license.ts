export const OFFLINE_NORMAL_DAYS = 3;
export const OFFLINE_WARNING_DAYS = 7;
export const OFFLINE_MAX_DAYS = 10;
export const DAY_MS = 86_400_000;
export interface OfflineLicense {
  status: string;
  lastLicenseValidationAt: string;
  licenseOfflineValidUntil: string;
  receivedAt: number;
  observedAt: number;
}
export type OfflineLicenseState = "normal" | "warning" | "grace" | "requires_validation";
/** Fixed server expiry + non-decreasing observed time; local clock changes never renew a grant. */
export function licenseState(license: OfflineLicense | undefined, now = Date.now()): OfflineLicenseState {
  if (!license) return "requires_validation";
  const validated = Date.parse(license.lastLicenseValidationAt), expires = Date.parse(license.licenseOfflineValidUntil);
  if (!Number.isFinite(validated) || !Number.isFinite(expires) || !["ACTIVE", "GRACE"].includes(license.status)) return "requires_validation";
  // A backward clock is suspicious, never an extra offline window.
  if (now + 60_000 < license.receivedAt || now + 60_000 < license.observedAt) return "requires_validation";
  const elapsed = Math.max(0, Math.max(now, license.observedAt) - license.receivedAt);
  if (validated + elapsed >= expires || elapsed >= OFFLINE_MAX_DAYS * DAY_MS) return "requires_validation";
  if (elapsed >= OFFLINE_WARNING_DAYS * DAY_MS) return "grace";
  if (elapsed >= OFFLINE_NORMAL_DAYS * DAY_MS) return "warning";
  return "normal";
}
