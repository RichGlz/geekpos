import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ApiError, configureAuthHandlers, getAccessToken, http, setAccessToken } from "@/lib/http";
import * as authApi from "./auth.api";
import type { AuthUser, LicenseStatus } from "./auth.api";
import { deleteMeta, getMeta, setMeta } from "@/lib/offline/idb";
import { accountScope } from "@/lib/offline/catalogDb";
import { licenseState, type OfflineLicense } from "@/lib/offline/license";

interface OfflineProfile {
  user: AuthUser; roles: string[]; permissions: string[]; licenseStatus: LicenseStatus | null;
}

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
  const offlineSession = ref(false);
  const accessExpiresAt = ref<number | null>(null);
  const sessionExpired = ref(false);

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
    accessExpiresAt.value = Date.now() + response.expiresIn * 1_000;
    user.value = response.user;
    licenseStatus.value = response.licenseStatus;
    offlineSession.value = false;
    sessionExpired.value = false;
  }

  function clear(expired = false): void {
    setAccessToken(null);
    accessExpiresAt.value = null;
    user.value = null;
    permissions.value = [];
    roles.value = [];
    licenseStatus.value = null;
    offlineSession.value = false;
    sessionExpired.value = expired;
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
    await persistProfile();
  }
  async function persistProfile(): Promise<void> {
    if (user.value?.organizationId) {
      const snapshot: OfflineProfile = { user: user.value, roles: roles.value, permissions: permissions.value, licenseStatus: licenseStatus.value };
      await setMeta("offline-profile", snapshot).catch(() => undefined);
    }
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    pending.value = true;
    error.value = null;
    try {
      apply(await authApi.login(email, password));
      await loadProfile();
      await deleteMeta("explicit-signout").catch(() => undefined);
      return true;
    } catch (caught) {
      clear();
      await deleteMeta("offline-profile").catch(() => undefined);
      error.value =
        caught instanceof ApiError ? caught.message : "No fue posible iniciar sesión. Intenta de nuevo.";
      return false;
    } finally {
      pending.value = false;
    }
  }

  let renewing: Promise<string | null> | null = null;
  async function renew(): Promise<string | null> {
    const perform = async () => {
      try {
        const response = await authApi.refresh();
        apply(response);
        return response.accessToken;
      } catch (caught) {
        if (caught instanceof ApiError && (caught.status === 0 || caught.status >= 500)) {
          offlineSession.value = true;
          return null;
        }
        clear(true);
        await deleteMeta("offline-profile").catch(() => undefined);
        return null;
      }
    };
    // La cookie es compartida entre pestañas. Serializar la rotación evita
    // que dos focos simultáneos presenten el mismo refresh token.
    if (!renewing) {
      const task: Promise<string | null> = navigator.locks
        ? (async () => await navigator.locks.request("geeksium-pos-auth-refresh", perform))()
        : perform();
      renewing = task.finally(() => { renewing = null; });
    }
    return renewing;
  }

  /** Renueva antes de vencer; también recupera la sesión al volver del background. */
  async function ensureFreshSession(skewMs = 60_000): Promise<boolean> {
    if (!navigator.onLine) { if (user.value) offlineSession.value = true; return !!user.value; }
    if (getAccessToken() && accessExpiresAt.value && accessExpiresAt.value - Date.now() > skewMs) return true;
    return !!await renew();
  }

  async function signOut(): Promise<void> {
    await setMeta("explicit-signout", true).catch(() => undefined);
    await deleteMeta("offline-profile").catch(() => undefined);
    try {
      await authApi.logout();
    } catch {
      // Local sign-out succeeds offline; bootstrap will not reuse the remaining cookie.
    } finally {
      clear(false);
    }
  }

  async function restoreOffline(): Promise<void> {
    const cached = await getMeta<OfflineProfile>("offline-profile").catch(() => undefined);
    if (!cached?.user.organizationId || !cached.user.isActive || cached.user.isPlatformAdmin) return;
    const license = await getMeta<OfflineLicense>("license:" + accountScope(cached.user.organizationId, cached.user.id));
    if (licenseState(license) === "requires_validation") return;
    user.value = cached.user;
    roles.value = cached.roles;
    permissions.value = cached.permissions;
    licenseStatus.value = cached.licenseStatus;
    offlineSession.value = true;
    // UX snapshot only. It never becomes a bearer credential; API must reauthenticate.
  }
  async function restoreOnline(): Promise<boolean> {
    const token = await renew();
    if (!token) return false;
    try { await loadProfile(); return true; } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 0 || caught.status >= 500)) offlineSession.value = true;
      else clear();
      return false;
    }
  }

  let bootstrapping: Promise<void> | null = null;
  async function updateAuthorization(nextRoles: string[], nextPermissions: string[]) {
    roles.value = nextRoles;
    permissions.value = nextPermissions;
    await persistProfile();
  }

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
      configureAuthHandlers({ refresh: renew, onSessionLost: () => { if (!offlineSession.value) clear(true); } });
      const signedOut = await getMeta<boolean>("explicit-signout").catch(() => undefined);
      if (!signedOut && !navigator.onLine) offlineSession.value = true;
      const token = signedOut || !navigator.onLine ? null : await renew();
      if (token) {
        try {
          await loadProfile();
        } catch (caught) {
          if (caught instanceof ApiError && (caught.status === 0 || caught.status >= 500)) await restoreOffline().catch(() => undefined);
          else clear();
        }
      } else if (offlineSession.value) {
        await restoreOffline().catch(() => undefined);
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
    ensureFreshSession,
    offlineSession,
    accessExpiresAt,
    sessionExpired,
    restoreOnline,
    updateAuthorization,
  };
});
