import type { Db, TransactionalDb } from "../db/pool.js";
import { AppError, forbidden, tooManyRequests, unauthorized } from "../lib/errors.js";
import {
  generateRefreshTokenSecret,
  hashPassword,
  hashRefreshTokenSecret,
  newId,
  verifyPassword,
} from "../lib/crypto.js";
import type { TokenSigner } from "../lib/jwt.js";
import { parseRefreshToken } from "../lib/refreshToken.js";

import * as auditRepository from "../repositories/audit.repository.js";
import * as licenseRepository from "../repositories/license.repository.js";
import * as refreshTokenRepository from "../repositories/refreshToken.repository.js";
import * as sessionRepository from "../repositories/session.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { normalizeEmail } from "../repositories/user.repository.js";
import type { RequestContext, Session, User } from "../types/domain.js";
import { effectiveStatus } from "./license.service.js";
import * as throttle from "./loginThrottle.service.js";

export interface AuthServiceDeps {
  db: TransactionalDb;
  signer: TokenSigner;
  refreshTtlDays: number;
  throttlePolicy: throttle.ThrottlePolicy;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: User;
  sessionId: string;
  licenseStatus: string | null;
}

/** Mensaje idéntico para usuario inexistente y contraseña incorrecta. */
const GENERIC_LOGIN_ERROR = "Correo o contraseña incorrectos.";

async function buildContextClaims(db: Db, user: User) {
  const { roles, permissions } = await userRepository.findRolesAndPermissions(db, user.id);
  const licenseStatus = user.organizationId
    ? effectiveStatus(await licenseRepository.findByOrganization(db, user.organizationId))
    : null;
  return { roles, permissions, licenseStatus };
}

function refreshExpiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function login(
  deps: AuthServiceDeps,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<AuthResult> {
  const { db, signer, refreshTtlDays, throttlePolicy } = deps;
  const emailNormalized = normalizeEmail(input.email);

  const decision = await throttle.check(db, { emailNormalized, ipAddress: meta.ipAddress }, throttlePolicy);
  if (decision.blocked) {
    throw tooManyRequests(
      `Demasiados intentos fallidos. Inténtalo de nuevo en ${decision.retryAfterSeconds} segundos.`,
      { retryAfterSeconds: decision.retryAfterSeconds },
    );
  }

  const user = await userRepository.findByEmail(db, input.email);

  // Se verifica siempre un hash para no revelar por tiempo si el correo existe.
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0aEZ0d0Z0d0Z0d0Z0d0Z0d0Z0d0Z0d0Z0d0Z0d0",
        input.password,
      );

  if (!user || !passwordOk) {
    await throttle.recordFailure(db, { emailNormalized, ipAddress: meta.ipAddress });
    await auditRepository.insert(db, {
      id: newId(),
      organizationId: user?.organizationId ?? null,
      userId: user?.id ?? null,
      action: "auth.login.failed",
      entity: "user",
      entityId: user?.id ?? null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { email: emailNormalized },
    });
    throw unauthorized(GENERIC_LOGIN_ERROR, "INVALID_CREDENTIALS");
  }

  if (!user.isActive) {
    await throttle.recordFailure(db, { emailNormalized, ipAddress: meta.ipAddress });
    throw forbidden("Tu cuenta está desactivada. Contacta al administrador.", "USER_INACTIVE");
  }

  const { roles, permissions, licenseStatus } = await buildContextClaims(db, user);

  if (licenseStatus === "SUSPENDED" || licenseStatus === "CANCELLED") {
    throw forbidden(
      "La licencia de esta organización no está activa. Contacta al administrador.",
      licenseStatus === "CANCELLED" ? "LICENSE_CANCELLED" : "LICENSE_SUSPENDED",
    );
  }

  const sessionId = newId();
  const familyId = newId();
  const refreshSecret = generateRefreshTokenSecret();
  const expiresAt = refreshExpiry(refreshTtlDays);

  await db.transaction(async (tx) => {
    await sessionRepository.insert(tx, {
      id: sessionId,
      organizationId: user.organizationId,
      userId: user.id,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
    await refreshTokenRepository.insert(tx, {
      id: newId(),
      sessionId,
      familyId,
      tokenHash: hashRefreshTokenSecret(refreshSecret),
      expiresAt,
    });
    await userRepository.touchLastLogin(tx, user.id);
    await auditRepository.insert(tx, {
      id: newId(),
      organizationId: user.organizationId,
      userId: user.id,
      action: "auth.login.succeeded",
      entity: "session",
      entityId: sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {},
    });
  });

  await throttle.recordSuccess(db, { emailNormalized, ipAddress: meta.ipAddress });

  const { token, expiresIn } = await signer.sign({
    sub: user.id,
    sid: sessionId,
    org: user.organizationId,
    padm: user.isPlatformAdmin,
    roles,
    perms: permissions,
  });

  const { passwordHash: _secret, ...publicUser } = user;
  return {
    accessToken: token,
    expiresIn,
    refreshToken: `${sessionId}.${refreshSecret}`,
    refreshExpiresAt: expiresAt,
    user: publicUser,
    sessionId,
    licenseStatus,
  };
}

class RotationLostError extends Error {}

/** Quema la familia completa y revoca la sesión ante una reutilización. */
async function burnFamily(
  deps: AuthServiceDeps,
  record: { familyId: string; sessionId: string },
  meta: RequestMeta,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await refreshTokenRepository.revokeFamily(tx, record.familyId, "REUSE_DETECTED");
    await sessionRepository.revoke(tx, record.sessionId, "REUSE_DETECTED");
    await auditRepository.insert(tx, {
      id: newId(),
      organizationId: null,
      userId: null,
      action: "auth.refresh.reuse_detected",
      entity: "refresh_token_family",
      entityId: record.familyId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { sessionId: record.sessionId },
    });
  });
}

