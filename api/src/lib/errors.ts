/**
 * Contrato de error uniforme para toda la API:
 *   { error: { code, message, details?, requestId } }
 *
 * En producción jamás se filtran stack traces ni mensajes internos:
 * los 5xx se degradan a un mensaje genérico y el detalle queda en el log.
 */
export type ErrorDetails = unknown;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: ErrorDetails | undefined;
  /** true = el mensaje es seguro para mostrar al cliente. */
  public readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { details?: ErrorDetails; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

export const badRequest = (message: string, details?: ErrorDetails) =>
  new AppError(400, "BAD_REQUEST", message, { details });

export const unauthorized = (message = "Credenciales inválidas.", code = "UNAUTHORIZED") =>
  new AppError(401, code, message);

export const forbidden = (message = "No tienes permiso para realizar esta acción.", code = "FORBIDDEN") =>
  new AppError(403, code, message);

export const notFound = (message = "Recurso no encontrado.") => new AppError(404, "NOT_FOUND", message);

export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);

export const tooManyRequests = (message: string, details?: ErrorDetails) =>
  new AppError(429, "TOO_MANY_REQUESTS", message, { details });

/**
 * 501 esperado y seguro de mostrar: los módulos de negocio todavía no existen.
 * `expose: true` evita degradarlo al mensaje genérico de los 5xx reales.
 */
export const notImplemented = (module: string) =>
  new AppError(
    501,
    "NOT_IMPLEMENTED",
    `El módulo "${module}" aún no está implementado en esta fase de V1.`,
    { expose: true },
  );
