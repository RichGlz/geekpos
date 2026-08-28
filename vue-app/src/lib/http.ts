import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

/**
 * Cliente HTTP único de la aplicación.
 *
 * - `withCredentials` para que viaje la cookie HttpOnly del refresh token.
 * - El access token se mantiene en memoria (nunca en localStorage) y se
 *   inyecta en cada petición.
 * - Ante un 401 se intenta UNA renovación y se reintenta la petición original;
 *   las peticiones concurrentes esperan a la misma promesa de refresco.
 */
const baseURL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let onSessionLost: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function configureAuthHandlers(handlers: {
  refresh: () => Promise<string | null>;
  onSessionLost: () => void;
}): void {
  refreshHandler = handlers.refresh;
  onSessionLost = handlers.onSessionLost;
}

export const http: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 20_000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

function toApiError(error: AxiosError<ApiErrorBody>): ApiError {
  const body = error.response?.data;
  if (body?.error) {
    return new ApiError(
      error.response?.status ?? 0,
      body.error.code,
      body.error.message,
      body.error.details,
    );
  }
  if (error.code === "ECONNABORTED" || !error.response) {
    return new ApiError(0, "NETWORK_ERROR", "Sin conexión con el servidor.");
  }
  return new ApiError(error.response.status, "REQUEST_ERROR", "La solicitud no pudo completarse.");
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes("/auth/login") || original?.url?.includes("/auth/refresh");

    if (status === 401 && original && !original._retried && !isAuthCall && refreshHandler) {
      original._retried = true;
      refreshing ??= refreshHandler().finally(() => {
        refreshing = null;
      });
      const token = await refreshing;
      if (token) return http(original);
      onSessionLost?.();
    }

    throw toApiError(error);
  },
);
