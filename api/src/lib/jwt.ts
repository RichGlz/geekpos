import { SignJWT, jwtVerify } from "jose";
import { unauthorized } from "./errors.js";

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  /** organization_id resuelto en servidor; nunca proviene del cliente. */
  org: string | null;
  padm: boolean;
  roles: string[];
  perms: string[];
}

const ISSUER = "geeksium-pos-api";
const AUDIENCE = "geeksium-pos-web";

export function createTokenSigner(secret: string, ttlSeconds: number) {
  const key = new TextEncoder().encode(secret);

  return {
    async sign(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
      const token = await new SignJWT({
        sid: claims.sid,
        org: claims.org,
        padm: claims.padm,
        roles: claims.roles,
        perms: claims.perms,
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(claims.sub)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key);
      return { token, expiresIn: ttlSeconds };
    },

    async verify(token: string): Promise<AccessTokenClaims> {
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: ISSUER,
          audience: AUDIENCE,
          algorithms: ["HS256"],
        });
        return {
          sub: String(payload.sub),
          sid: String(payload["sid"]),
          org: (payload["org"] as string | null) ?? null,
          padm: Boolean(payload["padm"]),
          roles: (payload["roles"] as string[] | undefined) ?? [],
          perms: (payload["perms"] as string[] | undefined) ?? [],
        };
      } catch {
        throw unauthorized("Sesión inválida o expirada.", "INVALID_ACCESS_TOKEN");
      }
    },
  };
}

export type TokenSigner = ReturnType<typeof createTokenSigner>;
