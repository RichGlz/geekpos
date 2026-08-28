import { http } from "@/lib/http";

export interface AuthUser {
  id: string;
  organizationId: string | null;
  email: string;
  fullName: string;
  isActive: boolean;
  isPlatformAdmin: boolean;
}

export type LicenseStatus = "ACTIVE" | "GRACE" | "READ_ONLY" | "SUSPENDED" | "CANCELLED";

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  licenseStatus: LicenseStatus | null;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>("/auth/login", { email, password });
  return data;
}

export async function refresh(): Promise<AuthResponse> {
  const { data } = await http.post<AuthResponse>("/auth/refresh");
  return data;
}

export async function logout(): Promise<void> {
  await http.post("/auth/logout");
}

export async function listSessions(): Promise<SessionSummary[]> {
  const { data } = await http.get<{ sessions: SessionSummary[] }>("/auth/sessions");
  return data.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await http.delete(`/auth/sessions/${id}`);
}
