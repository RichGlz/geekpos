import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ApiError, configureAuthHandlers, http, setAccessToken } from "@/lib/http";
import * as authApi from "./auth.api";
import type { AuthUser, LicenseStatus } from "./auth.api";

/**
 * Estado de sesión del cliente.
 *
 * El access token vive SOLO en memoria: si se recarga la pestaña se recupera
 * la sesión con la cookie HttpOnly de refresco. Nada sensible se guarda en
 * localStorage, que es legible por cualquier script de la página.
 *
 * Los permisos que aquí se guardan sirven para la interfaz. La autorización
 * real la impone siempre el servidor en cada endpoint.
 */
export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthUser | null>(null);
  const permissions = ref<string[]>([]);
  const roles = ref<string[]>([]);
  const licenseStatus = ref<LicenseStatus | null>(null);
  const ready = ref(false);
  const pending = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value !== null);
  const isReadOnly = computed(() => licenseStatus.value === "READ_ONLY");
  const licenseWarning = computed(() =>
    licenseStatus.value === "GRACE"
      ? "Tu licencia venció y está en periodo de gracia. Renueva para no perder la operación."
      : licenseStatus.value === "READ_ONLY"
        ? "Licencia en modo solo lectura: puedes consultar información, pero no registrar operaciones."
        : null,
  );

  function can(permission: string): boolean {
    if (user.value?.isPlatformAdmin) return true;
    return permissions.value.includes("*") || permissions.value.includes(permission);
  }

  function apply(response: authApi.AuthResponse): void {
    setAccessToken(response.accessToken);
    user.value = response.user;
    licenseStatus.value = response.licenseStatus;
  }

  function clear(): void {
    setAccessToken(null);
    user.value = null;
    permissions.value = [];
    roles.value = [];
    licenseStatus.value = null;
  }

  async function loadProfile(): Promise<void> {
    const { data } = await http.get<{
      roles: string[];
      permissions: string[];
      licenseStatus: LicenseStatus | null;
    }>("/auth/me");
    roles.value = data.roles;
    permissions.value = data.permissions;
    licenseStatus.value = data.licenseStatus;
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    pending.value = true;
    error.value = null;
    try {
      apply(await authApi.login(email, password));
      await loadProfile();
      return true;
    } catch (caught) {
      clear();
      error.value =
        caught instanceof ApiError ? caught.message : "No fue posible iniciar sesión. Intenta de nuevo.";
      return false;
    } finally {
      pending.value = false;
    }
  }

  async function renew(): Promise<string | null> {
    try {
      const response = await authApi.refresh();
      apply(response);
      return response.accessToken;
    } catch {
      clear();
      return null;
    }
  }

  async function signOut(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  let bootstrapping: Promise<void> | null = null;

  /**
   * Restaura la sesión al abrir o recargar la aplicación.
   *
   * El access token vive en memoria, así que tras una recarga siempre hay que
   * pedir uno nuevo con la cookie HttpOnly de refresco. Es idempotente: varias
   * llamadas concurrentes (arranque + guard de router) comparten la misma
   * promesa para no rotar el refresh token dos veces.
   */
  async function bootstrap(): Promise<void> {
    if (ready.value) return;
    bootstrapping ??= (async () => {
      configureAuthHandlers({ refresh: renew, onSessionLost: clear });
      const token = await renew();
      if (token) {
        try {
          await loadProfile();
        } catch {
          clear();
        }
      }
      ready.value = true;
      bootstrapping = null;
    })();
    return bootstrapping;
  }

  return {
    user,
    roles,
    permissions,
    licenseStatus,
    ready,
    pending,
    error,
    isAuthenticated,
    isReadOnly,
    licenseWarning,
    can,
    signIn,
    signOut,
    bootstrap,
    renew,
  };
});
