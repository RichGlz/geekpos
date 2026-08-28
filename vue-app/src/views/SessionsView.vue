<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as authApi from "@/modules/auth/auth.api";
import type { SessionSummary } from "@/modules/auth/auth.api";

const sessions = ref<SessionSummary[]>([]);
const message = ref<string | null>(null);

async function load(): Promise<void> {
  try {
    sessions.value = await authApi.listSessions();
  } catch {
    message.value = "No fue posible cargar las sesiones.";
  }
}

async function revoke(id: string): Promise<void> {
  await authApi.revokeSession(id);
  await load();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("es-MX");
}

onMounted(load);
</script>

<template>
  <section>
    <h1 class="text-3xl">Sesiones activas</h1>
    <p class="mt-1 text-sm text-ink-muted">
      Cierra cualquier sesión que no reconozcas. El cierre revoca también sus tokens de refresco.
    </p>

    <p v-if="message" role="alert" class="mt-4 text-sm text-danger">{{ message }}</p>

    <table class="panel mt-6 w-full text-left text-sm">
      <thead class="text-ink-subtle">
        <tr>
          <th class="px-4 py-3 font-medium">Dispositivo</th>
          <th class="px-4 py-3 font-medium">IP</th>
          <th class="px-4 py-3 font-medium">Última actividad</th>
          <th class="px-4 py-3"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="session in sessions" :key="session.id" class="border-t border-line">
          <td class="px-4 py-3 text-ink-muted">{{ session.userAgent ?? "Desconocido" }}</td>
          <td class="px-4 py-3 text-ink-muted">{{ session.ipAddress ?? "—" }}</td>
          <td class="px-4 py-3 text-ink-muted">{{ formatDate(session.lastSeenAt) }}</td>
          <td class="px-4 py-3 text-right">
            <button
              type="button"
              class="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-danger hover:text-ink"
              @click="revoke(session.id)"
            >
              Cerrar
            </button>
          </td>
        </tr>
        <tr v-if="sessions.length === 0">
          <td colspan="4" class="px-4 py-6 text-center text-ink-subtle">Sin sesiones registradas.</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
