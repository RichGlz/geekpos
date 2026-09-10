import type { FastifyInstance } from "fastify";
import { notImplemented } from "../../lib/errors.js";
import { getContext } from "../context.js";

/**
 * Módulos de negocio aún no implementados.
 *
 * Son rutas PRIVADAS a propósito:
 *   - sin sesión válida            -> 401 (lo resuelve el preHandler authenticate)
 *   - con sesión válida            -> 501 NOT_IMPLEMENTED
 *   - ruta realmente inexistente   -> 404
 *
 * Así el mapa de módulos futuros no queda expuesto a anónimos.
 */
export const PLACEHOLDER_MODULES = [
  "inventory",
  "sales",
  "purchases",
  "transfers",
  "reports",
  "platform",
] as const;

export async function placeholderRoutes(
  app: FastifyInstance,
  options: { authenticate: FastifyInstance["authenticate"] },
): Promise<void> {
  app.addHook("preHandler", options.authenticate);

  for (const moduleName of PLACEHOLDER_MODULES) {
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      url: `/${moduleName}`,
      handler: (request) => {
        getContext(request);
        throw notImplemented(moduleName);
      },
    });
  }
}
