/**
 * PRUEBAS DE INTEGRACIÓN CONTRA POSTGRESQL REAL.
 *
 * No usan mocks ni pg-mem: sin `TEST_DATABASE_URL` el archivo se salta entero.
 * La base apuntada debe tener las migraciones aplicadas (`npm run migrate`).
 *
 *   TEST_DATABASE_URL=postgres://... npm test
 *
 * Cubren lo que un build o un typecheck NO pueden demostrar:
 *  - login real con Argon2id y emisión de sesión,
 *  - rotación de refresh con detección de reuso y quema de familia,
 *  - rotación concurrente: nunca quedan dos sucesores válidos,
 *  - aislamiento multiempresa y por sucursal,
 *  - placeholders privados (401 sin sesión, 501 con sesión) y 404 real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import pg from "pg";
import { loadEnv } from "../../config/env.js";
import { createDb, type TransactionalDb } from "../../db/pool.js";
import { newId } from "../../lib/crypto.js";
import * as licenseRepository from "../../repositories/license.repository.js";
import * as organizationRepository from "../../repositories/organization.repository.js";
import * as userRepository from "../../repositories/user.repository.js";
import { buildApp } from "../../http/app.js";
import { PLACEHOLDER_MODULES } from "../../http/routes/placeholder.routes.js";
import { createUser } from "../../services/auth.service.js";

/** Lee el payload de un JWT sin verificarlo: solo se usa para re-firmar variantes. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] as string;
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}


const DATABASE_URL = process.env["TEST_DATABASE_URL"];
const SYSTEM_ROLE_OWNER = "11111111-1111-4111-8111-000000000001";
const SYSTEM_ROLE_CASHIER = "11111111-1111-4111-8111-000000000004";
const PASSWORD = "Prueba-Integracion-1234";
const REFRESH_COOKIE = "gks_rt";
/**
 * IP distinta en cada ejecución: el backoff por IP es persistente en base de
 * datos y, si todas las corridas compartieran 127.0.0.1, la suite se
 * autobloquearía con 429 en la segunda pasada.
 */
const TEST_IP = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

interface Tenant {
  organizationId: string;
  branchAId: string;
  branchBId: string;
  ownerEmail: string;
  cashierEmail: string;
  cashierId: string;
}

