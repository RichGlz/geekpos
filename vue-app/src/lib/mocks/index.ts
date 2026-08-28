/**
 * Capa de datos simulados. AISLADA A PROPÓSITO.
 *
 * Reglas:
 *  - Solo se activa con `import.meta.env.DEV` y `VITE_USE_MOCKS=true`.
 *  - Ningún módulo de producción la importa de forma estática: `main.ts` la
 *    carga con `import()` dinámico y solo si el modo está activo, así el
 *    bundle de producción no la contiene.
 *  - Sirve exclusivamente para revisar la interfaz sin API levantada. No
 *    sustituye a ninguna prueba ni demuestra que el backend funcione.
 */
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

export const mocksEnabled: boolean =
  import.meta.env.DEV && import.meta.env["VITE_USE_MOCKS"] === "true";

const MOCK_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-0000000000aa",
  email: "demo@geeksium.local",
  fullName: "Usuario de demostración",
  isActive: true,
  isPlatformAdmin: false,
};

const MOCK_AUTH = {
  accessToken: "mock.access.token",
  expiresIn: 900,
  user: MOCK_USER,
  licenseStatus: "ACTIVE" as const,
};

function reply<T>(config: AxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: "OK",
    headers: {},
    config: config as AxiosResponse<T>["config"],
  };
}

/** Tabla de rutas simuladas. Cualquier ruta no listada devuelve 501. */
function resolve(url: string, method: string): unknown | undefined {
  const path = url.replace(/^.*\/api\/v1/, "").split("?")[0] ?? "";
  if (method === "POST" && path === "/auth/login") return MOCK_AUTH;
  if (method === "POST" && path === "/auth/refresh") return MOCK_AUTH;
  if (method === "POST" && path === "/auth/logout") return {};
  if (method === "GET" && path === "/auth/me") {
    return { ...MOCK_USER, roles: ["OWNER"], permissions: ["*"], licenseStatus: "ACTIVE" };
  }
  if (method === "GET" && path === "/auth/sessions") return { sessions: [] };
  if (method === "GET" && path === "/organization/branches") {
    return { branches: [{ id: "b1", code: "SUC-A", name: "Sucursal demo" }] };
  }
  return undefined;
}

export function installMocks(client: AxiosInstance): void {
  client.defaults.adapter = async (config) => {
    const method = (config.method ?? "get").toUpperCase();
    const url = `${config.baseURL ?? ""}${config.url ?? ""}`;
    const data = resolve(url, method);
    if (data === undefined) {
      return reply(
        config,
        { error: { code: "NOT_IMPLEMENTED", message: "Ruta no simulada en MODO MOCK." } },
        501,
      );
    }
    // Latencia mínima para que la interfaz muestre sus estados de carga.
    await new Promise((resolve_) => setTimeout(resolve_, 120));
    return reply(config, data);
  };
}
