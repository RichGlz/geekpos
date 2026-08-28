/**
 * Formato del refresh token presentado por el cliente: `sessionId.secret`.
 *
 * Se valida de forma ESTRICTA antes de tocar la base de datos:
 *   - un único separador ".",
 *   - prefijo = UUID válido (el id de sesión),
 *   - secreto no vacío.
 *
 * Un valor mal formado no llega nunca al repositorio: se rechaza con el mismo
 * 401 genérico que un token inexistente, sin dar pistas al atacante.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

export function parseRefreshToken(presented: string | null | undefined): ParsedRefreshToken | null {
  if (typeof presented !== "string") return null;
  const value = presented.trim();
  if (value.length === 0) return null;

  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [sessionId, secret] = parts as [string, string];
  if (!UUID_RE.test(sessionId)) return null;
  if (secret.length === 0) return null;

  return { sessionId, secret };
}
