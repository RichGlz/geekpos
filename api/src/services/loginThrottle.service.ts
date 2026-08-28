import type { Db } from "../db/pool.js";
import { newId } from "../lib/crypto.js";
import * as loginAttempts from "../repositories/loginAttempt.repository.js";

export interface ThrottlePolicy {
  maxAttempts: number;
  windowSeconds: number;
  /** Techo del bloqueo. El bloqueo SIEMPRE expira solo; nunca es permanente. */
  maxLockSeconds: number;
}

export interface ThrottleDecision {
  blocked: boolean;
  retryAfterSeconds: number;
}

/**
 * Backoff exponencial con techo.
 *
 * Reglas de diseño:
 *  - El bloqueo es temporal y se libera solo: no existe bloqueo indefinido de
 *    cuenta que un tercero pueda provocar a voluntad.
 *  - Los fallos por correo y por IP se cuentan por separado, de modo que el
 *    ruido generado desde una IP ajena no expulsa al titular de la cuenta.
 *  - Un login correcto limpia los fallos de esa cuenta.
 */
/** Cuántas veces más tolerante es el umbral por IP que el de la cuenta. */
export const IP_ATTEMPT_MULTIPLIER = 5;

export function computeLockSeconds(failures: number, policy: ThrottlePolicy): number {
  if (failures < policy.maxAttempts) return 0;
  const over = failures - policy.maxAttempts;
  const seconds = Math.min(policy.maxLockSeconds, 2 ** Math.min(over, 16) * 15);
  return seconds;
}

export async function check(
  db: Db,
  input: { emailNormalized: string; ipAddress: string | null },
  policy: ThrottlePolicy,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const since = new Date(now.getTime() - policy.windowSeconds * 1000);
  const { byEmail, byIp, lastFailureAt } = await loginAttempts.countRecentFailures(db, {
    emailNormalized: input.emailNormalized,
    ipAddress: input.ipAddress,
    since,
  });

  /**
   * La IP es una señal mucho más ruidosa que la cuenta: detrás de un NAT
   * corporativo o de un cibercafé conviven muchos usuarios legítimos. Por eso
   * el umbral por IP es IP_ATTEMPT_MULTIPLIER veces el de la cuenta: sirve
   * como cortafuegos contra fuerza bruta distribuida sin que el error de un
   * tercero expulse al titular.
   */
  const ipPolicy: ThrottlePolicy = {
    ...policy,
    maxAttempts: policy.maxAttempts * IP_ATTEMPT_MULTIPLIER,
  };
  const lockSeconds = Math.max(
    computeLockSeconds(byEmail, policy),
    computeLockSeconds(byIp, ipPolicy),
  );
  if (lockSeconds === 0 || !lastFailureAt) return { blocked: false, retryAfterSeconds: 0 };

  const unlockAt = new Date(lastFailureAt.getTime() + lockSeconds * 1000);
  const remaining = Math.ceil((unlockAt.getTime() - now.getTime()) / 1000);
  if (remaining <= 0) return { blocked: false, retryAfterSeconds: 0 };
  return { blocked: true, retryAfterSeconds: remaining };
}

export async function recordFailure(
  db: Db,
  input: { emailNormalized: string; ipAddress: string | null },
): Promise<void> {
  await loginAttempts.insert(db, {
    id: newId(),
    emailNormalized: input.emailNormalized,
    ipAddress: input.ipAddress,
    succeeded: false,
  });
}

export async function recordSuccess(
  db: Db,
  input: { emailNormalized: string; ipAddress: string | null },
): Promise<void> {
  await loginAttempts.insert(db, {
    id: newId(),
    emailNormalized: input.emailNormalized,
    ipAddress: input.ipAddress,
    succeeded: true,
  });
  await loginAttempts.clearFailuresForEmail(db, input.emailNormalized);
}
