import { describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors.js";
import { assertOperationAllowed, effectiveStatus } from "../license.service.js";
import type { License } from "../../types/domain.js";

const base: License = {
  id: "l1",
  organizationId: "o1",
  status: "ACTIVE",
  plan: "STANDARD",
  startsAt: new Date("2026-01-01"),
  expiresAt: null,
  graceUntil: null,
  maxBranches: null,
  maxUsers: null,
};

const now = new Date("2026-06-01T00:00:00Z");

describe("estado efectivo de licencia", () => {
  it("sin licencia se considera suspendida", () => {
    expect(effectiveStatus(null, now)).toBe("SUSPENDED");
  });

  it("vencida dentro de la gracia entra en GRACE", () => {
    const license = { ...base, expiresAt: new Date("2026-05-01"), graceUntil: new Date("2026-06-10") };
    expect(effectiveStatus(license, now)).toBe("GRACE");
  });

  it("vencida y fuera de gracia queda en solo lectura", () => {
    const license = { ...base, expiresAt: new Date("2026-05-01"), graceUntil: new Date("2026-05-10") };
    expect(effectiveStatus(license, now)).toBe("READ_ONLY");
  });
});

describe("permisos por estado de licencia", () => {
  it("ACTIVE y GRACE permiten escribir", () => {
    expect(() => assertOperationAllowed("ACTIVE", "POST")).not.toThrow();
    expect(() => assertOperationAllowed("GRACE", "POST")).not.toThrow();
  });

  it("READ_ONLY permite leer pero no escribir", () => {
    expect(() => assertOperationAllowed("READ_ONLY", "GET")).not.toThrow();
    expect(() => assertOperationAllowed("READ_ONLY", "POST")).toThrow(AppError);
  });

  it("SUSPENDED bloquea todo", () => {
    expect(() => assertOperationAllowed("SUSPENDED", "GET")).toThrow(AppError);
  });
});
