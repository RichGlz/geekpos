import { describe, expect, it } from "vitest";
import { computeLockSeconds } from "../loginThrottle.service.js";

const policy = { maxAttempts: 5, windowSeconds: 900, maxLockSeconds: 900 };

describe("backoff de login", () => {
  it("no bloquea por debajo del umbral", () => {
    expect(computeLockSeconds(0, policy)).toBe(0);
    expect(computeLockSeconds(4, policy)).toBe(0);
  });

  it("crece exponencialmente a partir del umbral", () => {
    expect(computeLockSeconds(5, policy)).toBe(15);
    expect(computeLockSeconds(6, policy)).toBe(30);
    expect(computeLockSeconds(7, policy)).toBe(60);
  });

  it("nunca supera el techo configurado: el bloqueo siempre expira", () => {
    expect(computeLockSeconds(50, policy)).toBe(policy.maxLockSeconds);
    expect(computeLockSeconds(5000, policy)).toBe(policy.maxLockSeconds);
  });
});