export async function refresh(
  deps: AuthServiceDeps,
  presentedToken: string,
  meta: RequestMeta,
): Promise<AuthResult> {
  const { db, signer, refreshTtlDays } = deps;

  // Formato estricto `sessionId.secret`. Un valor mal formado ni siquiera
  // llega a la base de datos.
  const parsed = parseRefreshToken(presentedToken);
  if (!parsed) throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "INVALID_REFRESH_TOKEN");
  const tokenHash = hashRefreshTokenSecret(parsed.secret);

  const record = await refreshTokenRepository.findByHash(db, tokenHash);
  if (!record) throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "INVALID_REFRESH_TOKEN");

  // El prefijo tiene que corresponder con la sesión del token guardado; si no,
  // alguien está mezclando piezas de tokens distintos.
  if (parsed.sessionId !== record.sessionId) {
    await burnFamily(deps, record, meta);
    throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "INVALID_REFRESH_TOKEN");
  }

  // Reutilización: el token ya fue rotado o revocado -> se quema la familia.
  if (record.revokedAt || record.replacedBy) {
    await burnFamily(deps, record, meta);
    throw unauthorized(
      "Se detectó un uso indebido de la sesión y se cerró por seguridad. Inicia sesión de nuevo.",
      "REFRESH_TOKEN_REUSE",
    );
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await refreshTokenRepository.revokeFamily(db, record.familyId, "EXPIRED");
    throw unauthorized("Tu sesión expiró. Inicia sesión de nuevo.", "REFRESH_TOKEN_EXPIRED");
  }

  const session = await sessionRepository.findActiveById(db, record.sessionId);
  if (!session) throw unauthorized("Sesión revocada. Inicia sesión de nuevo.", "SESSION_REVOKED");

  if (parsed.sessionId !== session.id) {
    await burnFamily(deps, record, meta);
    throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "INVALID_REFRESH_TOKEN");
  }


  const user = await userRepository.findById(db, session.userId);
  if (!user || !user.isActive) throw unauthorized("Sesión no válida.", "USER_INACTIVE");
  if (user.organizationId !== session.organizationId) {
    await burnFamily(deps, record, meta);
    throw unauthorized("Sesión no válida. Inicia sesión de nuevo.", "SESSION_REVOKED");
  }

  const { roles, permissions, licenseStatus } = await buildContextClaims(db, user);

  const nextSecret = generateRefreshTokenSecret();
  const nextId = newId();
  const expiresAt = refreshExpiry(refreshTtlDays);

  /**
   * Rotación atómica. Dentro de la transacción se bloquea la fila del token
   * (FOR UPDATE) y se actualiza de forma condicional: solo una petición
   * concurrente puede escribir el sucesor. La perdedora se trata como
   * reutilización y quema la familia.
   */
  const rotated = await db.transaction(async (tx) => {
    const locked = await refreshTokenRepository.lockByHashForUpdate(tx, tokenHash);
    if (!locked || locked.revokedAt || locked.replacedBy) return false;

    await refreshTokenRepository.insert(tx, {
      id: nextId,
      sessionId: session.id,
      familyId: locked.familyId,
      tokenHash: hashRefreshTokenSecret(nextSecret),
      expiresAt,
      // Barrera SQL real: el índice único parcial sobre parent_token_id
      // impide que un mismo predecesor tenga dos sucesores.
      parentTokenId: locked.id,
    });

    const won = await refreshTokenRepository.claimRotation(tx, locked.id, nextId);
    if (!won) throw new RotationLostError();

    await sessionRepository.touch(tx, session.id);
    await auditRepository.insert(tx, {
      id: newId(),
      organizationId: user.organizationId,
      userId: user.id,
      action: "auth.refresh.rotated",
      entity: "session",
      entityId: session.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { familyId: locked.familyId },
    });
    return true;
  }).catch((error: unknown) => {
    if (error instanceof RotationLostError) return false;
    throw error;
  });

  if (!rotated) {
    await burnFamily(deps, record, meta);
    throw unauthorized(
      "Se detectó un uso indebido de la sesión y se cerró por seguridad. Inicia sesión de nuevo.",
      "REFRESH_TOKEN_REUSE",
    );
  }

  const { token, expiresIn } = await signer.sign({
    sub: user.id,
    sid: session.id,
    org: user.organizationId,
    padm: user.isPlatformAdmin,
    roles,
    perms: permissions,
  });

  const { passwordHash: _secret, ...publicUser } = user;
  return {
    accessToken: token,
    expiresIn,
    refreshToken: `${session.id}.${nextSecret}`,
    refreshExpiresAt: expiresAt,
    user: publicUser,
    sessionId: session.id,
    licenseStatus,
  };
}

