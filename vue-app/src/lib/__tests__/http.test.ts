/**
 * Pruebas del cliente HTTP.
 *
 * Cubren el comportamiento crítico del interceptor: ante un 401 se renueva la
 * sesión UNA sola vez, se reintenta la petición y, si el refresco falla, se
 * avisa de la pérdida de sesión en lugar de dejar la app en un limbo.
 */
import type { AxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureAuthHandlers, http, setAccessToken } from "../http";

interface Recorded {
  url: string;
  authorization: string | undefined;
}

const calls: Recorded[] = [];
let failFirstWith401 = new Set<string>();

function installAdapter(): void {
  http.defaults.adapter = async (config: AxiosRequestConfig) => {
    const url = config.url ?? "";
    const headers = config.headers as unknown as { get?: (k: string) => unknown };
    const authorization = headers?.get ? (headers.get("Authorization") as string | undefined) : undefined;
    calls.push({ url, authorization: authorization ?? undefined });

    if (failFirstWith401.has(url)) {
      failFirstWith401.delete(url);
      const error = new Error("401") as Error & { response?: unknown; config?: unknown };
      error.config = config;
      error.response = {
        status: 401,
        data: { error: { code: "AUTH_REQUIRED", message: "Necesitas iniciar sesión." } },
        headers: {},
        config,
      };
      throw error;
    }
    return {
      data: { ok: true },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as never;
  };
}

describe("cliente HTTP", () => {
  beforeEach(() => {
    calls.length = 0;
    failFirstWith401 = new Set();
    setAccessToken(null);
    installAdapter();
  });

  it("adjunta el access token en memoria", async () => {
    setAccessToken("tok-1");
    configureAuthHandlers({ refresh: async () => "tok-1", onSessionLost: () => {} });
    await http.get("/organization/me");
    expect(calls[0]?.authorization).toBe("Bearer tok-1");
  });

  it("ante un 401 renueva y reintenta la petición original", async () => {
    setAccessToken("viejo");
    failFirstWith401.add("/organization/me");
    const refresh = vi.fn(async () => {
      setAccessToken("nuevo");
      return "nuevo";
    });
    configureAuthHandlers({ refresh, onSessionLost: () => {} });

    const { data } = await http.get<{ ok: boolean }>("/organization/me");

    expect(data.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.map((c) => c.authorization)).toEqual(["Bearer viejo", "Bearer nuevo"]);
  });

  it("dos 401 concurrentes comparten un único refresco", async () => {
    setAccessToken("viejo");
    failFirstWith401.add("/a");
    failFirstWith401.add("/b");
    let resolveRefresh: ((token: string) => void) | null = null;
    const refresh = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRefresh = (token) => {
            setAccessToken(token);
            resolve(token);
          };
        }),
    );
    configureAuthHandlers({ refresh, onSessionLost: () => {} });

    const pending = Promise.all([http.get("/a"), http.get("/b")]);
    await new Promise((r) => setTimeout(r, 10));
    (resolveRefresh as unknown as (t: string) => void)("nuevo");
    const [a, b] = await pending;

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si el refresco falla, avisa de sesión perdida y propaga un ApiError", async () => {
    setAccessToken("viejo");
    failFirstWith401.add("/organization/me");
    const onSessionLost = vi.fn();
    configureAuthHandlers({ refresh: async () => null, onSessionLost });

    await expect(http.get("/organization/me")).rejects.toBeInstanceOf(ApiError);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it("no intenta renovar en las propias llamadas de autenticación", async () => {
    failFirstWith401.add("/auth/refresh");
    const refresh = vi.fn(async () => "nuevo");
    configureAuthHandlers({ refresh, onSessionLost: () => {} });

    await expect(http.post("/auth/refresh")).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });
});
