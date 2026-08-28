import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/**
 * Parámetros Argon2id. No inventamos criptografía propia: usamos la variante
 * recomendada por OWASP con costes razonables para un POS multiusuario.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function newId(): string {
  return randomUUID();
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Refresh token opaco. El valor en claro solo existe en la cookie del cliente;
 * la base de datos guarda únicamente su hash SHA-256.
 */
export function generateRefreshTokenSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshTokenSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function generateRandomPassword(): string {
  return randomBytes(18).toString("base64url");
}