function cookieFrom(headers: Record<string, unknown>): string | null {
  const raw = headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  for (const value of values) {
    const match = /gks_rt=([^;]*)/.exec(value);
    if (match && match[1]) return decodeURIComponent(match[1]);
  }
  return null;
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("integración: autenticación y aislamiento multiempresa", () => {
  let pool: pg.Pool;
  let db: TransactionalDb;
  let app: FastifyInstance;
  const created: string[] = [];
  let tenantA: Tenant;
  let tenantB: Tenant;

  async function createTenant(slug: string): Promise<Tenant> {
    const organizationId = newId();
    const branchAId = newId();
    const branchBId = newId();
    await organizationRepository.insert(db, {
      id: organizationId,
      name: `Tenant ${slug}`,
      slug,
      legalName: `Tenant ${slug} S.A.`,
    });
    created.push(organizationId);
    await organizationRepository.insertBranch(db, {
      id: branchAId,
      organizationId,
      code: "SUC-A",
      name: "Sucursal A",
    });
    await organizationRepository.insertBranch(db, {
      id: branchBId,
      organizationId,
      code: "SUC-B",
      name: "Sucursal B",
    });
    await organizationRepository.insertWarehouse(db, {
      id: newId(),
      organizationId,
      branchId: branchAId,
      code: "ALM-A",
      name: "Almacén A",
      isDefault: true,
    });
    await organizationRepository.insertWarehouse(db, {
      id: newId(),
      organizationId,
      branchId: branchBId,
      code: "ALM-B",
      name: "Almacén B",
      isDefault: false,
    });
    await licenseRepository.insert(db, {
      id: newId(),
      organizationId,
      status: "ACTIVE",
      plan: "STANDARD",
    });

    const ownerEmail = `owner.${slug}@test.local`;
    const cashierEmail = `caja.${slug}@test.local`;
    const ownerId = await createUser(db, {
      organizationId,
      email: ownerEmail,
      fullName: "Owner",
      password: PASSWORD,
    });
    const cashierId = await createUser(db, {
      organizationId,
      email: cashierEmail,
      fullName: "Cajero",
      password: PASSWORD,
    });
    await organizationRepository.assignUserToBranch(db, organizationId, ownerId, branchAId);
    await organizationRepository.assignUserToBranch(db, organizationId, ownerId, branchBId);
    // El cajero solo ve la sucursal A.
    await organizationRepository.assignUserToBranch(db, organizationId, cashierId, branchAId);
    await userRepository.assignRole(db, organizationId, ownerId, SYSTEM_ROLE_OWNER);
    await userRepository.assignRole(db, organizationId, cashierId, SYSTEM_ROLE_CASHIER);

    return { organizationId, branchAId, branchBId, ownerEmail, cashierEmail, cashierId };
  }

  async function login(email: string): Promise<{ accessToken: string; refresh: string }> {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
      remoteAddress: TEST_IP,
    });
    expect(response.statusCode).toBe(200);
    const refresh = cookieFrom(response.headers as Record<string, unknown>);
    expect(refresh).toBeTruthy();
    return { accessToken: response.json().accessToken as string, refresh: refresh as string };
  }

  beforeAll(async () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL,
      DATABASE_SSL: process.env["TEST_DATABASE_SSL"] ?? "false",
      JWT_SECRET: "clave-de-pruebas-de-integracion-muy-larga-1234",
      COOKIE_SECURE: "false",
      LOG_LEVEL: "error",
    });
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
      max: 8,
    });
    db = createDb(pool);
    app = await buildApp({ env, db });
    await app.ready();

    const suffix = Date.now().toString(36);
    tenantA = await createTenant(`itest-a-${suffix}`);
    tenantB = await createTenant(`itest-b-${suffix}`);
  }, 60_000);

  afterAll(async () => {
    for (const organizationId of created) {
      await organizationRepository.deleteById(db, organizationId);
    }
    await app?.close();
    await pool?.end();
  });

  it("GET / y GET /health responden con la base real arriba", async () => {
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.json().name).toBe("geeksium-pos-api");

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().database).toBe("up");
  });

  it("rechaza credenciales inválidas sin filtrar si el correo existe", async () => {
    const unknownUser = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: `nadie.${TEST_IP.replace(/\./g, "-")}@test.local`, password: PASSWORD },
      remoteAddress: TEST_IP,
    });
    const badPassword = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: tenantA.ownerEmail, password: "Contrasena-Incorrecta-1" },
      remoteAddress: TEST_IP,
    });
    expect(unknownUser.statusCode).toBe(401);
    expect(badPassword.statusCode).toBe(401);
    expect(unknownUser.json().error.message).toBe(badPassword.json().error.message);
  });

  it("login real emite access token utilizable en /auth/me", async () => {
    const { accessToken } = await login(tenantA.ownerEmail);
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().organizationId).toBe(tenantA.organizationId);
    // El comodín '*' del rol OWNER se resuelve como permiso efectivo.
    expect(me.json().permissions).toContain("*");
  });

  it("sin token o con token manipulado responde 401", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    const { accessToken } = await login(tenantA.ownerEmail);
    const tampered = `${accessToken.slice(0, -3)}abc`;
    const forged = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${tampered}` },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(forged.statusCode).toBe(401);
  });

  it("rota el refresh e invalida el token anterior (detección de reuso)", async () => {
    const { refresh } = await login(tenantA.ownerEmail);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(first.statusCode).toBe(200);
    const rotated = cookieFrom(first.headers as Record<string, unknown>) as string;
    expect(rotated).not.toBe(refresh);

    // Reuso del token viejo: se rechaza y quema la familia completa.
    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(reuse.statusCode).toBe(401);

    const afterBurn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: rotated },
    });
    expect(afterBurn.statusCode).toBe(401);
  });

  it("rotación concurrente: exactamente un sucesor válido", async () => {
    const { refresh } = await login(tenantA.ownerEmail);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: "POST",
          url: "/api/v1/auth/refresh",
          cookies: { [REFRESH_COOKIE]: refresh },
        }),
      ),
    );
    const winners = results.filter((r) => r.statusCode === 200);
    expect(winners.length).toBe(1);
    for (const loser of results.filter((r) => r.statusCode !== 200)) {
      expect(loser.statusCode).toBe(401);
    }
  });

  it("no prolonga la sesión más allá de su vencimiento absoluto", async () => {
    const { refresh } = await login(tenantA.ownerEmail);
    const sessionId = refresh.split(".")[0] as string;
    await db.query("UPDATE sessions SET created_at = now() - interval '31 days' WHERE id = $1", [sessionId]);
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/refresh", cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SESSION_EXPIRED");
  });

  it("logout invalida el refresh emitido", async () => {
    const { refresh } = await login(tenantA.cashierEmail);
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(logout.statusCode).toBe(200);
    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it("cada tenant solo ve sus propias sucursales y almacenes", async () => {
    const a = await login(tenantA.ownerEmail);
    const b = await login(tenantB.ownerEmail);

    const branchesA = await app.inject({
      method: "GET",
      url: "/api/v1/organization/branches",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    const branchesB = await app.inject({
      method: "GET",
      url: "/api/v1/organization/branches",
      headers: { authorization: `Bearer ${b.accessToken}` },
    });
    const idsA = (branchesA.json().branches as { id: string }[]).map((x) => x.id);
    const idsB = (branchesB.json().branches as { id: string }[]).map((x) => x.id);
    expect(idsA.sort()).toEqual([tenantA.branchAId, tenantA.branchBId].sort());
    expect(idsB).not.toContain(tenantA.branchAId);
    expect(idsA).not.toContain(tenantB.branchAId);
  });

  it("el aislamiento por sucursal se aplica dentro del mismo tenant", async () => {
    const cashier = await login(tenantA.cashierEmail);
    const branches = await app.inject({
      method: "GET",
      url: "/api/v1/organization/branches",
      headers: { authorization: `Bearer ${cashier.accessToken}` },
    });
    const ids = (branches.json().branches as { id: string }[]).map((x) => x.id);
    expect(ids).toEqual([tenantA.branchAId]);

    const warehouses = await app.inject({
      method: "GET",
      url: "/api/v1/organization/warehouses",
      headers: { authorization: `Bearer ${cashier.accessToken}` },
    });
    const codes = (warehouses.json().warehouses as { code: string }[]).map((x) => x.code);
    expect(codes).toEqual(["ALM-A"]);
  });

  it("no se puede leer un usuario de otra organización", async () => {
    const a = await login(tenantA.ownerEmail);
    const foreign = await app.inject({
      method: "GET",
      url: `/api/v1/organization/users/${tenantB.cashierId}`,
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect([403, 404]).toContain(foreign.statusCode);
  });

  it("los placeholders son privados: 401 sin sesión, 501 con sesión, 404 si no existen", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/sales" });
    expect(anonymous.statusCode).toBe(401);

    const { accessToken } = await login(tenantA.ownerEmail);
    const authenticated = await app.inject({
      method: "GET",
      url: "/api/v1/sales",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(authenticated.statusCode).toBe(501);
    expect(authenticated.json().error.code).toBe("NOT_IMPLEMENTED");

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/ruta-que-no-existe",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("el comodín de permisos abre una ruta protegida real y su ausencia la cierra", async () => {
    const owner = await login(tenantA.ownerEmail);
    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/organization/users",
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(allowed.statusCode).toBe(200);
    expect(Array.isArray(allowed.json().users)).toBe(true);

    const cashier = await login(tenantA.cashierEmail);
    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/organization/users",
      headers: { authorization: `Bearer ${cashier.accessToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("un usuario desactivado pierde el acceso aunque su token siga vigente", async () => {
    const organizationId = tenantB.organizationId;
    const email = `baja.${Date.now().toString(36)}@test.local`;
    const userId = await createUser(db, {
      organizationId,
      email,
      fullName: "Usuario de baja",
      password: PASSWORD,
    });
    await userRepository.assignRole(db, organizationId, userId, SYSTEM_ROLE_CASHIER);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
      remoteAddress: TEST_IP,
    });
    expect(response.statusCode).toBe(200);
    const token = response.json().accessToken as string;

    await db.query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);

    const after = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("SESSION_REVOKED");
  });

  it("la cookie de refresco es HttpOnly, con Path acotado y SameSite declarado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: tenantA.ownerEmail, password: PASSWORD },
      remoteAddress: TEST_IP,
    });
    const raw = response.headers["set-cookie"];
    const cookie = Array.isArray(raw) ? (raw.find((c) => c.includes(REFRESH_COOKIE)) ?? "") : String(raw);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/v1/auth");
    expect(cookie.toLowerCase()).toContain("samesite");
    // El cuerpo nunca devuelve el refresh: solo el access token.
    expect(JSON.stringify(response.json())).not.toContain(
      (cookieFrom(response.headers as Record<string, unknown>) as string).split(".")[1] as string,
    );

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { [REFRESH_COOKIE]: cookieFrom(response.headers as Record<string, unknown>) as string },
    });
    const cleared = String(logout.headers["set-cookie"]);
    expect(cleared).toContain(`${REFRESH_COOKIE}=`);
    expect(cleared).toContain("Path=/api/v1/auth");
  });

  it("rechaza tokens con issuer, audience o expiración inválidos", async () => {
    const secret = new TextEncoder().encode("clave-de-pruebas-de-integracion-muy-larga-1234");
    const owner = await login(tenantA.ownerEmail);
    const claims = decodeJwtPayload(owner.accessToken);

    async function mint(overrides: {
      issuer: string;
      audience: string;
      expiration: string | number;
    }): Promise<string> {
      return new SignJWT({
        sid: claims["sid"],
        org: claims["org"],
        padm: claims["padm"],
        roles: claims["roles"],
        perms: claims["perms"],
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(String(claims["sub"]))
        .setIssuer(overrides.issuer)
        .setAudience(overrides.audience)
        .setIssuedAt()
        .setExpirationTime(overrides.expiration)
        .sign(secret);
    }

    const wrongIssuer = await mint({
      issuer: "otro-emisor",
      audience: "geeksium-pos-web",
      expiration: "5m",
    });
    const wrongAudience = await mint({
      issuer: "geeksium-pos-api",
      audience: "otra-audiencia",
      expiration: "5m",
    });
    const expired = await mint({
      issuer: "geeksium-pos-api",
      audience: "geeksium-pos-web",
      expiration: Math.floor(Date.now() / 1000) - 60,
    });

    for (const token of [wrongIssuer, wrongAudience, expired]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    }

    // Un token válido pero con el claim `org` manipulado tampoco pasa.
    const tamperedOrg = await new SignJWT({
      sid: claims["sid"],
      org: tenantB.organizationId,
      padm: claims["padm"],
      roles: claims["roles"],
      perms: claims["perms"],
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(String(claims["sub"]))
      .setIssuer("geeksium-pos-api")
      .setAudience("geeksium-pos-web")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);
    const crossTenant = await app.inject({
      method: "GET",
      url: "/api/v1/organization/branches",
      headers: { authorization: `Bearer ${tamperedOrg}` },
    });
    expect(crossTenant.statusCode).toBe(401);
  });

  it("todos los módulos placeholder responden 401 sin sesión y 501 con sesión", async () => {
    const { accessToken } = await login(tenantA.ownerEmail);
    for (const moduleName of PLACEHOLDER_MODULES) {
      const anonymous = await app.inject({ method: "GET", url: `/api/v1/${moduleName}` });
      expect(anonymous.statusCode, moduleName).toBe(401);

      const authenticated = await app.inject({
        method: "GET",
        url: `/api/v1/${moduleName}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(authenticated.statusCode, moduleName).toBe(501);
      expect(authenticated.json().error.code, moduleName).toBe("NOT_IMPLEMENTED");
    }
  });

  it("el refresh exige el formato estricto sessionId.secret", async () => {
    const { refresh } = await login(tenantA.ownerEmail);
    const [sessionId, secret] = refresh.split(".") as [string, string];

    // Formatos que ni siquiera llegan a consultar la base: se rechazan al parsear.
    const malformed = [
      "",
      "sin-separador",
      `${sessionId}.`,
      `.${secret}`,
      `no-es-uuid.${secret}`,
      `${sessionId}.${secret}.extra`,
    ];
    for (const value of malformed) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        cookies: { [REFRESH_COOKIE]: value },
      });
      expect(response.statusCode, value || "(vacío)").toBe(401);
    }

    // Un formato inválido no invalida la sesión legítima.
    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: refresh },
    });
    expect(ok.statusCode).toBe(200);

    // El prefijo debe coincidir con la sesión del secreto: si no, es
    // manipulación y se quema la familia entera.
    const rotated = cookieFrom(ok.headers as Record<string, unknown>) as string;
    const rotatedSecret = rotated.split(".")[1] as string;
    const mismatched = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: `${newId()}.${rotatedSecret}` },
    });
    expect(mismatched.statusCode).toBe(401);

    const afterBurn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { [REFRESH_COOKIE]: rotated },
    });
    expect(afterBurn.statusCode).toBe(401);
  });

  it("PostgreSQL rechaza organization_id NULL en sesiones y roles de un usuario tenant", async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE organization_id = $1 LIMIT 1`,
      [tenantA.organizationId],
    );
    const userId = (rows[0] as { id: string }).id;

    await expect(
      db.query(`INSERT INTO sessions (id, organization_id, user_id) VALUES ($1, NULL, $2)`, [
        newId(),
        userId,
      ]),
    ).rejects.toThrow(/aislamiento multiempresa/i);

    // Se elige un rol que este usuario todavía NO tenga, para que el rechazo
    // provenga del guardián de tenant y no de la clave primaria.
    const { rows: freeRoles } = await db.query<{ id: string }>(
      `SELECT r.id FROM roles r
        WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.role_id = r.id AND ur.user_id = $1)
        LIMIT 1`,
      [userId],
    );
    const freeRoleId = (freeRoles[0] as { id: string }).id;

    await expect(
      db.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id) VALUES ($1, $2, NULL)`,
        [userId, freeRoleId],
      ),
    ).rejects.toThrow(/aislamiento multiempresa/i);


    // Y tampoco acepta la organización de otro tenant.
    await expect(
      db.query(`INSERT INTO sessions (id, organization_id, user_id) VALUES ($1, $2, $3)`, [
        newId(),
        tenantB.organizationId,
        userId,
      ]),
    ).rejects.toThrow();
  });


  it("un mismo refresh token no puede tener dos hijos: lo impide un índice único", async () => {
    const { rows } = await db.query<{ id: string; session_id: string; family_id: string }>(
      `SELECT id, session_id, family_id FROM refresh_tokens
        WHERE parent_token_id IS NOT NULL LIMIT 1`,
    );
    const child = rows[0];
    if (!child) return; // ninguna rotación previa en esta corrida

    const { rows: parentRows } = await db.query<{ parent_token_id: string }>(
      `SELECT parent_token_id FROM refresh_tokens WHERE id = $1`,
      [child.id],
    );
    const parentId = (parentRows[0] as { parent_token_id: string }).parent_token_id;

    await expect(
      db.query(
        `INSERT INTO refresh_tokens (id, session_id, family_id, token_hash, expires_at, parent_token_id)
         VALUES ($1, $2, $3, $4, now() + interval '1 day', $5)`,
        [newId(), child.session_id, child.family_id, newId(), parentId],
      ),
    ).rejects.toThrow(/refresh_tokens_parent_unique_idx|duplicate key/i);
  });

  it("/health responde 503 cuando la base no está disponible", async () => {
    const brokenEnv = loadEnv({
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: "postgres://nadie:nadie@127.0.0.1:1/no-existe",
      DATABASE_SSL: "false",
      JWT_SECRET: "clave-de-pruebas-de-integracion-muy-larga-1234",
      COOKIE_SECURE: "false",
      LOG_LEVEL: "error",
    });
    const brokenPool = new pg.Pool({
      connectionString: brokenEnv.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 1_000,
    });
    brokenPool.on("error", () => {});
    const brokenApp = await buildApp({ env: brokenEnv, db: createDb(brokenPool) });
    await brokenApp.ready();
    try {
      const health = await brokenApp.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(503);
      expect(health.json().database).toBe("down");
    } finally {
      await brokenApp.close();
      await brokenPool.end().catch(() => {});
    }
  }, 20_000);

  it("un fallo inesperado devuelve 500 genérico y no filtra el stack", async () => {
    const env = loadEnv({
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL,
      DATABASE_SSL: process.env["TEST_DATABASE_SSL"] ?? "false",
      JWT_SECRET: "clave-de-pruebas-de-integracion-muy-larga-1234",
      COOKIE_SECURE: "true",
      LOG_LEVEL: "error",
    });
    const prodApp = await buildApp({ env, db });
    prodApp.get("/api/v1/__boom", async () => {
      throw new Error("detalle interno que no debe salir: SELECT secreto FROM users");
    });
    await prodApp.ready();
    try {
      const response = await prodApp.inject({ method: "GET", url: "/api/v1/__boom" });
      expect(response.statusCode).toBe(500);
      const body = response.body;
      expect(body).not.toContain("detalle interno");
      expect(body).not.toContain("at ");
      expect(response.json().error.code).toBe("INTERNAL_ERROR");
    } finally {
      await prodApp.close();
    }
  });
});