export async function logout(
  deps: AuthServiceDeps,
  input: { sessionId: string | null; refreshToken: string | null },
  meta: RequestMeta,
): Promise<void> {
  const { db } = deps;
  let sessionId = input.sessionId;

  if (!sessionId && input.refreshToken) {
    const parsed = parseRefreshToken(input.refreshToken);
    if (parsed) {
      const record = await refreshTokenRepository.findByHash(db, hashRefreshTokenSecret(parsed.secret));
      sessionId = record?.sessionId === parsed.sessionId ? record.sessionId : null;
    }
  }

  if (!sessionId) return;

  await db.transaction(async (tx) => {
    await refreshTokenRepository.revokeForSession(tx, sessionId as string, "LOGOUT");
    await sessionRepository.revoke(tx, sessionId as string, "LOGOUT");
    await auditRepository.insert(tx, {
      id: newId(),
      organizationId: null,
      userId: null,
      action: "auth.logout",
      entity: "session",
      entityId: sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {},
    });
  });
}

export async function listSessions(deps: AuthServiceDeps, context: RequestContext): Promise<Session[]> {
  return sessionRepository.listForUser(deps.db, context.userId);
}

export async function revokeSession(
  deps: AuthServiceDeps,
  context: RequestContext,
  sessionId: string,
  meta: RequestMeta,
): Promise<void> {
  const revoked = await deps.db.transaction(async (tx) => {
    const ok = await sessionRepository.revokeForUser(tx, context.userId, sessionId, "USER_REVOKED");
    if (ok) {
      await refreshTokenRepository.revokeForSession(tx, sessionId, "SESSION_REVOKED");
      await auditRepository.insert(tx, {
        id: newId(),
        organizationId: context.organizationId,
        userId: context.userId,
        action: "auth.session.revoked",
        entity: "session",
        entityId: sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {},
      });
    }
    return ok;
  });

  if (!revoked) {
    throw new AppError(404, "SESSION_NOT_FOUND", "La sesión no existe o ya fue cerrada.");
  }
}

/** Alta de usuario. Solo se usa desde el seed de desarrollo y desde Superadmin. */
export async function createUser(
  db: Db,
  input: { organizationId: string | null; email: string; fullName: string; password: string; isPlatformAdmin?: boolean },
): Promise<string> {
  const id = newId();
  await userRepository.insert(db, {
    id,
    organizationId: input.organizationId,
    email: input.email,
    fullName: input.fullName,
    passwordHash: await hashPassword(input.password),
    isPlatformAdmin: input.isPlatformAdmin ?? false,
  });
  return id;
}
