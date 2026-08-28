/**
 * Pruebas de los guards de navegación.
 *
 * Recordatorio honesto: estos guards son solo experiencia de usuario. La
 * autorización real la impone el servidor en cada endpoint; aquí solo se
 * comprueba que nadie vea pantallas privadas vacías ni un login inútil.
 */
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ login: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock("@/modules/auth/auth.api", () => api);

const httpMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/http", () => ({
  http: httpMock,
  ApiError: class ApiError extends Error {},
  setAccessToken: vi.fn(),
  getAccessToken: () => null,
  configureAuthHandlers: vi.fn(),
}));

const { router } = await import("../index");
const { useAuthStore } = await import("@/modules/auth/auth.store");

const SESSION = {
  accessToken: "tok",
  expiresIn: 900,
  user: {
    id: "u1",
    organizationId: "org1",
    email: "owner@test.local",
    fullName: "Owner",
    isActive: true,
    isPlatformAdmin: false,
  },
  licenseStatus: "ACTIVE" as const,
};

describe("guards del router", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Por defecto no hay cookie de refresco válida: invitado.
    api.refresh.mockRejectedValue(new Error("401"));
    httpMock.get.mockResolvedValue({
      data: { roles: ["OWNER"], permissions: ["*"], licenseStatus: "ACTIVE" },
    });
    await router.replace("/");
    await router.isReady();
  });

  async function signInAsOwner(): Promise<void> {
    api.login.mockResolvedValue(SESSION);
    const ok = await useAuthStore().signIn("owner@test.local", "secreto");
    expect(ok).toBe(true);
  }

  it("un invitado que entra a una ruta privada acaba en el login con redirect", async () => {
    await router.push("/app/sesiones");
    expect(router.currentRoute.value.name).toBe("login");
    expect(router.currentRoute.value.query["redirect"]).toBe("/app/sesiones");
  });

  it("un usuario autenticado entra a la ruta privada", async () => {
    await signInAsOwner();
    await router.push("/app/sesiones");
    expect(router.currentRoute.value.name).toBe("sessions");
  });

  it("un usuario autenticado no vuelve al login", async () => {
    await signInAsOwner();
    await router.push("/login");
    expect(router.currentRoute.value.name).toBe("dashboard");
  });

  it("las rutas públicas siguen siendo accesibles sin sesión", async () => {
    await router.push("/");
    expect(router.currentRoute.value.name).toBe("landing");
  });
});

