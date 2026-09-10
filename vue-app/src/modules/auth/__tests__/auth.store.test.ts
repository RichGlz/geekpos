/**
 * Pruebas del store de sesión.
 *
 * Comprueban lo que el usuario nota: que iniciar sesión deja la app usable,
 * que el comodín de permisos funciona, que el token no se guarda en
 * localStorage y que un fallo de refresco cierra la sesión limpia.
 */
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthResponse } from "../auth.api";

const api = vi.hoisted(() => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../auth.api", () => api);

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
let currentToken: string | null = null;
vi.mock("@/lib/http", () => ({
  http: httpMock,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  setAccessToken: (token: string | null) => {
    currentToken = token;
  },
  getAccessToken: () => currentToken,
  configureAuthHandlers: vi.fn(),
}));

const { useAuthStore } = await import("../auth.store");

const AUTH_RESPONSE: AuthResponse = {
  accessToken: "token-de-acceso",
  expiresIn: 900,
  user: {
    id: "u1",
    organizationId: "org1",
    email: "owner@test.local",
    fullName: "Owner",
    isActive: true,
    isPlatformAdmin: false,
  },
  licenseStatus: "ACTIVE",
};

function profile(permissions: string[]) {
  return { data: { roles: ["OWNER"], permissions, licenseStatus: "ACTIVE" } };
}

describe("auth.store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    currentToken = null;
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("inicia sesión, carga perfil y no escribe el token en localStorage", async () => {
    api.login.mockResolvedValue(AUTH_RESPONSE);
    httpMock.get.mockResolvedValue(profile(["sales.create"]));

    const auth = useAuthStore();
    const ok = await auth.signIn("owner@test.local", "secreto");

    expect(ok).toBe(true);
    expect(auth.isAuthenticated).toBe(true);
    expect(currentToken).toBe("token-de-acceso");
    expect(JSON.stringify(localStorage)).not.toContain("token-de-acceso");
    expect(localStorage.length).toBe(0);
  });

  it("credenciales inválidas dejan el store limpio y con mensaje", async () => {
    api.login.mockRejectedValue(new Error("boom"));
    const auth = useAuthStore();
    const ok = await auth.signIn("owner@test.local", "mala");

    expect(ok).toBe(false);
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.error).toBeTruthy();
    expect(currentToken).toBeNull();
  });

  it("el comodín '*' concede cualquier permiso; sin él solo el exacto", async () => {
    api.login.mockResolvedValue(AUTH_RESPONSE);
    httpMock.get.mockResolvedValue(profile(["*"]));
    const auth = useAuthStore();
    await auth.signIn("owner@test.local", "secreto");

    expect(auth.can("sales.create")).toBe(true);
    expect(auth.can("cualquier.cosa")).toBe(true);

    httpMock.get.mockResolvedValue(profile(["sales.create"]));
    api.refresh.mockResolvedValue(AUTH_RESPONSE);
    await auth.renew();
    await auth.signIn("owner@test.local", "secreto");
    expect(auth.can("sales.create")).toBe(true);
    expect(auth.can("sales.void")).toBe(false);
    // `users.*` no es comodín: solo el literal '*' lo es.
    httpMock.get.mockResolvedValue(profile(["users.*"]));
    await auth.signIn("owner@test.local", "secreto");
    expect(auth.can("users.read")).toBe(false);
  });

  it("el administrador de plataforma puede todo", async () => {
    api.login.mockResolvedValue({
      ...AUTH_RESPONSE,
      user: { ...AUTH_RESPONSE.user, isPlatformAdmin: true },
    });
    httpMock.get.mockResolvedValue(profile([]));
    const auth = useAuthStore();
    await auth.signIn("admin@test.local", "secreto");
    expect(auth.can("lo.que.sea")).toBe(true);
  });

  it("bootstrap es idempotente: varias llamadas concurrentes refrescan una vez", async () => {
    api.refresh.mockResolvedValue(AUTH_RESPONSE);
    httpMock.get.mockResolvedValue(profile(["*"]));
    const auth = useAuthStore();

    await Promise.all([auth.bootstrap(), auth.bootstrap(), auth.bootstrap()]);

    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(auth.ready).toBe(true);
    expect(auth.isAuthenticated).toBe(true);
  });

  it("si el refresco falla, la sesión queda cerrada pero la app arranca", async () => {
    api.refresh.mockRejectedValue(new Error("401"));
    const auth = useAuthStore();
    await auth.bootstrap();

    expect(auth.ready).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
    expect(currentToken).toBeNull();
    expect(auth.sessionExpired).toBe(true);
  });

  it("renueva silenciosamente un access token próximo a expirar", async () => {
    api.login.mockResolvedValue({ ...AUTH_RESPONSE, expiresIn: 30 });
    api.refresh.mockResolvedValue({ ...AUTH_RESPONSE, accessToken: "token-renovado" });
    httpMock.get.mockResolvedValue(profile(["*"]));
    const auth = useAuthStore();
    await auth.signIn("owner@test.local", "secreto");

    expect(await auth.ensureFreshSession()).toBe(true);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(currentToken).toBe("token-renovado");
    expect(auth.sessionExpired).toBe(false);
  });

  it("cerrar sesión limpia usuario, permisos y token en memoria", async () => {
    api.login.mockResolvedValue(AUTH_RESPONSE);
    httpMock.get.mockResolvedValue(profile(["*"]));
    api.logout.mockResolvedValue(undefined);
    const auth = useAuthStore();
    await auth.signIn("owner@test.local", "secreto");

    await auth.signOut();

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.permissions).toEqual([]);
    expect(currentToken).toBeNull();
  });
});
